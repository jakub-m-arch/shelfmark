import { App, Modal, setIcon } from "obsidian";
import { getQueue, resolveCover, saveQueue } from "../library";
import type { BookEntry } from "../types";
import { BookSuggestModal } from "./BookSuggestModal";

/**
 * Arranging the reading queue. On desktop rows can be dragged; on mobile
 * (where HTML drag and drop doesn't work) the arrows do the job.
 */
export class QueueModal extends Modal {
  private books: BookEntry[] = [];
  private listEl!: HTMLElement;
  private dragIndex = -1;

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("shelfmark-queue-modal");
    this.titleEl.setText("Reading queue");
    this.books = getQueue(this.app);
    this.listEl = this.contentEl.createDiv("shelfmark-queue-list");

    const footer = this.contentEl.createDiv("shelfmark-queue-footer");
    const add = footer.createEl("button", { cls: "shelfmark-panel-btn" });
    setIcon(add.createSpan(), "plus");
    add.createSpan({ text: "Add book" });
    add.addEventListener("click", () => {
      new BookSuggestModal(this.app, (book) => {
        if (this.books.some((b) => b.file.path === book.file.path)) return;
        this.books.push(book);
        void this.save();
      }).open();
    });

    this.renderList();
  }

  private renderList(): void {
    this.listEl.empty();
    if (!this.books.length) {
      this.listEl.createDiv({
        cls: "shelfmark-empty",
        text: "The queue is empty. Add books here or via ⋯ → Add to reading queue.",
      });
      return;
    }

    this.books.forEach((book, i) => {
      const row = this.listEl.createDiv({ cls: "shelfmark-queue-row", attr: { draggable: "true" } });
      setIcon(row.createSpan("shelfmark-queue-grip"), "grip-vertical");
      row.createSpan({ cls: "shelfmark-queue-pos", text: String(i + 1) });

      const thumb = row.createDiv("shelfmark-row-thumb");
      const cover = resolveCover(this.app, book);
      if (cover) thumb.createEl("img", { attr: { src: this.app.vault.getResourcePath(cover) } });

      const info = row.createDiv("shelfmark-row-main");
      info.createDiv({ cls: "shelfmark-row-title", text: book.title });
      if (book.authors.length) info.createDiv({ cls: "shelfmark-card-author", text: book.authors.join(", ") });

      const tools = row.createDiv("shelfmark-queue-tools");
      this.tool(tools, "arrow-up", "Move up", i === 0, () => this.move(i, i - 1));
      this.tool(tools, "arrow-down", "Move down", i === this.books.length - 1, () => this.move(i, i + 1));
      this.tool(tools, "x", "Remove from queue", false, () => {
        this.books.splice(i, 1);
        void this.save();
      });

      row.addEventListener("dragstart", (e) => {
        this.dragIndex = i;
        row.addClass("is-dragging");
        e.dataTransfer?.setData("text/plain", String(i));
      });
      row.addEventListener("dragend", () => row.removeClass("is-dragging"));
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        row.addClass("is-drop-target");
      });
      row.addEventListener("dragleave", () => row.removeClass("is-drop-target"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.removeClass("is-drop-target");
        if (this.dragIndex >= 0 && this.dragIndex !== i) this.move(this.dragIndex, i);
        this.dragIndex = -1;
      });
    });
  }

  private tool(parent: HTMLElement, icon: string, label: string, disabled: boolean, run: () => void): void {
    const btn = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
    setIcon(btn, icon);
    btn.disabled = disabled;
    btn.addEventListener("click", run);
  }

  private move(from: number, to: number): void {
    const [book] = this.books.splice(from, 1);
    this.books.splice(to, 0, book);
    void this.save();
  }

  private async save(): Promise<void> {
    this.renderList();
    await saveQueue(this.app, this.books.map((b) => b.file));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
