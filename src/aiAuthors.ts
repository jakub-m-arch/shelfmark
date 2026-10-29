import { setIcon, type App } from "obsidian";
import { extractJson } from "./ai";
import { contentLanguage } from "./format";
import { getBooks } from "./library";
import type { ReviewTask } from "./modals/ReviewModal";
import type { ShelfmarkSettings } from "./settings";

/*
 * Unifying authors: catalogs write the same name in different ways
 * ("Lem, Stanisław", "S. Lem", "Dostoevsky"), which splits the filter and the stats.
 */

export interface AuthorFix {
  /** The target form, e.g. "Stanisław Lem". */
  to: string;
  /** Spellings replaced with the target form, with their book counts. */
  from: { name: string; count: number }[];
}

export function authorsTask(app: App, settings: ShelfmarkSettings): ReviewTask<AuthorFix> {
  return {
    title: "Unify authors",
    waiting: "Claude is reviewing author names…",
    empty: "Authors are written consistently. Nothing to change.",
    prepare: async () => {
      const usage = new Map<string, string[]>();
      for (const b of getBooks(app)) for (const a of b.authors) usage.set(a, [...(usage.get(a) ?? []), b.title]);
      const names = [...usage.keys()].sort((a, b) => a.localeCompare(b));
      if (!names.length) return null;
      const lines = names.map((n, i) => `${i + 1}. ${n} | ${usage.get(n)!.slice(0, 2).join("; ")}`);
      const language = contentLanguage(settings);

      const prompt = `You are unifying author names in a reader's private library. The reader reads mostly in ${language}.
For every name that needs fixing, give the target form:
- "First Last" in natural order, the full first name instead of an initial if you know for sure who it is;
- for authors published in ${language}, the spelling used by ${language} editions;
- different spellings of the same person must get an identical target form;
- if a name is already fine, skip it. If you are not sure who the author is, skip it too.

Answer ONLY with a JSON object, no commentary:
{"authors": [{"id": 1, "to": "First Last"}]}

AUTHOR NAMES (number. name | example titles)
${lines.join("\n")}
`;
      const parse = (answer: string): AuthorFix[] => {
        const o = extractJson(answer);
        const groups = new Map<string, AuthorFix>();
        for (const entry of Array.isArray(o.authors) ? o.authors : []) {
          const name = names[Number(entry?.id) - 1];
          const to = typeof entry?.to === "string" ? entry.to.trim() : "";
          if (!name || !to || to === name) continue;
          const group: AuthorFix = groups.get(to) ?? { to, from: [] };
          if (!group.from.some((f) => f.name === name)) group.from.push({ name, count: usage.get(name)!.length });
          groups.set(to, group);
        }
        return [...groups.values()].sort((a, b) => a.to.localeCompare(b.to));
      };
      return { prompt, parse };
    },
    render: (el, fix) => {
      const line = el.createDiv("shelfmark-genres-option");
      line.createSpan({
        cls: "shelfmark-genres-before",
        text: fix.from.map((f) => `${f.name}${f.count > 1 ? ` (${f.count})` : ""}`).join(", "),
      });
      setIcon(line.createSpan("shelfmark-genres-arrow"), "arrow-right");
      line.createSpan({ cls: "shelfmark-row-title", text: fix.to });
    },
    apply: async (fixes) => {
      const map = new Map<string, string>();
      for (const fix of fixes) for (const f of fix.from) map.set(f.name, fix.to);
      for (const book of getBooks(app)) {
        if (!book.authors.some((a) => map.has(a))) continue;
        await app.fileManager.processFrontMatter(book.file, (fm) => {
          fm.author = [...new Set(book.authors.map((a) => map.get(a) ?? a))];
        });
      }
    },
  };
}
