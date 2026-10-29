import { App, Modal, Notice, Setting } from "obsidian";
import type ShelfmarkPlugin from "../main";
import { addEntry, type EntryKind } from "../library";
import type { BookEntry } from "../types";

const KINDS: Record<EntryKind, { label: string; placeholder: string; saved: string }> = {
  note: { label: "Note", placeholder: "Your note", saved: "Note saved." },
  quote: { label: "Quote", placeholder: "The quote", saved: "Quote saved." },
  thought: { label: "Thought", placeholder: "What do you think of this book?", saved: "Thought saved." },
};

/** A quick entry in the book note: a note, quote or thought, each in its own section. */
export class EntryModal extends Modal {
  private textEl!: HTMLTextAreaElement;
  private commentEl!: HTMLTextAreaElement;
  private tabs: Partial<Record<EntryKind, HTMLElement>> = {};

  constructor(
    app: App,
    private plugin: ShelfmarkPlugin,
    private book: BookEntry,
    private kind: EntryKind
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("shelfmark-entry-modal");
    this.titleEl.setText(this.book.title);

    const switcher = this.contentEl.createDiv("shelfmark-segmented");
    for (const kind of ["note", "quote", "thought"] as EntryKind[]) {
      const tab = switcher.createEl("button", { text: KINDS[kind].label });
      tab.addEventListener("click", () => this.setKind(kind));
      this.tabs[kind] = tab;
    }

    this.textEl = this.contentEl.createEl("textarea", {
      cls: "shelfmark-entry-text",
      attr: { rows: "5" },
    });

    let page = this.book.currentPage;
    new Setting(this.contentEl).setName("Page").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.inputMode = "numeric";
      if (page) t.setValue(String(page));
      t.onChange((v) => (page = Number(v) > 0 ? Math.round(Number(v)) : undefined));
    });

    this.commentEl = this.contentEl.createEl("textarea", {
      cls: "shelfmark-entry-comment",
      attr: { placeholder: "Your comment on the quote (optional)", rows: "2" },
    });

    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText("Save")
        .setCta()
        .onClick(async () => {
          if (!this.textEl.value.trim()) {
            new Notice("Write something first.");
            return;
          }
          const kind = this.kind;
          this.close();
          await addEntry(this.app, this.book.file, {
            kind,
            text: this.textEl.value,
            page,
            comment: kind === "quote" ? this.commentEl.value : undefined,
          });
          // An entry from a later page also moves reading progress forward.
          if (page && this.book.status === "reading" && page > (this.book.currentPage ?? 0)) {
            await this.plugin.setProgress(this.book.file, page);
          }
          new Notice(KINDS[kind].saved);
        })
    );

    this.setKind(this.kind);
    window.setTimeout(() => this.textEl.focus(), 0);
  }

  private setKind(kind: EntryKind): void {
    this.kind = kind;
    for (const [k, tab] of Object.entries(this.tabs)) tab?.toggleClass("is-active", k === kind);
    this.textEl.placeholder = KINDS[kind].placeholder;
    this.commentEl.toggle(kind === "quote");
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
