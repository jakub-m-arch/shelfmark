import { requestUrl } from "obsidian";
import type { BookSearchResult } from "../types";
import { asIsbn } from "./isbn";

type MarcSubfields = { subfields: Record<string, string>[] };
type MarcField = Record<string, string | MarcSubfields>;

interface BnBib {
  id: number;
  marc: { fields: MarcField[] };
}

const API = "https://data.bn.org.pl/api/institutions/bibs.json";
const LANGUAGES: Record<string, string> = { pol: "pl", eng: "en", ger: "de", fre: "fr", rus: "ru", spa: "es", ita: "it" };

/**
 * The National Library of Poland catalog (open API at data.bn.org.pl). It searches by title only,
 * so when the query also contains the author, it tries dropping the first or last word.
 */
export async function searchPolishNationalLibrary(query: string): Promise<BookSearchResult[]> {
  const isbn = asIsbn(query);
  if (isbn) {
    // An edition can have several ISBNs; keep the one that was searched for.
    return (await fetchBibs({ isbnIssn: isbn }, "")).map((r) =>
      isbn.length === 13 ? { ...r, isbn13: isbn } : { ...r, isbn10: isbn }
    );
  }

  const words = query.trim().split(/\s+/);
  const attempts: Record<string, string>[] = [{ title: query.trim() }];
  if (words.length >= 2) {
    attempts.push({ title: words.slice(0, -1).join(" "), author: words[words.length - 1] });
    attempts.push({ title: words.slice(1).join(" "), author: words[0] });
  }
  for (const params of attempts) {
    const results = await fetchBibs(params, params.title);
    if (results.length) return results;
  }
  return [];
}

const norm = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, " ").trim();

async function fetchBibs(params: Record<string, string>, title: string): Promise<BookSearchResult[]> {
  // The catalog's own (Polish) value for the "book" record kind.
  const search = new URLSearchParams({ ...params, kind: "ksi\u0105\u017cka", limit: "40" });
  const res = await requestUrl({ url: `${API}?${search}`, throw: false });
  if (res.status !== 200) throw new Error(`National Library of Poland: error ${res.status}`);

  const results = ((res.json.bibs ?? []) as BnBib[]).map(mapBib).filter((r): r is BookSearchResult => !!r);
  // First a title matching the query (not e.g. an exhibition catalog about the book), then
  // Polish editions with an author, newest last.
  const wanted = norm(title);
  const score = (r: BookSearchResult) =>
    (norm(r.title) === wanted ? 4 : norm(r.title).startsWith(wanted) ? 2 : 0) +
    (r.language === "pl" ? 1 : 0) +
    (r.authors.length ? 1 : 0);
  return results.sort(
    (a, b) => score(b) - score(a) || (b.publishedDate ?? "").localeCompare(a.publishedDate ?? "")
  );
}

function subfields(fields: MarcField[], tag: string): Record<string, string>[][] {
  return fields
    .filter((f) => tag in f && typeof f[tag] === "object")
    .map((f) => (f[tag] as MarcSubfields).subfields);
}

function first(subs: Record<string, string>[] | undefined, code: string): string | undefined {
  return subs?.find((s) => code in s)?.[code];
}

/** Removes catalog punctuation from the end of a field, e.g. "Solaris /", "Znak,". */
function clean(value: string | undefined): string | undefined {
  const v = value?.replace(/[\s/:;,=.]+$/, "").replace(/^"(.*)"$/, "$1").trim();
  return v || undefined;
}

/** "Lem, Stanisław" → "Stanisław Lem". */
function personName(value: string | undefined): string | undefined {
  const v = clean(value);
  if (!v) return undefined;
  const [last, firstName] = v.split(/,\s*/);
  return firstName ? `${firstName} ${last}` : last;
}

function controlField(fields: MarcField[], tag: string): string | undefined {
  const f = fields.find((x) => typeof x[tag] === "string");
  return f?.[tag] as string | undefined;
}

function mapBib(bib: BnBib): BookSearchResult | undefined {
  const fields = bib.marc?.fields ?? [];
  const title245 = subfields(fields, "245")[0];
  const title = clean(first(title245, "a"));
  if (!title) return undefined;

  const authors: string[] = [];
  const translators: string[] = [];
  const main = personName(first(subfields(fields, "100")[0], "a"));
  if (main) authors.push(main);
  for (const subs of subfields(fields, "700")) {
    const name = personName(first(subs, "a"));
    const role = first(subs, "e")?.toLowerCase() ?? "";
    if (!name) continue;
    // Relator terms are in Polish: "tlum." (translator, with a Polish l), "aut." (author).
    if (role.startsWith("t\u0142um")) translators.push(name);
    else if ((!role || role.startsWith("aut")) && !authors.includes(name)) authors.push(name);
  }

  const isbns = subfields(fields, "020")
    .map((subs) => first(subs, "a")?.replace(/[^\dX]/gi, ""))
    .filter((i): i is string => !!i);
  const isbn13 = isbns.find((i) => i.length === 13);
  const isbn10 = isbns.find((i) => i.length === 10);

  const imprint = subfields(fields, "264")[0] ?? subfields(fields, "260")[0];
  const year = first(imprint, "c")?.match(/\d{4}/)?.[0];
  const pages = Number(first(subfields(fields, "300")[0], "a")?.match(/\d+/)?.[0]) || undefined;
  // Field 008 holds this edition's language; 041 is sometimes filled with the original's.
  const lang = controlField(fields, "008")?.slice(35, 38).trim() || first(subfields(fields, "041")[0], "a");

  const categories = [
    ...new Set(
      subfields(fields, "655")
        .map((subs) => clean(first(subs, "a")))
        .filter((c): c is string => !!c && !c.includes("[Typ publikacji]"))
    ),
  ];
  const original = subfields(fields, "246").find((subs) => first(subs, "i")?.startsWith("Tyt. oryg"));
  const almaId = controlField(fields, "009");

  return {
    source: "bn",
    sourceId: String(bib.id),
    title,
    subtitle: clean(first(title245, "b")),
    originalTitle: clean(first(original, "a")),
    authors,
    translators,
    publisher: clean(first(imprint, "b")),
    publishedDate: year,
    pages,
    isbn13,
    isbn10,
    language: lang ? LANGUAGES[lang] ?? lang : undefined,
    categories,
    // BN has no covers; try to find a cover for this edition in Open Library.
    coverUrls: isbn13 ? [`https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`] : [],
    thumbnailUrl: isbn13 ? `https://covers.openlibrary.org/b/isbn/${isbn13}-M.jpg?default=false` : undefined,
    infoUrl: almaId
      ? `https://katalogi.bn.org.pl/discovery/fulldisplay?docid=alma${almaId}&context=L&vid=48OMNIS_NLOP:48OMNIS_NLOP`
      : undefined,
  };
}
