import type { App } from "obsidian";
import { excerpt } from "./ai";
import { contentLanguage } from "./format";
import { seriesBooks } from "./library";
import type { ShelfmarkSettings } from "./settings";
import { statusLabel, type BookEntry } from "./types";

/*
 * "Recap previous volumes": a summary of what happened earlier in the series, without spoiling
 * the current volume. The reader's own notes from those books go into the prompt as a hint.
 */

/** Whether there is anything to recap: earlier volumes in the library, or a volume number above 1. */
export function hasEarlierVolumes(app: App, book: BookEntry): boolean {
  if (!book.series) return false;
  if ((book.seriesIndex ?? 0) > 1) return true;
  return seriesBooks(app, book.series).some((b) => b.seriesIndex && book.seriesIndex && b.seriesIndex < book.seriesIndex);
}

export async function buildRecapPrompt(app: App, settings: ShelfmarkSettings, book: BookEntry): Promise<string> {
  const earlier = seriesBooks(app, book.series ?? "").filter(
    (b) => b.file.path !== book.file.path && (!book.seriesIndex || !b.seriesIndex || b.seriesIndex < book.seriesIndex)
  );
  const lines: string[] = [];
  for (const b of earlier) {
    lines.push(
      `- Volume ${b.seriesIndex ?? "?"}: ${b.title} — ${b.authors.join(", ")} | ${statusLabel(b.status)}${b.finished ? `, finished ${b.finished}` : ""}`
    );
    const notes = await excerpt(app, b);
    if (notes) lines.push(`  Reader's notes: ${notes}`);
  }
  const language = contentLanguage(settings);

  return `The reader is starting the next volume of a series and wants to recall what happened before.

CURRENT VOLUME
${book.title} — ${book.authors.join(", ")} | series: ${book.series}${book.seriesIndex ? `, volume ${book.seriesIndex}` : ""}

EARLIER VOLUMES IN THEIR LIBRARY
${lines.join("\n") || "(none, rely on your knowledge of the series)"}

TASK
Write, in ${language}, a recap of all volumes published BEFORE the current one (including those not in the library),
in series order. For each volume: a heading "### Volume N: Title" and 3–6 bullet points: the key events,
characters and their relationships, how the volume ends. At the end, "### Where you begin": 2–3 sentences about
the situation at the start of the current volume. Do NOT reveal anything that happens in the current volume or later.
Translate the headings into ${language}.
If the reader has notes from a volume, refer to them without gendered forms (e.g. "In your notes you point out…").
If you don't remember something for sure, say so plainly instead of guessing. No introduction, start with the first heading.
`;
}
