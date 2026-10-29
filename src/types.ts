import type { TFile } from "obsidian";

export const STATUSES = [
  { id: "reading", label: "Reading", icon: "book-open" },
  { id: "to read", label: "To read", icon: "bookmark" },
  { id: "read", label: "Read", icon: "check-circle" },
  { id: "abandoned", label: "Abandoned", icon: "x-circle" },
  { id: "never", label: "Won't read", icon: "ban" },
] as const;

export type BookStatus = (typeof STATUSES)[number]["id"];

export const FORMATS = ["print", "ebook", "audiobook"] as const;

/** Wishlist priority, most important first. */
export const WISH_PRIORITIES = [
  { id: "must", label: "Really want" },
  { id: "want", label: "Want" },
  { id: "someday", label: "Someday" },
] as const;

export function wishPriorityRank(id: string | undefined): number {
  const i = WISH_PRIORITIES.findIndex((p) => p.id === id);
  return i === -1 ? WISH_PRIORITIES.length : i;
}

export const SOURCE_LABELS: Record<BookSearchResult["source"], string> = {
  google: "Google Books",
  openlibrary: "Open Library",
  bn: "National Library of Poland",
};

export function statusLabel(id: string | undefined): string {
  return STATUSES.find((s) => s.id === id)?.label ?? "No status";
}

/** A search result from any source, normalized to a common shape. */
export interface BookSearchResult {
  source: "google" | "openlibrary" | "bn";
  sourceId: string;
  title: string;
  subtitle?: string;
  originalTitle?: string;
  authors: string[];
  translators?: string[];
  publisher?: string;
  publishedDate?: string;
  pages?: number;
  isbn13?: string;
  isbn10?: string;
  language?: string;
  categories: string[];
  description?: string;
  /** High-resolution cover candidates, in the order to try them. */
  coverUrls: string[];
  thumbnailUrl?: string;
  averageRating?: number;
  ratingsCount?: number;
  infoUrl?: string;
}

export interface AddBookOptions {
  status: BookStatus;
  owned: boolean;
  format: string;
  /** Date finished (possibly approximate: "2015", "2015-06") for the "read" status; null = don't remember. */
  finished?: string | null;
}

/** A book stored in the vault, read from the note's frontmatter. */
export interface BookEntry {
  file: TFile;
  title: string;
  authors: string[];
  status?: string;
  rating?: number;
  owned: boolean;
  format?: string;
  coverPath?: string;
  isbn13?: string;
  pages?: number;
  currentPage?: number;
  categories: string[];
  language?: string;
  series?: string;
  seriesIndex?: number;
  favorite: boolean;
  /** Position in the reading queue (1 = next); absent when the book is not queued. */
  queue?: number;
  wishPriority?: string;
  price?: number;
  shopUrl?: string;
  gift: boolean;
  added: number;
  finished?: string;
  started?: string;
  /** Who I lent this book to, and when. */
  lentTo?: string;
  lentOn?: string;
  /** Who I borrowed this book from, when, and when it is due back. */
  borrowedFrom?: string;
  borrowedOn?: string;
  returnBy?: string;
}
