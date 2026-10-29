import { App, Modal, Notice, Setting, moment } from "obsidian";
import { today } from "../library";
import { MONTH_NAMES, parseReadDate, readDateValue, setReadDate } from "../readDates";
import type { BookEntry } from "../types";

export type ReadWhen = "today" | "date" | "unknown";

export interface ReadDateState {
  when: ReadWhen;
  year?: number;
  month?: number;
  day?: number;
}

/** The `finished` property value for the state of the "When read" fields. */
export function readDateFromState(s: ReadDateState): string | undefined {
  if (s.when === "today") return today();
  if (s.when === "unknown") return undefined;
  return readDateValue({ year: s.year, month: s.month, day: s.month ? s.day : undefined });
}

/**
 * The "When read" fields: today, a given year (with month and day if you remember them)
 * or "don't remember". Shared by the date dialog and the add-book dialog.
 */
export function renderReadDateFields(parent: HTMLElement, state: ReadDateState): void {
  const when = new Setting(parent).setName("When read");
  const details = parent.createDiv("shelfmark-read-date-details");

  const renderDetails = () => {
    details.empty();
    details.toggle(state.when === "date");
    if (state.when !== "date") return;
    new Setting(details).setName("Year").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.inputMode = "numeric";
      t.setPlaceholder(String(moment().year()));
      if (state.year) t.setValue(String(state.year));
      t.onChange((v) => {
        const y = Math.round(Number(v));
        state.year = y > 1900 && y <= moment().year() ? y : undefined;
      });
      window.setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(details).setName("Month").setDesc("If you remember.").addDropdown((d) => {
      d.addOption("", "—");
      MONTH_NAMES.forEach((m, i) => d.addOption(String(i + 1), m));
      d.setValue(state.month ? String(state.month) : "").onChange((v) => (state.month = v ? Number(v) : undefined));
    });
    new Setting(details).setName("Day").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.inputMode = "numeric";
      if (state.day) t.setValue(String(state.day));
      t.onChange((v) => {
        const d = Math.round(Number(v));
        state.day = d >= 1 && d <= 31 ? d : undefined;
      });
    });
  };

  when.addDropdown((d) => {
    d.addOption("today", "Today");
    d.addOption("date", "Earlier…");
    d.addOption("unknown", "Don't remember");
    d.setValue(state.when).onChange((v) => {
      state.when = v as ReadWhen;
      renderDetails();
    });
  });
  renderDetails();
}

/** Changes the date one book was read (also marks it as read in the past). */
export class ReadDateModal extends Modal {
  constructor(app: App, private book: BookEntry) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(`Read: ${this.book.title}`);
    const current = this.book.status === "read" ? parseReadDate(this.book.finished) : {};
    const state: ReadDateState = current.year
      ? { when: "date", ...current }
      : { when: this.book.status === "read" ? "unknown" : "date" };
    renderReadDateFields(this.contentEl, state);

    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText("Save")
        .setCta()
        .onClick(async () => {
          if (state.when === "date" && !state.year) {
            new Notice("Enter a year or choose “Don't remember”.");
            return;
          }
          this.close();
          await setReadDate(this.app, this.book.file, readDateFromState(state));
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
