import { App, moment } from "obsidian";
import { getBooks } from "./library";
import { MONTH_NAMES, isFullDate } from "./readDates";
import type { BookEntry } from "./types";

/** Reading stats for one year or (year = null) for the whole history. */
export interface ReadingStats {
  year: number | null;
  read: BookEntry[];
  pages: number;
  avgRating?: number;
  avgPages?: number;
  /** Average days from start to finish, when both dates are known. */
  avgDays?: number;
  /** How many books were abandoned (for a year: started in that year). */
  abandoned: number;
  /** Read books missing from the timeline: no month (year view) or no date (whole history). */
  undated: number;
  /** Label, book count, page count and the library filter value. */
  timeline: { label: string; full: string; count: number; pages: number; filter?: string }[];
  authors: [string, number][];
  genres: [string, number][];
  ratings: number[];
  formats: [string, number][];
  longest?: BookEntry;
  shortest?: BookEntry;
  fastest?: { book: BookEntry; days: number };
  favorites: BookEntry[];
}

// Always in English, like the rest of the interface, regardless of Obsidian's language.
const MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));

function finishedYear(b: BookEntry): number | undefined {
  const y = Number(b.finished?.slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? y : undefined;
}

/** Years in which something was read, newest first. */
export function statsYears(app: App): number[] {
  const years = new Set<number>();
  for (const b of getBooks(app)) if (b.status === "read" && finishedYear(b)) years.add(finishedYear(b)!);
  return [...years].sort((a, b) => b - a);
}

function top(values: string[], limit: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

function readingDays(b: BookEntry): number | undefined {
  // Only with full dates; "2015" or "2015-06" would give a made-up result.
  if (!isFullDate(b.started) || !isFullDate(b.finished)) return undefined;
  const days = moment(b.finished).diff(moment(b.started), "days") + 1;
  return days > 0 ? days : undefined;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export function readingStats(app: App, year: number | null): ReadingStats {
  const books = getBooks(app);
  const read = books.filter((b) => b.status === "read" && (year === null || finishedYear(b) === year));
  const withPages = read.filter((b) => b.pages);
  const rated = read.filter((b) => b.rating);
  const durations = read.map((b) => ({ book: b, days: readingDays(b) })).filter((d): d is { book: BookEntry; days: number } => !!d.days);

  let timeline: ReadingStats["timeline"];
  if (year !== null) {
    timeline = MONTHS.map((label, i) => {
      const month = read.filter((b) => Number(b.finished?.slice(5, 7)) === i + 1);
      return {
        label,
        full: `${MONTH_NAMES[i]} ${year}`,
        count: month.length,
        pages: month.reduce((s, b) => s + (b.pages ?? 0), 0),
      };
    });
  } else {
    const years = statsYears(app).sort((a, b) => a - b);
    const all = years.length ? Array.from({ length: years[years.length - 1] - years[0] + 1 }, (_, i) => years[0] + i) : [];
    timeline = all.map((y) => {
      const inYear = read.filter((b) => finishedYear(b) === y);
      return {
        label: String(y),
        full: String(y),
        count: inYear.length,
        pages: inYear.reduce((s, b) => s + (b.pages ?? 0), 0),
        filter: String(y),
      };
    });
  }

  const ratings = [1, 2, 3, 4, 5].map((n) => rated.filter((b) => b.rating === n).length);
  const bySize = [...withPages].sort((a, b) => (b.pages ?? 0) - (a.pages ?? 0));
  const fastest = [...durations].sort((a, b) => a.days - b.days)[0];

  return {
    year,
    read,
    pages: withPages.reduce((s, b) => s + (b.pages ?? 0), 0),
    avgRating: avg(rated.map((b) => b.rating!)),
    avgPages: avg(withPages.map((b) => b.pages!)),
    avgDays: avg(durations.map((d) => d.days)),
    undated: read.length - timeline.reduce((s, t) => s + t.count, 0),
    abandoned: books.filter(
      (b) => b.status === "abandoned" && (year === null || Number(b.started?.slice(0, 4)) === year)
    ).length,
    timeline,
    authors: top(read.flatMap((b) => b.authors), 8),
    genres: top(read.flatMap((b) => b.categories), 8),
    ratings,
    formats: top(read.map((b) => b.format ?? "no format"), 4),
    longest: bySize[0],
    shortest: bySize.length > 1 ? bySize[bySize.length - 1] : undefined,
    fastest: fastest && durations.length > 1 ? fastest : undefined,
    favorites: read.filter((b) => b.rating === 5 || b.favorite),
  };
}

/** "1 book", "5 books". */
export function booksLabel(n: number): string {
  return n === 1 ? "1 book" : `${n} books`;
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString();
}
