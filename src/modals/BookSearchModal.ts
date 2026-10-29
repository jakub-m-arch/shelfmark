import { App, Modal, debounce, setIcon } from "obsidian";
import type ShelfmarkPlugin from "../main";
import { manualResult } from "../library";
import { searchBooks } from "../providers";
import { SOURCE_LABELS, type BookSearchResult } from "../types";
import { AddBookModal } from "./AddBookModal";

export class BookSearchModal extends Modal {
  private inputEl!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private searchToken = 0;

  /**
   * Without `onPick` the chosen result opens the add-book dialog. With `onPick` the modal picks
   * a result for an existing book (cover, data refresh).
   */
  constructor(
    app: App,
    private plugin: ShelfmarkPlugin,
    private initialQuery = "",
    private onPick?: (result: BookSearchResult) => void,
    private heading = "Add book"
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("shelfmark-search-modal");
    this.titleEl.setText(this.heading);

    const bar = this.contentEl.createDiv("shelfmark-search-bar");
    this.inputEl = bar.createEl("input", {
      type: "search",
      placeholder: "Title, author or ISBN",
      value: this.initialQuery,
    });
    if (!this.onPick) {
      const manualBtn = bar.createEl("button", { text: "Add manually" });
      manualBtn.addEventListener("click", () => this.pick(manualResult(this.inputEl.value)));
    }

    this.statusEl = this.contentEl.createDiv("shelfmark-search-status");
    this.resultsEl = this.contentEl.createDiv("shelfmark-search-results");

    const delayed = debounce(() => this.search(), 600, true);
    this.inputEl.addEventListener("input", () => {
      if (this.inputEl.value.trim().length >= 3) delayed();
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        delayed.cancel();
        void this.search();
      }
    });

    this.inputEl.focus();
    if (this.initialQuery) void this.search();
  }

  onClose(): void {
    this.searchToken++;
    this.contentEl.empty();
  }

  private async search(): Promise<void> {
    const query = this.inputEl.value.trim();
    if (!query) return;
    const token = ++this.searchToken;
    this.statusEl.setText("Searching…");
    this.resultsEl.empty();

    const { results, errors } = await searchBooks(query, {
      googleApiKey: this.plugin.settings.googleApiKey,
      usePolishNationalLibrary: this.plugin.settings.usePolishNationalLibrary,
      language: this.plugin.settings.language,
    });
    if (token !== this.searchToken) return;

    const msgs: string[] = [];
    msgs.push(results.length ? `Found: ${results.length}` : "Nothing found.");
    msgs.push(...errors);
    this.statusEl.setText(msgs.join(" · "));
    this.renderResults(results);
  }

  private renderResults(results: BookSearchResult[]): void {
    this.resultsEl.empty();
    for (const r of results) {
      const row = this.resultsEl.createDiv("shelfmark-result");
      const thumb = row.createDiv("shelfmark-result-thumb");
      setIcon(thumb, "book");
      if (r.thumbnailUrl) {
        const img = thumb.createEl("img", { attr: { src: r.thumbnailUrl, loading: "lazy" } });
        img.addEventListener("error", () => img.remove());
      }

      const info = row.createDiv("shelfmark-result-info");
      info.createDiv({ cls: "shelfmark-result-title", text: r.title });
      if (r.subtitle) info.createDiv({ cls: "shelfmark-result-subtitle", text: r.subtitle });
      if (r.authors.length) info.createDiv({ cls: "shelfmark-result-author", text: r.authors.join(", ") });
      const meta = [r.publisher, r.publishedDate?.slice(0, 4), r.pages ? `${r.pages} pp.` : ""]
        .filter(Boolean)
        .join(" · ");
      if (meta) info.createDiv({ cls: "shelfmark-result-meta", text: meta });
      if (r.translators?.length) {
        info.createDiv({ cls: "shelfmark-result-meta", text: `transl. ${r.translators.join(", ")}` });
      }
      info.createSpan({
        cls: "shelfmark-source-badge",
        text: SOURCE_LABELS[r.source],
      });

      row.addEventListener("click", () => this.pick(r));
    }
  }

  private pick(result: BookSearchResult): void {
    this.close();
    if (this.onPick) this.onPick(result);
    else new AddBookModal(this.app, this.plugin, result).open();
  }
}
