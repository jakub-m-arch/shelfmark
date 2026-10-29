import { App, Modal, Notice, moment } from "obsidian";
import { getBooks, resolveCover } from "../library";
import { MONTH_NAMES, formatReadDate, parseReadDate, readDateValue, setReadDate } from "../readDates";
import type { BookEntry } from "../types";

/** A book whose read date is probably accidental: no date, or the day it was added to the library. */
function needsCheck(book: BookEntry): boolean {
  return !book.finished || book.finished === moment(book.added).format("YYYY-MM-DD");
}

interface Edit {
  year?: number;
  month?: number;
}

/**
 * Filling in read dates in bulk, e.g. for books read years before the library existed.
 * By default it shows only those whose date looks accidental.
 */
export class ReadDatesModal extends Modal {
  private edits = new Map<BookEntry, Edit>();
  private showAll = false;
  private query = "";
  private listEl!: HTMLElement;
  private saveBtn!: HTMLButtonElement;

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("shelfmark-genres-modal", "shelfmark-dates-modal");
    this.titleEl.setText("When did you read them?");
    this.contentEl.createDiv({
      cls: "shelfmark-suggest-status",
      text: "Enter the year (and month, if you remember). An empty field leaves the date unchanged.",
    });

    const bar = this.contentEl.createDiv("shelfmark-dates-bar");
    const search = bar.createEl("input", { type: "search", placeholder: "Search title or author…" });
    search.addEventListener("input", () => {
      this.query = search.value.trim().toLocaleLowerCase();
      this.renderList();
    });
    const toggle = bar.createEl("label", { cls: "shelfmark-genres-option" });
    const box = toggle.createEl("input", { type: "checkbox" });
    toggle.createSpan({ text: "All read books" });
    box.addEventListener("change", () => {
      this.showAll = box.checked;
      this.renderList();
    });

    this.listEl = this.contentEl.createDiv("shelfmark-genres-list");
    const footer = this.contentEl.createDiv("shelfmark-pick-bar");
    this.saveBtn = footer.createEl("button", { cls: "mod-cta" });
    this.saveBtn.addEventListener("click", () => void this.save());
    this.renderList();
  }

  private books(): BookEntry[] {
    const cmp = (a: string, b: string) => a.localeCompare(b);
    return getBooks(this.app)
      .filter((b) => b.status === "read" && (this.showAll || needsCheck(b)))
      .filter((b) => !this.query || [b.title, ...b.authors].some((s) => s.toLocaleLowerCase().includes(this.query)))
      .sort((a, b) => cmp(a.authors[0] ?? "", b.authors[0] ?? "") || cmp(a.title, b.title));
  }

  private renderList(): void {
    this.listEl.empty();
    const books = this.books();
    if (!books.length) {
      this.listEl.createDiv({
        cls: "shelfmark-empty",
        text: this.showAll || this.query ? "No books." : "All read books have dates. Check “All read books” to correct them.",
      });
    }
    for (const book of books) {
      const row = this.listEl.createDiv("shelfmark-dates-row");
      const thumb = row.createDiv("shelfmark-row-thumb");
      const cover = resolveCover(this.app, book);
      if (cover) thumb.createEl("img", { attr: { src: this.app.vault.getResourcePath(cover) } });

      const info = row.createDiv("shelfmark-row-main");
      info.createDiv({ cls: "shelfmark-row-title", text: book.title });
      info.createDiv({
        cls: "shelfmark-card-author",
        text: [book.authors.join(", "), book.finished ? `now: ${formatReadDate(book.finished)}` : "no date"]
          .filter(Boolean)
          .join(" · "),
      });

      const edit = this.edits.get(book) ?? {};
      const current = parseReadDate(book.finished);
      const year = row.createEl("input", {
        cls: "shelfmark-dates-year",
        type: "number",
        attr: { placeholder: "year", inputmode: "numeric", min: "1900", max: String(moment().year()) },
      });
      if (edit.year) year.value = String(edit.year);
      const month = row.createEl("select", { cls: "dropdown shelfmark-dates-month" });
      month.createEl("option", { value: "", text: "month" });
      MONTH_NAMES.forEach((m, i) => month.createEl("option", { value: String(i + 1), text: m }));
      month.value = edit.month ? String(edit.month) : "";

      const update = () => {
        const y = Math.round(Number(year.value));
        const valid = y > 1900 && y <= moment().year();
        year.toggleClass("is-invalid", !!year.value && !valid);
        if (!valid && !month.value) this.edits.delete(book);
        else this.edits.set(book, { year: valid ? y : current.year, month: month.value ? Number(month.value) : undefined });
        this.updateSave();
      };
      year.addEventListener("input", update);
      month.addEventListener("change", update);
    }
    this.updateSave();
  }

  private updateSave(): void {
    const count = [...this.edits.values()].filter((e) => e.year).length;
    this.saveBtn.setText(count ? `Save changes (${count})` : "Save changes");
    this.saveBtn.disabled = !count;
  }

  private async save(): Promise<void> {
    const edits = [...this.edits.entries()].filter(([, e]) => e.year);
    this.saveBtn.disabled = true;
    for (const [book, e] of edits) await setReadDate(this.app, book.file, readDateValue(e));
    new Notice(`Read dates saved: ${edits.length}.`);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
