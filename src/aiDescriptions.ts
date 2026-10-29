import type { App } from "obsidian";
import { extractJson, section } from "./ai";
import { contentLanguage } from "./format";
import { DESCRIPTION_PLACEHOLDER, SECTIONS, getBooks } from "./library";
import type { ReviewTask } from "./modals/ReviewModal";
import type { ShelfmarkSettings } from "./settings";
import type { BookEntry } from "./types";

/*
 * Descriptions in the preferred language: for books without one (the National Library of Poland
 * doesn't provide them) or, when the preferred language isn't English, with an English one.
 * Claude translates and shortens an existing description; without one it writes from its own
 * knowledge, and skips books it doesn't know.
 */

export interface DescriptionFix {
  book: BookEntry;
  text: string;
  /** Whether it came from the catalog description (a translation) or from Claude's knowledge. */
  fromCatalog: boolean;
}

const MARK = "_Description written by Claude._";
/** This many books per request; the rest is handled by the next run. */
const BATCH = 30;

/** A description with several common English words is treated as English. */
function looksEnglish(text: string): boolean {
  return (text.match(/\b(the|and|of|is|with|his|her|this)\b/gi) ?? []).length >= 3;
}

async function needsDescription(app: App, book: BookEntry, english: boolean): Promise<string | null> {
  const text = await app.vault.cachedRead(book.file);
  if (!new RegExp(`^## ${SECTIONS.description}\\s*$`, "m").test(text)) return null;
  const current = section(text, SECTIONS.description).trim();
  if (!current || current === DESCRIPTION_PLACEHOLDER) return "";
  return !english && looksEnglish(current) ? current : null;
}

/** Replaces the content of the description section, leaving the rest of the note unchanged. */
function replaceDescription(text: string, description: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${SECTIONS.description}`);
  if (start === -1) return text;
  let end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  if (end === -1) end = lines.length;
  return [...lines.slice(0, start + 1), description, "", MARK, "", ...lines.slice(end)].join("\n");
}

export function descriptionsTask(app: App, settings: ShelfmarkSettings): ReviewTask<DescriptionFix> {
  const language = contentLanguage(settings);
  const english = language === "English";
  let remaining = 0;
  return {
    title: "Descriptions",
    waiting: "Claude is writing descriptions (usually 1–2 minutes)…",
    empty: `Every book has a description in ${language}, or Claude doesn't know the rest.`,
    note: () => (remaining ? `${remaining} more books are waiting for the next run.` : ""),
    prepare: async () => {
      const todo: { book: BookEntry; current: string }[] = [];
      for (const book of getBooks(app)) {
        const current = await needsDescription(app, book, english);
        if (current !== null) todo.push({ book, current });
      }
      if (!todo.length) return null;
      const batch = todo.slice(0, BATCH);
      remaining = todo.length - batch.length;

      const lines = batch.map(({ book, current }, i) => {
        const fm = app.metadataCache.getFileCache(book.file)?.frontmatter ?? {};
        const meta = [fm.original_title ? `original: ${fm.original_title}` : "", fm.published ? `published: ${fm.published}` : ""];
        const head = `${i + 1}. ${book.title} — ${book.authors.join(", ") || "unknown author"} ${meta.filter(Boolean).join(" | ")}`;
        const source = current.replace(/\s+/g, " ").slice(0, 800);
        return source ? `${head}\n   Catalog description: ${source}` : head;
      });

      const prompt = `You are writing short book descriptions in ${language} for a private library.
For each book: 2–4 sentences in ${language}, like a jacket blurb: what it is about, what it feels like.
NO spoilers (no ending, no twists, no telling who dies).
If there is a "Catalog description", base it on that: translate and shorten it, don't add facts beyond it.
If there isn't, write from your own knowledge, but ONLY about books you know for sure; skip the rest.

Answer ONLY with a JSON object, no commentary:
{"descriptions": [{"id": 1, "text": ""}]}

BOOKS
${lines.join("\n")}
`;
      const parse = (answer: string): DescriptionFix[] => {
        const o = extractJson(answer);
        const fixes: DescriptionFix[] = [];
        for (const entry of Array.isArray(o.descriptions) ? o.descriptions : []) {
          const item = batch[Number(entry?.id) - 1];
          const text = typeof entry?.text === "string" ? entry.text.trim() : "";
          if (!item || text.length < 40 || fixes.some((f) => f.book === item.book)) continue;
          fixes.push({ book: item.book, text, fromCatalog: !!item.current });
        }
        return fixes;
      };
      return { prompt, parse };
    },
    render: (el, fix) => {
      el.createDiv({ cls: "shelfmark-row-title", text: fix.book.title });
      el.createDiv({
        cls: "shelfmark-card-author",
        text: `${fix.book.authors.join(", ")} · ${fix.fromCatalog ? "translated catalog description" : "from Claude's knowledge"}`,
      });
      el.createDiv({ cls: "shelfmark-pick-reason", text: fix.text });
    },
    apply: async (fixes) => {
      for (const fix of fixes) await app.vault.process(fix.book.file, (text) => replaceDescription(text, fix.text));
    },
  };
}
