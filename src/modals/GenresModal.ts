import { App, Modal, Notice, setIcon } from "obsidian";
import type ShelfmarkPlugin from "../main";
import { applyGenreChange, buildGenresPrompt, parseGenres, type GenreChange } from "../aiGenres";
import type { ClaudeRun } from "../claude";

/** Reviews Claude's proposals: genres and series reach the notes only once checked and approved. */
export class GenresModal extends Modal {
  private statusEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private footerEl!: HTMLElement;
  private run: ClaudeRun | null = null;
  private changes: GenreChange[] = [];
  private genresOn = new Set<GenreChange>();
  private seriesOn = new Set<GenreChange>();

  constructor(app: App, private plugin: ShelfmarkPlugin) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("shelfmark-genres-modal");
    this.titleEl.setText("Tidy up genres");
    this.statusEl = this.contentEl.createDiv("shelfmark-suggest-status");
    this.bodyEl = this.contentEl.createDiv("shelfmark-genres-body");
    this.footerEl = this.contentEl.createDiv("shelfmark-pick-bar");
    void this.ask();
  }

  private async ask(): Promise<void> {
    this.statusEl.setText("Claude is reviewing the genres in your library (a large library can take a few minutes)…");
    const stop = this.footerEl.createEl("button", { text: "Stop" });
    stop.addEventListener("click", () => this.run?.abort());
    try {
      const { prompt, books } = await buildGenresPrompt(this.app, this.plugin.settings);
      this.run = this.plugin.startClaude(prompt);
      if (!this.run) return this.close();
      const proposal = parseGenres(await this.run.result, books);
      this.changes = proposal.changes;
      this.genresOn = new Set(this.changes.filter((c) => c.after !== c.before));
      this.seriesOn = new Set(this.changes.filter((c) => c.series));
      this.render(proposal.vocabulary);
    } catch (e) {
      this.statusEl.setText(e instanceof Error ? e.message : String(e));
      this.footerEl.empty();
    } finally {
      this.run = null;
    }
  }

  private render(vocabulary: string[]): void {
    this.footerEl.empty();
    if (!this.changes.length) {
      this.statusEl.setText("Genres are already tidy. Nothing to change.");
      return;
    }
    this.statusEl.setText(`Proposed changes: ${this.changes.length}. Uncheck what you don't want.`);

    const vocab = this.bodyEl.createDiv("shelfmark-genres-vocab");
    // Claude can be generous with the vocabulary; show only genres that some book received.
    const used = new Set(this.changes.flatMap((c) => c.after));
    for (const g of vocabulary.filter((g) => used.has(g))) vocab.createSpan({ cls: "shelfmark-suggest-kind", text: g });

    const list = this.bodyEl.createDiv("shelfmark-genres-list");
    for (const c of this.changes) {
      const row = list.createDiv("shelfmark-genres-row");
      row.createDiv({ cls: "shelfmark-row-title", text: c.book.title });
      if (c.book.authors.length) row.createDiv({ cls: "shelfmark-card-author", text: c.book.authors.join(", ") });
      if (c.after !== c.before) {
        this.option(row, this.genresOn, c, (line) => {
          line.createSpan({ cls: "shelfmark-genres-before", text: c.before.join(", ") || "no genres" });
          setIcon(line.createSpan("shelfmark-genres-arrow"), "arrow-right");
          line.createSpan({ text: c.after.join(", ") });
        });
      }
      if (c.series) {
        this.option(row, this.seriesOn, c, (line) => {
          line.createSpan({ text: `Series: ${c.series}${c.seriesIndex ? ` #${c.seriesIndex}` : ""}` });
        });
      }
    }

    const apply = this.footerEl.createEl("button", { cls: "mod-cta", text: "Apply selected" });
    apply.addEventListener("click", () => void this.apply(apply));
  }

  private option(row: HTMLElement, set: Set<GenreChange>, c: GenreChange, fill: (line: HTMLElement) => void): void {
    const line = row.createEl("label", { cls: "shelfmark-genres-option" });
    const box = line.createEl("input", { type: "checkbox" });
    box.checked = set.has(c);
    box.addEventListener("change", () => (box.checked ? set.add(c) : set.delete(c)));
    fill(line.createSpan());
  }

  private async apply(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    btn.setText("Saving…");
    let count = 0;
    for (const c of this.changes) {
      const genres = this.genresOn.has(c);
      const series = this.seriesOn.has(c);
      if (!genres && !series) continue;
      await applyGenreChange(this.app, genres ? c : { ...c, after: c.before }, series);
      count++;
    }
    new Notice(count ? `Books updated: ${count}.` : "Nothing changed.");
    this.close();
  }

  onClose(): void {
    this.run?.abort();
    this.contentEl.empty();
  }
}
