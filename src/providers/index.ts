import type { BookSearchResult } from "../types";
import { searchPolishNationalLibrary } from "./polishNationalLibrary";
import { searchGoogleBooks } from "./googleBooks";
import { fetchOpenLibraryDescription, searchOpenLibrary } from "./openLibrary";

export interface SearchOutcome {
  results: BookSearchResult[];
  errors: string[];
}

export interface SearchOptions {
  googleApiKey: string;
  language: string;
  usePolishNationalLibrary: boolean;
}

/**
 * Queries the sources in parallel. Google Books only with an API key, because requests without
 * one are rejected. The same ISBN from another source fills in the result already found.
 */
export async function searchBooks(query: string, opts: SearchOptions): Promise<SearchOutcome> {
  const searches: Promise<BookSearchResult[]>[] = [];
  if (opts.googleApiKey) searches.push(searchGoogleBooks(query, opts.googleApiKey, opts.language));
  searches.push(searchOpenLibrary(query, opts.language));
  if (opts.usePolishNationalLibrary) searches.push(searchPolishNationalLibrary(query));

  const errors: string[] = [];
  const results: BookSearchResult[] = [];
  const byIsbn = new Map<string, BookSearchResult>();

  for (const outcome of await Promise.allSettled(searches)) {
    if (outcome.status === "rejected") {
      errors.push(outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason));
      continue;
    }
    for (const r of outcome.value) {
      const known = r.isbn13 ? byIsbn.get(r.isbn13) : undefined;
      if (known) {
        // The same edition from another source: add only what was missing.
        known.translators = known.translators?.length ? known.translators : r.translators;
        known.originalTitle ??= r.originalTitle;
        known.publisher ??= r.publisher;
        known.pages ??= r.pages;
        known.language ??= r.language;
        continue;
      }
      if (r.isbn13) byIsbn.set(r.isbn13, r);
      results.push(r);
    }
  }
  return { results, errors };
}

/** Fills in a missing description from Open Library. */
export async function withDescription(r: BookSearchResult): Promise<BookSearchResult> {
  if (r.description || !r.sourceId) return r;
  const description = await fetchOpenLibraryDescription(r);
  return description ? { ...r, description } : r;
}
