import { App, TFile, moment } from "obsidian";
import { formatDate } from "./format";

/*
 * The date a book was finished is often approximate: books read years ago are remembered by
 * year or month, not by day. The `finished` property can therefore be "2015", "2015-06" or
 * "2015-06-12". An empty value with the "read" status means "I don't remember when".
 */

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface ReadDate {
  year?: number;
  /** 1–12 */
  month?: number;
  day?: number;
}

export function parseReadDate(value: string | undefined): ReadDate {
  const m = value?.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
  if (!m) return {};
  return { year: Number(m[1]), month: m[2] ? Number(m[2]) : undefined, day: m[3] ? Number(m[3]) : undefined };
}

/** The value to store in the property; undefined when the year is unknown. */
export function readDateValue(d: ReadDate): string | undefined {
  if (!d.year) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (!d.month) return String(d.year);
  if (!d.day) return `${d.year}-${pad(d.month)}`;
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/** "Jun 12, 2015", "June 2015" or "2015". */
export function formatReadDate(value: string | undefined): string {
  const d = parseReadDate(value);
  if (!d.year) return "";
  if (!d.month) return String(d.year);
  if (!d.day) return `${MONTH_NAMES[d.month - 1]} ${d.year}`;
  return formatDate(value);
}

/** Whether the date is complete (with a day), e.g. to count reading days. */
export function isFullDate(value: string | undefined): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value ?? "");
}

/**
 * Marks the book as read at the given time. A start date that would fall after the finish date
 * (e.g. today's, set when the book was marked) is removed, because it would only skew the stats.
 */
export async function setReadDate(app: App, file: TFile, value: string | undefined): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.status = "read";
    delete fm.queue;
    fm.finished = value ?? null;
    const started = fm.started ? String(fm.started) : "";
    if (started && (!value || started.slice(0, value.length) > value)) delete fm.started;
  });
}

/** Years to choose from: the current one and the thirty before it. */
export function recentYears(span = 30): number[] {
  const now = moment().year();
  return Array.from({ length: span + 1 }, (_, i) => now - i);
}
