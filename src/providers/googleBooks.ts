import { requestUrl } from "obsidian";
import type { BookSearchResult } from "../types";
import { asIsbn } from "./isbn";

interface GoogleVolume {
  id: string;
  volumeInfo: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    categories?: string[];
    language?: string;
    averageRating?: number;
    ratingsCount?: number;
    infoLink?: string;
    industryIdentifiers?: { type: string; identifier: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

export async function searchGoogleBooks(
  query: string,
  apiKey: string,
  lang: string
): Promise<BookSearchResult[]> {
  const isbn = asIsbn(query);
  const params = new URLSearchParams({
    q: isbn ? `isbn:${isbn}` : query,
    maxResults: "20",
    printType: "books",
  });
  if (lang && !isbn) params.set("langRestrict", lang);
  if (apiKey) params.set("key", apiKey);

  const url = `https://www.googleapis.com/books/v1/volumes?${params}`;
  let res = await requestUrl({ url, throw: false });
  // Google Books now and then answers 5xx to single requests; retrying usually helps.
  for (let attempt = 1; res.status >= 500 && attempt <= 2; attempt++) {
    await sleep(500 * attempt);
    res = await requestUrl({ url, throw: false });
  }
  if (res.status === 429 || res.status === 403) {
    throw new Error(
      apiKey
        ? "Google Books: request limit exceeded."
        : "Google Books: the limit without an API key is used up. Add a key in settings."
    );
  }
  if (res.status >= 500) throw new Error("Google Books is not responding right now, try again in a moment.");
  if (res.status !== 200) throw new Error(`Google Books: error ${res.status}`);

  const items: GoogleVolume[] = res.json.items ?? [];
  return items.filter((i) => i.volumeInfo?.title).map(mapVolume);
}

function mapVolume(v: GoogleVolume): BookSearchResult {
  const info = v.volumeInfo;
  const ids = info.industryIdentifiers ?? [];
  const isbn13 = ids.find((i) => i.type === "ISBN_13")?.identifier;
  const isbn10 = ids.find((i) => i.type === "ISBN_10")?.identifier;
  const thumb = (info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail)?.replace(
    /^http:/,
    "https:"
  );

  const coverUrls: string[] = [];
  if (thumb) {
    coverUrls.push(
      `https://books.google.com/books/content?id=${v.id}&printsec=frontcover&img=1&zoom=1&fife=w800-h1200`
    );
  }
  if (isbn13) coverUrls.push(`https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`);
  if (thumb) coverUrls.push(thumb);

  return {
    source: "google",
    sourceId: v.id,
    title: info.title ?? "",
    subtitle: info.subtitle,
    authors: info.authors ?? [],
    publisher: info.publisher,
    publishedDate: info.publishedDate,
    pages: info.pageCount,
    isbn13,
    isbn10,
    language: info.language,
    categories: info.categories ?? [],
    description: info.description,
    coverUrls,
    thumbnailUrl: thumb,
    averageRating: info.averageRating,
    ratingsCount: info.ratingsCount,
    infoUrl: info.infoLink?.replace(/^http:/, "https:"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
