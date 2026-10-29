import { App, TFile, htmlToMarkdown, moment, normalizePath, requestUrl, stringifyYaml } from "obsidian";
import { formatDate, formatPrice } from "./format";
import type { ShelfmarkSettings } from "./settings";
import { WISH_PRIORITIES, wishPriorityRank, type AddBookOptions, type BookEntry, type BookSearchResult } from "./types";

export const BOOK_TYPE = "book";

export function today(): string {
  return moment().format("YYYY-MM-DD");
}

export function isBook(app: App, file: TFile): boolean {
  return app.metadataCache.getFileCache(file)?.frontmatter?.type === BOOK_TYPE;
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value) return [value];
  return [];
}

function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return value !== null && value !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
}

export function unwrapLink(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.replace(/^!?\[\[/, "").replace(/(\|.*)?\]\]$/, "");
}

export function getBooks(app: App): BookEntry[] {
  const books: BookEntry[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm?.type !== BOOK_TYPE) continue;
    const added = fm.added ? moment(String(fm.added)).valueOf() : NaN;
    books.push({
      file,
      title: fm.title ? String(fm.title) : file.basename,
      authors: toList(fm.author),
      status: fm.status ? String(fm.status) : undefined,
      rating: typeof fm.rating === "number" && fm.rating > 0 ? fm.rating : undefined,
      owned: fm.owned === true,
      format: fm.format ? String(fm.format) : undefined,
      coverPath: unwrapLink(fm.cover),
      isbn13: fm.isbn13 ? String(fm.isbn13) : undefined,
      pages: toNumber(fm.pages),
      currentPage: toNumber(fm.current_page),
      categories: toList(fm.categories),
      language: fm.language ? String(fm.language) : undefined,
      series: fm.series ? String(fm.series) : undefined,
      seriesIndex: toNumber(fm.series_index),
      favorite: fm.favorite === true,
      queue: toNumber(fm.queue),
      wishPriority: fm.wish_priority ? String(fm.wish_priority) : undefined,
      price: toNumber(fm.price),
      shopUrl: typeof fm.shop_url === "string" && fm.shop_url ? fm.shop_url : undefined,
      gift: fm.gift === true,
      added: Number.isNaN(added) ? file.stat.ctime : added,
      finished: fm.finished ? String(fm.finished) : undefined,
      started: fm.started ? String(fm.started) : undefined,
      lentTo: fm.lent_to ? String(fm.lent_to) : undefined,
      lentOn: fm.lent_on ? String(fm.lent_on) : undefined,
      borrowedFrom: fm.borrowed_from ? String(fm.borrowed_from) : undefined,
      borrowedOn: fm.borrowed_on ? String(fm.borrowed_on) : undefined,
      returnBy: fm.return_by ? String(fm.return_by) : undefined,
    });
  }
  return books;
}

export function getBook(app: App, file: TFile): BookEntry | undefined {
  return getBooks(app).find((b) => b.file.path === file.path);
}

/** The book's cover file, if it exists in the vault. */
export function resolveCover(app: App, book: BookEntry): TFile | null {
  return resolveCoverLink(app, book.coverPath, book.file.path);
}

export function coverEmbed(path: string): string {
  return `![[${path}|180]]`;
}

export function resolveCoverLink(app: App, value: unknown, sourcePath: string): TFile | null {
  const link = unwrapLink(value);
  if (!link) return null;
  const direct = app.vault.getAbstractFileByPath(link);
  if (direct instanceof TFile) return direct;
  return app.metadataCache.getFirstLinkpathDest(link, sourcePath);
}

export function findDuplicate(app: App, result: BookSearchResult): BookEntry | undefined {
  const norm = (s: string) => s.toLocaleLowerCase().trim();
  return getBooks(app).find(
    (b) =>
      (result.isbn13 && b.isbn13 === result.isbn13) ||
      (norm(b.title) === norm(result.title) &&
        norm(b.authors[0] ?? "") === norm(result.authors[0] ?? ""))
  );
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export async function ensureFolder(app: App, path: string): Promise<void> {
  if (!path || app.vault.getAbstractFileByPath(path)) return;
  await app.vault.createFolder(path);
}

function uniquePath(app: App, folder: string, base: string, ext: string): string {
  const prefix = folder ? `${folder}/` : "";
  let path = normalizePath(`${prefix}${base}.${ext}`);
  for (let i = 2; app.vault.getAbstractFileByPath(path); i++) {
    path = normalizePath(`${prefix}${base} ${i}.${ext}`);
  }
  return path;
}

export interface ImageData {
  data: ArrayBuffer;
  ext: string;
}

/** Downloads the first working image from a list of URLs. */
export async function fetchImage(urls: string[]): Promise<ImageData | undefined> {
  for (const url of urls) {
    try {
      const res = await requestUrl({ url, throw: false });
      if (res.status !== 200) continue;
      const headers = Object.fromEntries(
        Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), v])
      );
      const type = headers["content-type"] ?? "";
      // Smaller images are usually "no cover" placeholders.
      if (!type.startsWith("image/") || res.arrayBuffer.byteLength < 2000) continue;
      return { data: res.arrayBuffer, ext: imageExt(type) };
    } catch {
      // Try the next source.
    }
  }
  return undefined;
}

export function imageExt(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}

export function libraryFolder(settings: ShelfmarkSettings): string {
  return normalizePath(settings.folder || "/").replace(/^\/$/, "");
}

export function coversFolder(settings: ShelfmarkSettings): string {
  return normalizePath(settings.coversFolder || settings.folder || "/").replace(/^\/$/, "");
}

async function saveCover(
  app: App,
  settings: ShelfmarkSettings,
  image: ImageData,
  base: string
): Promise<string> {
  const folder = coversFolder(settings);
  await ensureFolder(app, folder);
  const path = uniquePath(app, folder, base, image.ext);
  await app.vault.createBinary(path, image.data);
  return path;
}

/** The cover is stored as a link so Obsidian updates it on rename or move. */
export function coverLink(path: string): string {
  return `[[${path}]]`;
}

function fileBaseName(template: string, result: BookSearchResult): string {
  const year = result.publishedDate?.slice(0, 4) ?? "";
  const name = template
    .replace(/{{title}}/g, result.title)
    .replace(/{{author}}/g, result.authors[0] ?? "")
    .replace(/{{year}}/g, year)
    .replace(/^\s*-\s*|\s*-\s*$/g, "");
  return sanitizeFileName(name) || "Untitled";
}

export async function createBookNote(
  app: App,
  settings: ShelfmarkSettings,
  result: BookSearchResult,
  opts: AddBookOptions
): Promise<TFile> {
  const folder = libraryFolder(settings);
  const base = fileBaseName(settings.fileNameTemplate, result);

  const image = settings.downloadCovers ? await fetchImage(result.coverUrls) : undefined;
  const cover = image ? await saveCover(app, settings, image, base) : undefined;

  const date = today();
  const fm: Record<string, unknown> = {
    type: BOOK_TYPE,
    title: result.title,
    subtitle: result.subtitle,
    original_title: result.originalTitle,
    author: result.authors,
    translator: result.translators?.length ? result.translators : undefined,
    status: opts.status,
    rating: null,
    owned: opts.owned,
    format: opts.format || null,
    current_page: null,
    series: null,
    series_index: null,
    // A book read long ago doesn't get today's start date.
    started: opts.status === "reading" || (opts.status === "read" && opts.finished === undefined) ? date : null,
    finished: opts.status === "read" ? (opts.finished === undefined ? date : opts.finished) : null,
    added: date,
    publisher: result.publisher,
    published: result.publishedDate,
    pages: result.pages,
    language: result.language,
    isbn13: result.isbn13,
    isbn10: result.isbn10,
    categories: result.categories.length ? result.categories : undefined,
    cover: cover ? coverLink(cover) : undefined,
    avg_rating: result.averageRating,
    ratings_count: result.ratingsCount,
    source: result.infoUrl,
    tags: ["book"],
  };
  for (const key of Object.keys(fm)) if (fm[key] === undefined) delete fm[key];

  const yaml = stringifyYaml(fm).replace(/: null$/gm, ":");
  const description = result.description ? htmlToMarkdown(result.description).trim() : "";

  const body = [
    `${PANEL_BLOCK}\n`,
    `## ${SECTIONS.description}`,
    description || DESCRIPTION_PLACEHOLDER,
    "",
    `## ${SECTIONS.notes}`,
    "",
    "",
    `## ${SECTIONS.quotes}`,
    "",
    "",
    `## ${SECTIONS.thoughts}`,
    "",
  ].join("\n");

  await ensureFolder(app, folder);
  const path = uniquePath(app, folder, base, "md");
  return app.vault.create(path, `---\n${yaml}---\n\n${body}`);
}

/** An empty entry to fill in by hand when the search found nothing. */
export function manualResult(title: string): BookSearchResult {
  return {
    source: "openlibrary",
    sourceId: "",
    title: title.trim() || "New book",
    authors: [],
    categories: [],
    coverUrls: [],
  };
}

/** Section headings of a book note. */
export const SECTIONS = {
  description: "Description",
  notes: "Notes",
  quotes: "Quotes",
  thoughts: "Thoughts",
};

export const DESCRIPTION_PLACEHOLDER = "_No description._";
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
}

/** Whether any note other than `exceptSource` uses the file. */
export function isReferenced(app: App, target: TFile, exceptSource?: string): boolean {
  const links = app.metadataCache.resolvedLinks;
  for (const source in links) {
    if (source !== exceptSource && links[source][target.path]) return true;
  }
  return getBooks(app).some(
    (b) => b.file.path !== exceptSource && resolveCover(app, b)?.path === target.path
  );
}

/** The plugin only deletes covers in its own folder, never other images in the vault. */
export function isManagedCover(settings: ShelfmarkSettings, file: TFile): boolean {
  const folder = coversFolder(settings);
  return !folder || file.path.startsWith(`${folder}/`);
}

export async function trashCoverIfUnused(
  app: App,
  settings: ShelfmarkSettings,
  cover: TFile,
  exceptSource?: string
): Promise<boolean> {
  if (!isManagedCover(settings, cover) || !app.vault.getAbstractFileByPath(cover.path)) return false;
  if (isReferenced(app, cover, exceptSource)) return false;
  await app.fileManager.trashFile(cover);
  return true;
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

export function findOrphanCovers(app: App, settings: ShelfmarkSettings): TFile[] {
  return app.vault
    .getFiles()
    .filter(
      (f) =>
        IMAGE_EXTENSIONS.has(f.extension.toLowerCase()) &&
        isManagedCover(settings, f) &&
        f.path.startsWith(`${coversFolder(settings)}/`) &&
        !isReferenced(app, f)
    );
}

/** Replaces the cover: saves the new file, updates the property and the embed, cleans up the old file. */
export async function replaceCover(
  app: App,
  settings: ShelfmarkSettings,
  file: TFile,
  image: ImageData
): Promise<void> {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  const old = resolveCoverLink(app, fm?.cover, file.path);
  const path = await saveCover(app, settings, image, sanitizeFileName(file.basename));

  await app.fileManager.processFrontMatter(file, (f) => {
    f.cover = coverLink(path);
  });
  await app.vault.process(file, (text) => {
    if (old) {
      const replaced = text.split(`![[${old.path}`).join(`![[${path}`).split(`![[${old.name}`).join(`![[${path}`);
      if (replaced !== text) return replaced;
    }
    // The panel shows the cover itself, so it is embedded only in notes without a panel.
    if (hasPanel(text)) return text;
    const match = text.match(FRONTMATTER_RE);
    const at = match ? match[0].length : 0;
    return `${text.slice(0, at)}\n${coverEmbed(path)}\n${text.slice(at)}`;
  });

  if (old) {
    // The link cache refreshes shortly after the note is saved.
    window.setTimeout(() => void trashCoverIfUnused(app, settings, old), 1000);
  }
}

/**
 * Fills in missing book data from a search result. Leaves the user's fields alone
 * (status, rating, dates, notes); the average rating and its count are always updated.
 * Returns the names of the changed fields.
 */
export async function refreshMetadata(
  app: App,
  settings: ShelfmarkSettings,
  file: TFile,
  r: BookSearchResult
): Promise<string[]> {
  const changed: string[] = [];
  const fillIfEmpty: Record<string, unknown> = {
    subtitle: r.subtitle,
    original_title: r.originalTitle,
    author: r.authors.length ? r.authors : undefined,
    translator: r.translators?.length ? r.translators : undefined,
    publisher: r.publisher,
    published: r.publishedDate,
    pages: r.pages,
    language: r.language,
    isbn13: r.isbn13,
    isbn10: r.isbn10,
    categories: r.categories.length ? r.categories : undefined,
    source: r.infoUrl,
  };
  const overwrite: Record<string, unknown> = {
    avg_rating: r.averageRating,
    ratings_count: r.ratingsCount,
  };

  await app.fileManager.processFrontMatter(file, (fm) => {
    for (const [key, value] of Object.entries(fillIfEmpty)) {
      if (!isEmpty(value) && isEmpty(fm[key])) {
        fm[key] = value;
        changed.push(key);
      }
    }
    for (const [key, value] of Object.entries(overwrite)) {
      if (!isEmpty(value) && fm[key] !== value) {
        fm[key] = value;
        changed.push(key);
      }
    }
  });

  if (r.description) {
    const description = htmlToMarkdown(r.description).trim();
    let replaced = false;
    await app.vault.process(file, (text) => {
      if (!text.includes(DESCRIPTION_PLACEHOLDER)) return text;
      replaced = true;
      return text.replace(DESCRIPTION_PLACEHOLDER, description);
    });
    if (replaced) changed.push("description");
  }

  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (settings.downloadCovers && !resolveCoverLink(app, fm?.cover, file.path)) {
    const image = await fetchImage(r.coverUrls);
    if (image) {
      await replaceCover(app, settings, file, image);
      changed.push("cover");
    }
  }
  return changed;
}

/** Converts covers stored as a plain path (version 0.1) into links. */
export async function migrateCoverLinks(app: App): Promise<number> {
  let count = 0;
  for (const book of getBooks(app)) {
    const raw = app.metadataCache.getFileCache(book.file)?.frontmatter?.cover;
    if (typeof raw !== "string" || !raw || raw.startsWith("[[")) continue;
    const cover = resolveCoverLink(app, raw, book.file.path);
    if (!cover) continue;
    await app.fileManager.processFrontMatter(book.file, (fm) => {
      fm.cover = coverLink(cover.path);
    });
    count++;
  }
  return count;
}

/**
 * Inserts a block at the end of the section with the given heading (before the next heading
 * of the same or higher level). If the section is missing, appends it to the end of the note.
 */
export function insertIntoSection(text: string, heading: string, block: string): string {
  const lines = text.split("\n");
  const target = heading.toLocaleLowerCase();
  const start = lines.findIndex(
    (l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s+/, "").trim().toLocaleLowerCase() === target
  );
  if (start === -1) return `${text.trimEnd()}\n\n## ${heading}\n\n${block}\n`;

  const level = (lines[start].match(/^#+/) ?? ["##"])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  const after = lines.slice(end);
  return [...lines.slice(0, insertAt), "", block, "", ...after].join("\n");
}

export type EntryKind = "quote" | "note" | "thought";

export interface Entry {
  kind: EntryKind;
  text: string;
  page?: number;
  /** A comment below the quote. */
  comment?: string;
}

const ENTRY_SECTIONS: Record<EntryKind, string> = { quote: SECTIONS.quotes, note: SECTIONS.notes, thought: SECTIONS.thoughts };

/** Appends a quote, note or thought as a callout at the end of the matching section of the book note. */
export async function addEntry(app: App, file: TFile, entry: Entry): Promise<void> {
  const page = entry.page ? `p. ${entry.page}` : "";
  const title = entry.kind === "quote" ? page : [formatDate(Date.now()), page].filter(Boolean).join(" · ");
  const body = entry.text.trim().split("\n").map((l) => `> ${l}`);
  let block = [`> [!${entry.kind}]${title ? ` ${title}` : ""}`, ...body].join("\n");
  if (entry.comment?.trim()) block += `\n\n${entry.comment.trim()}`;
  await app.vault.process(file, (text) => insertIntoSection(text, ENTRY_SECTIONS[entry.kind], block));
}

/** The code block where a book note shows the panel with the cover and buttons. */
export const PANEL_BLOCK = "```shelfmark\n```";

export function hasPanel(text: string): boolean {
  return /^```shelfmark\s*$/m.test(text);
}

/**
 * Adds the panel to book notes that don't have one (made before version 0.4, or by hand).
 * A cover embed added by the plugin is replaced by the panel, because the panel shows the cover.
 */
export async function migratePanels(app: App): Promise<number> {
  let count = 0;
  for (const book of getBooks(app)) {
    const cover = resolveCover(app, book);
    let changed = false;
    await app.vault.process(book.file, (text) => {
      if (hasPanel(text)) return text;
      changed = true;
      if (cover) {
        const embed = new RegExp(`^!\\[\\[(${escapeRe(cover.path)}|${escapeRe(cover.name)})\\|180\\]\\]$`, "m");
        if (embed.test(text)) return text.replace(embed, PANEL_BLOCK);
      }
      const match = text.match(FRONTMATTER_RE);
      const at = match ? match[0].length : 0;
      return `${text.slice(0, at)}\n${PANEL_BLOCK}\n${text.slice(at)}`;
    });
    if (changed) count++;
  }
  return count;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Volumes of a series in the library, sorted by volume number. */
export function seriesBooks(app: App, series: string): BookEntry[] {
  return getBooks(app)
    .filter((b) => b.series === series)
    .sort((a, b) => (a.seriesIndex ?? Infinity) - (b.seriesIndex ?? Infinity) || a.title.localeCompare(b.title));
}

/** Volume numbers missing between the first and the last volume in the library. */
export function missingVolumes(books: BookEntry[]): number[] {
  const have = new Set(books.map((b) => b.seriesIndex).filter((n): n is number => !!n && Number.isInteger(n)));
  if (!have.size) return [];
  const missing: number[] = [];
  for (let i = 1; i <= Math.max(...have); i++) if (!have.has(i)) missing.push(i);
  return missing;
}

export function allSeries(app: App): string[] {
  return [...new Set(getBooks(app).map((b) => b.series).filter((s): s is string => !!s))].sort((a, b) =>
    a.localeCompare(b)
  );
}

/** The reading queue in position order. */
export function getQueue(app: App): BookEntry[] {
  return getBooks(app)
    .filter((b) => b.queue !== undefined)
    .sort((a, b) => (a.queue ?? 0) - (b.queue ?? 0) || a.title.localeCompare(b.title));
}

/** Saves the queue in the given order (positions 1..n); books not on the list leave it. */
export async function saveQueue(app: App, files: TFile[]): Promise<void> {
  const order = new Map(files.map((f, i) => [f.path, i + 1]));
  for (const book of getQueue(app)) {
    if (!order.has(book.file.path)) {
      await app.fileManager.processFrontMatter(book.file, (fm) => {
        delete fm.queue;
      });
    }
  }
  for (const file of files) {
    const position = order.get(file.path);
    const current = app.metadataCache.getFileCache(file)?.frontmatter?.queue;
    if (current === position) continue;
    await app.fileManager.processFrontMatter(file, (fm) => {
      fm.queue = position;
    });
  }
}

export async function addToQueue(app: App, file: TFile, first = false): Promise<void> {
  const files = getQueue(app).map((b) => b.file).filter((f) => f.path !== file.path);
  await saveQueue(app, first ? [file, ...files] : [...files, file]);
}

export async function removeFromQueue(app: App, file: TFile): Promise<void> {
  await saveQueue(app, getQueue(app).map((b) => b.file).filter((f) => f.path !== file.path));
}

/** A Google Shopping search link: by ISBN, or by title and author without one. */
export function priceSearchUrl(book: BookEntry): string {
  const q = book.isbn13 ?? [book.title, book.authors[0]].filter(Boolean).join(" ");
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q)}`;
}

/** A wishlist note to send to family and friends (or print as PDF). */
export async function exportWishlist(app: App, settings: ShelfmarkSettings): Promise<TFile> {
  const wished = getBooks(app)
    .filter((b) => !b.owned && (!b.status || b.status === "to read"))
    .sort(
      (a, b) =>
        Number(b.gift) - Number(a.gift) ||
        wishPriorityRank(a.wishPriority) - wishPriorityRank(b.wishPriority) ||
        a.title.localeCompare(b.title)
    );

  const line = (b: BookEntry) => {
    const parts = [`**${b.title}**`];
    if (b.authors.length) parts.push(b.authors.join(", "));
    const meta = [b.isbn13 ? `ISBN ${b.isbn13}` : "", b.price ? `about ${formatPrice(b.price, settings)}` : ""].filter(Boolean);
    let text = `- ${parts.join(" — ")}${meta.length ? ` (${meta.join(", ")})` : ""}`;
    if (b.shopUrl) text += ` · [where to buy](${b.shopUrl})`;
    return text;
  };

  const sections: string[] = [`# Wishlist`, "", `_As of ${formatDate(Date.now())}_`, ""];
  const gifts = wished.filter((b) => b.gift);
  if (gifts.length) sections.push("## 🎁 Gift ideas", "", ...gifts.map(line), "");
  for (const p of WISH_PRIORITIES) {
    const list = wished.filter((b) => !b.gift && b.wishPriority === p.id);
    if (list.length) sections.push(`## ${p.label}`, "", ...list.map(line), "");
  }
  const rest = wished.filter((b) => !b.gift && wishPriorityRank(b.wishPriority) === WISH_PRIORITIES.length);
  // An "Other" heading only makes sense when there are other groups above it.
  if (rest.length) sections.push(rest.length < wished.length ? "## Other" : "## Books", "", ...rest.map(line), "");

  const path = normalizePath(`${libraryFolder(settings) ? `${libraryFolder(settings)}/` : ""}Wishlist.md`);
  const content = sections.join("\n");
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
    return existing;
  }
  return app.vault.create(path, content);
}
