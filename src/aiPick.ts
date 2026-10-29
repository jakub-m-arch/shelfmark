import type { App } from "obsidian";
import { extractJson, readProfile } from "./ai";
import { plainDescription } from "./aiGenres";
import { contentLanguage } from "./format";
import { getBooks } from "./library";
import type { ShelfmarkSettings } from "./settings";
import type { BookEntry } from "./types";

/*
 * "What should I read next?": Claude chooses from books waiting on the shelf or in the queue,
 * so it can't suggest anything outside the library.
 */

export interface ReadingPick {
  book: BookEntry;
  reason: string;
}

/** Ready-made moods to click instead of typing. */
export const MOODS = [
  "Something light to unwind",
  "Short, for the weekend",
  "A page-turner",
  "Something ambitious to think about",
  "A change from my last read",
];

const DONE = ["read", "abandoned", "never", "reading"];

/** Books to choose from: owned or queued, and not read yet. */
export function pickCandidates(app: App): BookEntry[] {
  return getBooks(app).filter((b) => (b.owned || b.queue !== undefined) && !DONE.includes(b.status ?? ""));
}

/** Whether the library has an earlier, unread volume of this book's series. */
function earlierVolumeUnread(books: BookEntry[], book: BookEntry): boolean {
  if (!book.series || !book.seriesIndex) return false;
  return books.some(
    (b) => b.series === book.series && (b.seriesIndex ?? Infinity) < book.seriesIndex! && b.status !== "read"
  );
}

export async function buildPickPrompt(
  app: App,
  settings: ShelfmarkSettings,
  mood: string,
  candidates: BookEntry[]
): Promise<string> {
  const books = getBooks(app);
  const lines: string[] = [];
  for (const [i, b] of candidates.entries()) {
    const meta = [
      b.pages ? `${b.pages} pages` : "",
      b.format ?? "",
      b.queue !== undefined ? `queued at position ${b.queue}` : "",
      b.series ? `series: ${b.series}${b.seriesIndex ? ` #${b.seriesIndex}` : ""}` : "",
      earlierVolumeUnread(books, b) ? "NOTE: an earlier volume is unread" : "",
      b.categories.length ? `genres: ${b.categories.slice(0, 4).join(", ")}` : "",
    ].filter(Boolean);
    lines.push(`${i + 1}. ${b.title} — ${b.authors.join(", ") || "unknown author"} | ${meta.join(" | ")}`);
    const desc = plainDescription(await app.vault.cachedRead(b.file), 300);
    if (desc) lines.push(`   Description: ${desc}`);
  }

  const recent = books
    .filter((b) => b.status === "read" && b.finished)
    .sort((a, b) => (b.finished ?? "").localeCompare(a.finished ?? ""))
    .slice(0, 5)
    .map((b) => `- ${b.title} — ${b.authors.join(", ")}${b.rating ? ` (rated ${b.rating}/5)` : ""}`);
  const reading = books.filter((b) => b.status === "reading").map((b) => `- ${b.title} — ${b.authors.join(", ")}`);
  const profile = await readProfile(app, settings);
  const language = contentLanguage(settings);

  return `You are helping a reader choose their next book ONLY from the list of books they already own or have planned.
Pick up to 3 that best fit their wish and taste, best match first.
Don't suggest a later volume of a series if an earlier one is unread. If the list is shorter, pick fewer.
Reason: 1–2 sentences in ${language}, concrete (length, pace, mood, connection to recent reads),
addressing the reader as "you", without gendered forms.

Answer ONLY with a JSON object, no commentary:
{"picks": [{"id": 1, "reason": ""}]}

READER'S WISH
${mood.trim() || "(no particular wish, something good for now)"}

READER'S NOTES ON THEIR TASTE
${profile.notes || "(none)"}

READING PROFILE
${profile.profile || "(none)"}

RECENTLY READ
${recent.join("\n") || "(none)"}

READING NOW
${reading.join("\n") || "(nothing)"}

BOOKS TO CHOOSE FROM
${lines.join("\n")}
`;
}

export function parsePicks(text: string, candidates: BookEntry[]): ReadingPick[] {
  const o = extractJson(text);
  const picks: ReadingPick[] = [];
  for (const p of Array.isArray(o.picks) ? o.picks : []) {
    const book = candidates[Number(p?.id) - 1];
    if (book && !picks.some((x) => x.book === book)) picks.push({ book, reason: String(p.reason ?? "").trim() });
  }
  return picks.slice(0, 3);
}
