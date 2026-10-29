import type { App } from "obsidian";
import { extractJson, section } from "./ai";
import { contentLanguage } from "./format";
import { DESCRIPTION_PLACEHOLDER, SECTIONS, getBooks } from "./library";
import type { ShelfmarkSettings } from "./settings";
import type { BookEntry } from "./types";

/*
 * Tidying up genres: Claude builds one genre vocabulary and assigns genres to books, and also
 * suggests missing series. Nothing changes without approval in the review dialog.
 */

export interface GenreChange {
  book: BookEntry;
  before: string[];
  after: string[];
  /** A series suggested for a book that doesn't have one yet. */
  series?: string;
  seriesIndex?: number;
}

export interface GenresProposal {
  vocabulary: string[];
  changes: GenreChange[];
}

export function plainDescription(text: string, limit: number): string {
  const plain = section(text, SECTIONS.description)
    .replace(DESCRIPTION_PLACEHOLDER, "")
    .replace(/[*_#>[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
}

export async function buildGenresPrompt(
  app: App,
  settings: ShelfmarkSettings
): Promise<{ prompt: string; books: BookEntry[] }> {
  const books = getBooks(app).sort((a, b) => a.title.localeCompare(b.title));
  const lines: string[] = [];
  for (const [i, b] of books.entries()) {
    const meta = [
      b.categories.length ? `current genres: ${b.categories.join(", ")}` : "no genres",
      b.series ? `series: ${b.series}${b.seriesIndex ? ` #${b.seriesIndex}` : ""}` : "",
    ].filter(Boolean);
    lines.push(`${i + 1}. ${b.title} — ${b.authors.join(", ") || "unknown author"} | ${meta.join(" | ")}`);
    // The description only helps where the title and current genres say little.
    const desc = b.categories.length < 2 ? plainDescription(await app.vault.cachedRead(b.file), 200) : "";
    if (desc) lines.push(`   Description: ${desc}`);
  }
  const language = contentLanguage(settings);

  const prompt = `You are tidying up genres in a private library. The current genres come from different catalogs
(Open Library, Google Books, National Library of Poland): they are in different languages, too detailed or inconsistent.

TASK
1. Build one vocabulary of 12–25 genres IN ${language.toUpperCase()}, fitted to this library, in lowercase
   (e.g. "science fiction", "crime", "nonfiction", "reportage", "literary fiction", translated to ${language}).
   Keep genres that are already in ${language} and fit, in exactly the same wording.
2. Assign each book 1–3 genres from the vocabulary only, most important first. Rely on your
   knowledge of the book and treat the current genres as a hint.
3. If a book has no series but surely belongs to one, give the series name in ${language} and the volume number.
   Don't guess: when in doubt, leave out series and series_index.

Answer ONLY with a JSON object, no commentary:
{"genres": ["..."], "books": [{"id": 1, "genres": ["..."], "series": "", "series_index": 1}]}

LIBRARY
${lines.join("\n")}
`;
  return { prompt, books };
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function parseGenres(text: string, books: BookEntry[]): GenresProposal {
  const o = extractJson(text);
  const vocabulary: string[] = Array.isArray(o.genres)
    ? [...new Set<string>(o.genres.map((g: unknown) => String(g).trim().toLocaleLowerCase()).filter(Boolean))]
    : [];
  const allowed = new Set(vocabulary);
  const changes: GenreChange[] = [];

  for (const entry of Array.isArray(o.books) ? o.books : []) {
    const book = books[Number(entry?.id) - 1];
    if (!book || changes.some((c) => c.book === book)) continue;
    const after: string[] = Array.isArray(entry.genres)
      ? [
          ...new Set<string>(
            entry.genres.map((g: unknown) => String(g).trim().toLocaleLowerCase()).filter((g: string) => allowed.has(g))
          ),
        ].slice(0, 3)
      : [];
    const series = !book.series && typeof entry.series === "string" && entry.series.trim() ? entry.series.trim() : undefined;
    const index = Number(entry.series_index);
    const genresChanged = after.length > 0 && !sameList(after, book.categories);
    if (!genresChanged && !series) continue;
    changes.push({
      book,
      before: book.categories,
      after: genresChanged ? after : book.categories,
      series,
      seriesIndex: series && Number.isFinite(index) && index > 0 ? index : undefined,
    });
  }
  return { vocabulary, changes };
}

export async function applyGenreChange(app: App, change: GenreChange, withSeries: boolean): Promise<void> {
  await app.fileManager.processFrontMatter(change.book.file, (fm) => {
    fm.categories = change.after;
    if (withSeries && change.series && !fm.series) {
      fm.series = change.series;
      fm.series_index = change.seriesIndex ?? null;
    }
  });
}
