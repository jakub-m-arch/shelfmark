import { App, TFile, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import { contentLanguage, formatDate } from "./format";
import { SECTIONS, ensureFolder, getBooks, libraryFolder, today } from "./library";
import { searchBooks, type SearchOptions } from "./providers";
import type { ShelfmarkSettings } from "./settings";
import { statusLabel, type BookEntry, type BookSearchResult } from "./types";

/*
 * Reading profile and book suggestions. Claude gets a summary of the library in the prompt and
 * answers with JSON; the plugin then checks the titles in catalogs and saves the results in the
 * vault (the AI/ folder), so they are visible on mobile too.
 */

export type SuggestionKind = "safe" | "discovery";

export interface Suggestion {
  title: string;
  originalTitle?: string;
  author: string;
  reason: string;
  kind: SuggestionKind;
  /** Books from the library the suggestion is based on. */
  because?: string[];
  /** Whether the book was found in any catalog. */
  verified: boolean;
  cover?: string;
  year?: string;
}

export interface SuggestionsData {
  updated?: string;
  suggestions: Suggestion[];
  /** Rejected suggestions as "Title — Author"; they don\'t come back in later rounds. */
  rejected: string[];
}

const SUGGESTIONS_TYPE = "shelfmark-suggestions";
const PROFILE_TYPE = "shelfmark-profile";
const NOTES_HEADING = "My notes";
const PROFILE_HEADING = "Profile";
const NOTES_HINT =
  "%% Write here what Claude should know about your taste, e.g. “I don't like high fantasy”, “looking for shorter books”. This section is never overwritten. %%";
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

export function aiFolder(settings: ShelfmarkSettings): string {
  const base = libraryFolder(settings);
  return normalizePath(base ? `${base}/AI` : "AI");
}

export function suggestionsPath(settings: ShelfmarkSettings): string {
  return `${aiFolder(settings)}/Suggestions.md`;
}

export function profilePath(settings: ShelfmarkSettings): string {
  return `${aiFolder(settings)}/Reading profile.md`;
}

/** Compares titles and names ignoring case, diacritics and punctuation. */
export function norm(s: string): string {
  return s
    .toLocaleLowerCase()
    // Unlike other diacritics, the Polish l with stroke (U+0142) doesn't decompose under NFD.
    .replace(/\u0142/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function suggestionKey(s: Pick<Suggestion, "title" | "author">): string {
  return `${s.title} — ${s.author}`;
}

function lastName(author: string): string {
  const parts = norm(author).split(" ");
  return parts[parts.length - 1] ?? "";
}

function sameBook(title: string, author: string, otherTitle: string, otherAuthors: string[]): boolean {
  const a = norm(title);
  const b = norm(otherTitle);
  if (!a || !b || !(a === b || a.startsWith(b) || b.startsWith(a))) return false;
  const name = lastName(author);
  return !name || !otherAuthors.length || otherAuthors.some((o) => norm(o).includes(name));
}

export function inLibrary(books: BookEntry[], s: Pick<Suggestion, "title" | "author">): boolean {
  return books.some((b) => sameBook(s.title, s.author, b.title, b.authors));
}

/** Suggestions to show: without rejected ones and those added to the library in the meantime. */
export function visibleSuggestions(app: App, data: SuggestionsData): Suggestion[] {
  const books = getBooks(app);
  const rejected = new Set(data.rejected);
  return data.suggestions.filter((s) => !rejected.has(suggestionKey(s)) && !inLibrary(books, s));
}

function toData(fm: Record<string, unknown> | undefined): SuggestionsData {
  const list = Array.isArray(fm?.suggestions) ? (fm.suggestions as Record<string, unknown>[]) : [];
  return {
    updated: fm?.updated ? String(fm.updated) : undefined,
    suggestions: list
      .filter((s) => s && typeof s.title === "string")
      .map((s) => ({
        title: String(s.title),
        originalTitle: s.originalTitle ? String(s.originalTitle) : undefined,
        author: String(s.author ?? ""),
        reason: String(s.reason ?? ""),
        kind: s.kind === "discovery" ? "discovery" : "safe",
        because: Array.isArray(s.because) ? s.because.map(String) : undefined,
        verified: s.verified !== false,
        cover: s.cover ? String(s.cover) : undefined,
        year: s.year ? String(s.year) : undefined,
      })),
    rejected: Array.isArray(fm?.rejected) ? fm.rejected.map(String) : [],
  };
}

/** A quick read from Obsidian's cache, for drawing the view. */
export function getSuggestions(app: App, settings: ShelfmarkSettings): SuggestionsData | undefined {
  const file = app.vault.getAbstractFileByPath(suggestionsPath(settings));
  if (!(file instanceof TFile)) return undefined;
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  return fm?.type === SUGGESTIONS_TYPE ? toData(fm) : undefined;
}

/** A read straight from the file, before changing it (the cache may lag behind writes). */
async function readSuggestions(app: App, settings: ShelfmarkSettings): Promise<SuggestionsData> {
  const file = app.vault.getAbstractFileByPath(suggestionsPath(settings));
  if (!(file instanceof TFile)) return { suggestions: [], rejected: [] };
  const match = (await app.vault.read(file)).match(FRONTMATTER_RE);
  try {
    return toData(match ? parseYaml(match[1]) : undefined);
  } catch {
    return { suggestions: [], rejected: [] };
  }
}

async function writeFile(app: App, settings: ShelfmarkSettings, path: string, content: string): Promise<TFile> {
  await ensureFolder(app, aiFolder(settings));
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
    return existing;
  }
  return app.vault.create(path, content);
}

/** The whole suggestions file: data in properties, and a readable list in the body (e.g. for mobile). */
async function writeSuggestions(app: App, settings: ShelfmarkSettings, data: SuggestionsData): Promise<void> {
  const fm = {
    type: SUGGESTIONS_TYPE,
    updated: data.updated,
    suggestions: data.suggestions.map((s) => {
      const o: Record<string, unknown> = { ...s };
      for (const key of Object.keys(o)) if (o[key] === undefined) delete o[key];
      return o;
    }),
    rejected: data.rejected,
  };
  const rejected = new Set(data.rejected);
  const lines = ["# Suggestions", "", `_Prepared by Claude${data.updated ? ` on ${formatDate(data.updated)}` : ""}_`, ""];
  for (const s of data.suggestions.filter((s) => !rejected.has(suggestionKey(s)))) {
    lines.push(`- **${s.title}** — ${s.author}${s.kind === "discovery" ? " · _discovery_" : ""}`);
    if (s.reason) lines.push(`  ${s.reason}`);
  }
  await writeFile(app, settings, suggestionsPath(settings), `---\n${stringifyYaml(fm)}---\n\n${lines.join("\n")}\n`);
}

export async function rejectSuggestion(app: App, settings: ShelfmarkSettings, s: Suggestion): Promise<void> {
  const data = await readSuggestions(app, settings);
  const key = suggestionKey(s);
  if (!data.rejected.includes(key)) data.rejected.push(key);
  await writeSuggestions(app, settings, data);
}

/** The content of the section with the given level-two heading (without the heading). */
export function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return "";
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
}

export async function readProfile(app: App, settings: ShelfmarkSettings): Promise<{ notes: string; profile: string }> {
  const file = app.vault.getAbstractFileByPath(profilePath(settings));
  if (!(file instanceof TFile)) return { notes: "", profile: "" };
  const text = await app.vault.read(file);
  return {
    notes: section(text, NOTES_HEADING).replace(/%%[\s\S]*?%%/g, "").trim(),
    profile: section(text, PROFILE_HEADING),
  };
}

async function writeProfile(app: App, settings: ShelfmarkSettings, notes: string, profile: string): Promise<void> {
  const fm = stringifyYaml({ type: PROFILE_TYPE, updated: today() });
  const body = [`## ${NOTES_HEADING}`, "", NOTES_HINT, "", notes, "", `## ${PROFILE_HEADING}`, "", profile.trim(), ""];
  await writeFile(app, settings, profilePath(settings), `---\n${fm}---\n\n${body.join("\n").replace(/\n{3,}/g, "\n\n")}`);
}

const NOTE_SECTIONS = [SECTIONS.thoughts, SECTIONS.notes, SECTIONS.quotes];
const EXCERPT_LIMIT = 600;

/** The reader's own notes from the book note, without callout markers, trimmed. */
export async function excerpt(app: App, book: BookEntry): Promise<string> {
  const text = await app.vault.cachedRead(book.file);
  const parts = NOTE_SECTIONS.map((h) =>
    section(text, h)
      .replace(/^>\s*\[![^\]]+\][^\n]*$/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/\s+/g, " ")
      .trim()
  ).filter(Boolean);
  const joined = parts.join(" / ");
  return joined.length > EXCERPT_LIMIT ? `${joined.slice(0, EXCERPT_LIMIT)}…` : joined;
}

async function libraryContext(app: App): Promise<string> {
  const books = getBooks(app).sort((a, b) => (b.finished ?? "").localeCompare(a.finished ?? "") || b.added - a.added);
  const lines: string[] = [];
  for (const b of books) {
    const meta = [
      statusLabel(b.status).toLocaleLowerCase(),
      b.rating ? `rated ${b.rating}/5` : "",
      b.favorite ? "favorite" : "",
      b.finished && b.status === "read" ? `finished ${b.finished.slice(0, 7)}` : "",
      b.series ? `series: ${b.series}${b.seriesIndex ? ` #${b.seriesIndex}` : ""}` : "",
      b.categories.length ? `genres: ${b.categories.slice(0, 4).join(", ")}` : "",
      !b.owned && b.wishPriority ? `on the wishlist (${b.wishPriority})` : "",
    ].filter(Boolean);
    lines.push(`- ${b.title} — ${b.authors.join(", ") || "unknown author"} | ${meta.join(" | ")}`);
    const notes = b.status && b.status !== "to read" ? await excerpt(app, b) : "";
    if (notes) lines.push(`  Reader's notes: ${notes}`);
  }
  return lines.join("\n");
}

function buildPrompt(
  library: string,
  notes: string,
  previous: string,
  rejected: string[],
  count: number,
  language: string
): string {
  return `You are a literary advisor. Below is one reader's private library with their ratings, statuses
and their own notes. The statuses "Abandoned" and "Won't read" are clear signals of what they dislike;
"To read" is plans, not proof of taste. The reader's notes say more than the ratings alone.

TASK
1. Write a reading profile in ${language} (Markdown, ### subsections, 150–300 words): what they like (genres, themes,
   style, authors), what they avoid, how their taste changed over time, what would be worth asking them about.
   Address the reader directly as "you" and avoid gendered forms.
2. Suggest exactly ${count} books that are NOT in the library or on the rejected list.
   About two thirds should be "safe" (a safe bet), the rest "discovery" (something outside the pattern,
   but well justified). Only books that really exist, have been published, and that you are sure of;
   a well-known title is better than an invented one. Give the title of the ${language} edition only if you know it,
   and always add the original title (original_title). Give the author's full name.
   Reason: 1–2 sentences in ${language}, referring to specific books from the library.

The reader's notes take precedence over your own conclusions.

Answer ONLY with a JSON object, no commentary and no code block:
{"profile": "profile markdown", "suggestions": [{"title": "", "original_title": "", "author": "", "kind": "safe", "reason": "", "because": ["title from the library"]}]}

READER'S NOTES
${notes || "(none)"}

PREVIOUS PROFILE
${previous || "(none)"}

REJECTED SUGGESTIONS
${rejected.length ? rejected.map((r) => `- ${r}`).join("\n") : "(none)"}

LIBRARY
${library || "(empty)"}
`;
}

interface ClaudeAnswer {
  profile: string;
  suggestions: {
    title: string;
    originalTitle?: string;
    author: string;
    kind: SuggestionKind;
    reason: string;
    because?: string[];
  }[];
}

/** The JSON object in Claude's answer, even if it wrote something before or after it. */
export function extractJson(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Claude did not return data in the expected format.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("Claude did not return data in the expected format.");
  }
}

function parseAnswer(text: string): ClaudeAnswer {
  const o = extractJson(text);
  const list = Array.isArray(o.suggestions) ? o.suggestions : [];
  return {
    profile: typeof o.profile === "string" ? o.profile : "",
    suggestions: list
      .filter((s: any) => s && typeof s.title === "string" && s.title.trim())
      .map((s: any) => ({
        title: s.title.trim(),
        originalTitle: typeof s.original_title === "string" && s.original_title.trim() ? s.original_title.trim() : undefined,
        author: String(s.author ?? "").trim(),
        kind: s.kind === "discovery" ? "discovery" : "safe",
        reason: String(s.reason ?? "").trim(),
        because: Array.isArray(s.because) ? s.because.map(String) : undefined,
      }))
      // A suggestion without a reason says nothing, and is often a sign the model was guessing.
      .filter((s: ClaudeAnswer["suggestions"][number]) => s.reason.length > 20 && !/placeholder/i.test(s.reason)),
  };
}

/** Looks the suggestion up in catalogs; Claude can invent a title, a catalog can't. */
async function verify(s: ClaudeAnswer["suggestions"][number], opts: SearchOptions): Promise<Suggestion> {
  let match: BookSearchResult | undefined;
  // The translated title first, then the original: catalogs don't always know the local edition.
  const titles = [...new Set([s.title, s.originalTitle].filter((t): t is string => !!t))];
  for (const title of titles) {
    try {
      const { results } = await searchBooks(`${title} ${s.author}`, opts);
      const matching = results.filter((r) => sameBook(title, s.author, r.title, r.authors));
      const local = matching.filter((r) => !opts.language || r.language === opts.language);
      match = local.find((r) => r.thumbnailUrl) ?? local[0] ?? matching.find((r) => r.thumbnailUrl) ?? matching[0];
    } catch {
      // Without a network, the suggestion stays unverified.
    }
    if (match) break;
  }
  return {
    ...s,
    // No ISBN or publisher: the matched edition may be foreign, and the edition is chosen when adding.
    verified: !!match,
    cover: match?.thumbnailUrl,
    year: match?.publishedDate?.slice(0, 4),
  };
}

/**
 * Picks `count` suggestions: catalog-verified ones first, keeping roughly one third
 * "discoveries". The order stays as Claude set it.
 */
function pick(list: Suggestion[], count: number): Suggestion[] {
  const ranked = [...list].sort((a, b) => Number(b.verified) - Number(a.verified));
  const discoveries = ranked.filter((s) => s.kind === "discovery").slice(0, Math.round(count / 3));
  const chosen = new Set([...discoveries, ...ranked.filter((s) => s.kind === "safe")].slice(0, count));
  for (const s of ranked) if (chosen.size < count) chosen.add(s);
  return list.filter((s) => chosen.has(s));
}

export interface AiRequest {
  prompt: string;
  notes: string;
  rejected: string[];
}

export async function prepareRequest(app: App, settings: ShelfmarkSettings): Promise<AiRequest> {
  const [library, profile, data] = await Promise.all([
    libraryContext(app),
    readProfile(app, settings),
    readSuggestions(app, settings),
  ]);
  return {
    // A few spares in case catalogs don't confirm some titles.
    prompt: buildPrompt(library, profile.notes, profile.profile, data.rejected, settings.aiCount + 4, contentLanguage(settings)),
    notes: profile.notes,
    rejected: data.rejected,
  };
}

/** Saves the profile and verified suggestions; returns how many suggestions were saved. */
export async function saveAnswer(
  app: App,
  settings: ShelfmarkSettings,
  request: AiRequest,
  text: string,
  onStep: (step: string) => void
): Promise<number> {
  const answer = parseAnswer(text);
  const books = getBooks(app);
  const rejected = new Set(request.rejected);
  const fresh = answer.suggestions.filter((s) => !rejected.has(suggestionKey(s)) && !inLibrary(books, s));

  onStep("Checking titles in catalogs…");
  const opts: SearchOptions = {
    googleApiKey: settings.googleApiKey,
    language: settings.language,
    usePolishNationalLibrary: settings.usePolishNationalLibrary,
  };
  const checked = await Promise.all(fresh.map((s) => verify(s, opts)));
  if (answer.profile) await writeProfile(app, settings, request.notes, answer.profile);
  // Rejections made while Claude was thinking count too.
  const { rejected: current } = await readSuggestions(app, settings);
  const kept = pick(checked.filter((s) => !current.includes(suggestionKey(s))), settings.aiCount);
  await writeSuggestions(app, settings, { updated: today(), suggestions: kept, rejected: current });
  return kept.length;
}
