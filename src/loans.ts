import { App, TFile, moment } from "obsidian";
import { formatDate } from "./format";
import { addEntry, getBooks } from "./library";
import type { BookEntry } from "./types";

/*
 * Loans in both directions: who I lent my book to ("lent_*") and who I borrowed someone else's
 * book from ("borrowed_*"). Once returned, the data leaves the properties and a trace stays in the notes.
 */

export type LoanDirection = "lent" | "borrowed";

export interface Loan {
  book: BookEntry;
  direction: LoanDirection;
  person: string;
  since?: string;
  returnBy?: string;
}

/** After this many days a lent book has been "away for a long time". */
export const LONG_LOAN_DAYS = 60;

export function bookLoan(book: BookEntry): Loan | undefined {
  if (book.lentTo) return { book, direction: "lent", person: book.lentTo, since: book.lentOn };
  if (book.borrowedFrom) {
    return { book, direction: "borrowed", person: book.borrowedFrom, since: book.borrowedOn, returnBy: book.returnBy };
  }
  return undefined;
}

export function getLoans(app: App): Loan[] {
  return getBooks(app)
    .map(bookLoan)
    .filter((l): l is Loan => !!l)
    .sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""));
}

export function loanDays(loan: Loan): number | undefined {
  return loan.since ? moment().startOf("day").diff(moment(loan.since), "days") : undefined;
}

/** Whether a loan needs attention: past its due date, or my book has been away for very long. */
export function isOverdue(loan: Loan): boolean {
  if (loan.returnBy) return moment(loan.returnBy).isBefore(moment().startOf("day"));
  return loan.direction === "lent" && (loanDays(loan) ?? 0) > LONG_LOAN_DAYS;
}

/** Summary shown in the library and the book panel. */
export function loanSummary(loan: Loan): string {
  const days = loanDays(loan);
  const parts = [loan.direction === "lent" ? `Lent to ${loan.person}` : `Borrowed from ${loan.person}`];
  if (loan.since) parts.push(`since ${formatDate(loan.since)}${days ? ` (${daysLabel(days)})` : ""}`);
  if (loan.returnBy) parts.push(`due ${formatDate(loan.returnBy)}`);
  return parts.join(" · ");
}

export function daysLabel(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

/** People from earlier loans, suggested in the "To whom" field. */
export function knownPeople(app: App): string[] {
  const people = new Set<string>();
  for (const b of getBooks(app)) {
    if (b.lentTo) people.add(b.lentTo);
    if (b.borrowedFrom) people.add(b.borrowedFrom);
  }
  return [...people].sort((a, b) => a.localeCompare(b));
}

export interface LoanInput {
  person: string;
  since: string;
  returnBy?: string;
}

export async function startLoan(app: App, file: TFile, direction: LoanDirection, input: LoanInput): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    for (const key of ["lent_to", "lent_on", "borrowed_from", "borrowed_on", "return_by"]) delete fm[key];
    if (direction === "lent") {
      fm.lent_to = input.person;
      fm.lent_on = input.since;
    } else {
      fm.borrowed_from = input.person;
      fm.borrowed_on = input.since;
    }
    if (input.returnBy) fm.return_by = input.returnBy;
  });
}

/** Ends the loan and records in the notes who had the book and for how long. */
export async function endLoan(app: App, loan: Loan): Promise<void> {
  await app.fileManager.processFrontMatter(loan.book.file, (fm) => {
    for (const key of ["lent_to", "lent_on", "borrowed_from", "borrowed_on", "return_by"]) delete fm[key];
  });
  const range = [loan.since ? formatDate(loan.since) : "", formatDate(Date.now())].filter(Boolean).join(" – ");
  const text =
    loan.direction === "lent"
      ? `Lent to ${loan.person} (${range}). Returned.`
      : `Borrowed from ${loan.person} (${range}). Given back.`;
  await addEntry(app, loan.book.file, { kind: "note", text });
}
