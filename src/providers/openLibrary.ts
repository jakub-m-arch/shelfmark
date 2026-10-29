import { requestUrl } from "obsidian";
import type { BookSearchResult } from "../types";
import { asIsbn } from "./isbn";

interface OpenLibraryDoc {
  key: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  number_of_pages_median?: number;
  cover_i?: number;
  publisher?: string[];
  ratings_average?: number;
  ratings_count?: number;
  subject?: string[];
}

const FIELDS =
  "key,title,subtitle,author_name,first_publish_year,isbn,number_of_pages_median,cover_i,publisher,ratings_average,ratings_count,subject";

export async function searchOpenLibrary(query: string, lang: string): Promise<BookSearchResult[]> {
  const isbn = asIsbn(query);
  const params = new URLSearchParams({ limit: "20", fields: FIELDS });
  if (isbn) params.set("isbn", isbn);
  else params.set("q", query);
  if (lang && !isbn) params.set("lang", lang);

  const res = await requestUrl({
    url: `https://openlibrary.org/search.json?${params}`,
    throw: false,
  });
  if (res.status !== 200) throw new Error(`Open Library: error ${res.status}`);

  const docs: OpenLibraryDoc[] = res.json.docs ?? [];
  return docs.filter((d) => d.title).map((d) => mapDoc(d, lang, isbn));
}

/** ISBN prefixes of the main publishing regions for a language. */
const ISBN_PREFIXES: Record<string, string[]> = {
  en: ["9780", "9781"],
  fr: ["9782"],
  de: ["9783"],
  ja: ["9784"],
  ru: ["9785"],
  pl: ["97883"],
  es: ["97884"],
  it: ["97888"],
};

function mapDoc(d: OpenLibraryDoc, lang: string, queriedIsbn?: string): BookSearchResult {
  const isbns = d.isbn ?? [];
  // The result describes the whole work, not an edition, so pick an ISBN in the preferred language if there is one.
  const isbn13 =
    queriedIsbn?.length === 13
      ? queriedIsbn
      : isbns.find((i) => i.length === 13 && (ISBN_PREFIXES[lang] ?? []).some((p) => i.startsWith(p))) ??
        isbns.find((i) => i.length === 13);
  const isbn10 = queriedIsbn?.length === 10 ? queriedIsbn : isbns.find((i) => i.length === 10);

  const coverUrls: string[] = [];
  if (d.cover_i) coverUrls.push(`https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`);
  if (isbn13) coverUrls.push(`https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`);

  return {
    source: "openlibrary",
    sourceId: d.key,
    title: d.title ?? "",
    subtitle: d.subtitle,
    authors: d.author_name ?? [],
    publisher: d.publisher?.[0],
    publishedDate: d.first_publish_year?.toString(),
    pages: d.number_of_pages_median,
    isbn13,
    isbn10,
    categories: (d.subject ?? []).slice(0, 5),
    coverUrls,
    thumbnailUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : undefined,
    averageRating: d.ratings_average ? Math.round(d.ratings_average * 10) / 10 : undefined,
    ratingsCount: d.ratings_count,
    infoUrl: `https://openlibrary.org${d.key}`,
  };
}

function descriptionText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in value) return String((value as { value: unknown }).value);
  return undefined;
}

/**
 * The work's description from Open Library. Search doesn't return it, so the work page is fetched:
 * directly for Open Library results, or by ISBN for results from other sources.
 */
export async function fetchOpenLibraryDescription(r: BookSearchResult): Promise<string | undefined> {
  try {
    let workKey = r.source === "openlibrary" && r.sourceId.startsWith("/works/") ? r.sourceId : undefined;
    const isbn = r.isbn13 ?? r.isbn10;
    if (!workKey && isbn) {
      const res = await requestUrl({ url: `https://openlibrary.org/search.json?isbn=${isbn}&fields=key`, throw: false });
      workKey = res.status === 200 ? res.json.docs?.[0]?.key : undefined;
    }
    if (!workKey) return undefined;
    const work = await requestUrl({ url: `https://openlibrary.org${workKey}.json`, throw: false });
    return work.status === 200 ? descriptionText(work.json.description)?.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}
