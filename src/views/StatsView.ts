import { ItemView, WorkspaceLeaf, debounce, moment, type ViewStateResult } from "obsidian";
import type ShelfmarkPlugin from "../main";
import { resolveCover } from "../library";
import { daysLabel } from "../loans";
import { booksLabel, formatNumber, readingStats, statsYears, type ReadingStats } from "../stats";
import type { BookEntry } from "../types";

export const VIEW_TYPE_STATS = "shelfmark-stats";

/**
 * Reading stats. The charts have a single series, so all bars use the theme's accent color;
 * numbers and labels always use text colors. Bar details are in the tooltip.
 */
export class StatsView extends ItemView {
  /** null = the whole history. */
  private year: number | null = moment().year();

  constructor(leaf: WorkspaceLeaf, private plugin: ShelfmarkPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_STATS;
  }

  getDisplayText(): string {
    return "Reading stats";
  }

  getIcon(): string {
    return "bar-chart-3";
  }

  getState(): Record<string, unknown> {
    return { year: this.year };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state ?? {}) as { year?: number | null };
    if (s.year === null || typeof s.year === "number") this.year = s.year;
    this.render();
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("shelfmark-view", "shelfmark-stats");
    const refresh = debounce(() => this.render(), 500, true);
    this.registerEvent(this.app.metadataCache.on("changed", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.app.workspace.onLayoutReady(() => this.render());
  }

  private setYear(year: number | null): void {
    this.year = year;
    this.render();
    this.app.workspace.requestSaveLayout();
  }

  render(): void {
    const root = this.contentEl;
    root.empty();

    const years = statsYears(this.app);
    const current = moment().year();
    if (!years.includes(current)) years.unshift(current);
    const bar = root.createDiv("shelfmark-segmented shelfmark-stats-years");
    for (const y of [...years, null]) {
      const btn = bar.createEl("button", { text: y === null ? "All years" : String(y) });
      btn.toggleClass("is-active", y === this.year);
      btn.addEventListener("click", () => this.setYear(y));
    }

    const stats = readingStats(this.app, this.year);
    const help = root.createDiv("shelfmark-stats-help");
    help.createSpan({ text: "Books read long ago show today\'s date? " });
    const link = help.createEl("a", { text: "Fill in dates read" });
    link.addEventListener("click", () => this.plugin.openReadDates());

    if (!stats.read.length) {
      root.createDiv({
        cls: "shelfmark-empty",
        text:
          this.year === null
            ? "No books read yet. Stats appear once you mark the first one as read."
            : `No book has been marked as read in ${this.year} yet.`,
      });
      return;
    }

    this.renderTiles(root, stats);
    this.renderTimeline(root, stats);
    const grid = root.createDiv("shelfmark-stats-grid");
    this.renderRanking(grid, "Authors", stats.authors, (name) => ({ author: name }));
    this.renderRanking(grid, "Genres", stats.genres, (name) => ({ category: name }));
    this.renderRanking(
      grid,
      "Ratings",
      stats.ratings.map((n, i) => ["★".repeat(i + 1), n] as [string, number]).reverse(),
      (label) => ({ rating: label.length >= 3 ? String(label.length) : "" })
    );
    this.renderRanking(grid, "Format", stats.formats, (name) => ({ format: name === "no format" ? "__none__" : name }));
    this.renderHighlights(root, stats);
  }

  private renderTiles(root: HTMLElement, stats: ReadingStats): void {
    const tiles = root.createDiv("shelfmark-stats-tiles");
    const tile = (label: string, value: string, note?: string) => {
      const t = tiles.createDiv("shelfmark-stats-tile");
      t.createDiv({ cls: "shelfmark-stats-tile-value", text: value });
      t.createDiv({ cls: "shelfmark-stats-tile-label", text: label });
      if (note) t.createDiv({ cls: "shelfmark-stats-tile-note", text: note });
    };

    let note: string | undefined;
    if (this.year !== null) {
      const prev = readingStats(this.app, this.year - 1).read.length;
      const goal = this.year === moment().year() ? this.plugin.settings.yearlyGoal : 0;
      const parts = [goal ? `goal: ${goal}` : "", prev ? `${this.year - 1}: ${prev}` : ""].filter(Boolean);
      note = parts.join(" · ") || undefined;
    }
    tile("books read", String(stats.read.length), note);
    tile("pages", formatNumber(stats.pages), stats.avgPages ? `${formatNumber(stats.avgPages)} per book on average` : undefined);
    if (stats.avgRating) tile("average rating", stats.avgRating.toFixed(1), "out of 5 stars");
    if (stats.avgDays) tile("days per book", formatNumber(stats.avgDays), "from start to finish");
    if (stats.abandoned) tile("abandoned", String(stats.abandoned));
  }

  /** Bars per month (or per year); only the highest value is labeled, the rest are in tooltips. */
  private renderTimeline(root: HTMLElement, stats: ReadingStats): void {
    const box = root.createDiv("shelfmark-stats-card");
    box.createDiv({ cls: "shelfmark-section-title", text: this.year === null ? "Books per year" : "Books per month" });
    if (stats.undated) {
      const note = box.createDiv("shelfmark-stats-undated");
      note.createSpan({
        text:
          this.year === null
            ? `No read date: ${booksLabel(stats.undated)}. `
            : `No month: ${booksLabel(stats.undated)} (counted in the year, but not on the chart). `,
      });
      const fix = note.createEl("a", { text: "Fill in dates" });
      fix.addEventListener("click", () => this.plugin.openReadDates());
    }
    const max = Math.max(...stats.timeline.map((t) => t.count), 1);
    const maxIndex = stats.timeline.findIndex((t) => t.count === max);
    const chart = box.createDiv("shelfmark-stats-columns");
    const labels = box.createDiv("shelfmark-stats-column-labels");
    stats.timeline.forEach((t, i) => {
      const col = chart.createDiv({
        cls: "shelfmark-stats-column",
        attr: {
          "aria-label": `${t.full}: ${booksLabel(t.count)}${t.pages ? `, ${formatNumber(t.pages)} pages` : ""}`,
          "data-tooltip-position": "top",
        },
      });
      if (i === maxIndex && t.count) col.createDiv({ cls: "shelfmark-stats-column-value", text: String(t.count) });
      const fill = col.createDiv("shelfmark-stats-column-fill");
      // The tallest bar leaves room for its label.
      fill.style.height = `${(t.count / max) * 85}%`;
      fill.toggleClass("is-zero", !t.count);
      labels.createDiv({ cls: "shelfmark-stats-column-label", text: t.label });
      if (t.filter) {
        col.addClass("is-clickable");
        col.addEventListener("click", () => void this.plugin.openLibraryFiltered({ year: t.filter! }));
      }
    });
  }

  /** A ranking as horizontal bars with the count at the end; clicking filters the library. */
  private renderRanking(
    parent: HTMLElement,
    title: string,
    rows: [string, number][],
    filter: (label: string) => Record<string, string>
  ): void {
    if (!rows.some(([, n]) => n)) return;
    const box = parent.createDiv("shelfmark-stats-card");
    box.createDiv({ cls: "shelfmark-section-title", text: title });
    const max = Math.max(...rows.map(([, n]) => n), 1);
    for (const [label, n] of rows) {
      const row = box.createDiv({ cls: "shelfmark-stats-bar", attr: { "aria-label": `${label}: ${booksLabel(n)}` } });
      row.createDiv({ cls: "shelfmark-stats-bar-label", text: label });
      const track = row.createDiv("shelfmark-stats-bar-track");
      const fill = track.createDiv("shelfmark-stats-bar-fill");
      fill.style.width = `${(n / max) * 100}%`;
      fill.toggleClass("is-zero", !n);
      row.createDiv({ cls: "shelfmark-stats-bar-value", text: String(n) });
      row.addEventListener("click", () => {
        const f = filter(label);
        if (this.year !== null) f.year = String(this.year);
        void this.plugin.openLibraryFiltered(f);
      });
    }
  }

  private renderHighlights(root: HTMLElement, stats: ReadingStats): void {
    const items: [string, BookEntry, string][] = [];
    if (stats.longest) items.push(["Longest", stats.longest, `${formatNumber(stats.longest.pages ?? 0)} pages`]);
    if (stats.shortest) items.push(["Shortest", stats.shortest, `${formatNumber(stats.shortest.pages ?? 0)} pages`]);
    if (stats.fastest) items.push(["Fastest read", stats.fastest.book, daysLabel(stats.fastest.days)]);
    if (items.length) {
      const box = root.createDiv("shelfmark-stats-card");
      box.createDiv({ cls: "shelfmark-section-title", text: "Highlights" });
      const list = box.createDiv("shelfmark-stats-highlights");
      for (const [label, book, note] of items) {
        const item = list.createDiv("shelfmark-stats-highlight");
        this.cover(item, book);
        const info = item.createDiv();
        info.createDiv({ cls: "shelfmark-stats-tile-label", text: label });
        info.createDiv({ cls: "shelfmark-card-title", text: book.title });
        info.createDiv({ cls: "shelfmark-card-author", text: note });
        item.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(book.file));
      }
    }

    if (stats.favorites.length) {
      const box = root.createDiv("shelfmark-stats-card");
      box.createDiv({ cls: "shelfmark-section-title", text: "Best (5★ and favorites)" });
      const strip = box.createDiv("shelfmark-queue-strip");
      for (const book of stats.favorites) {
        const item = strip.createDiv({ cls: "shelfmark-queue-item", attr: { "aria-label": book.title } });
        this.cover(item, book);
        item.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(book.file));
      }
    }
  }

  private cover(parent: HTMLElement, book: BookEntry): void {
    const el = parent.createDiv("shelfmark-queue-cover shelfmark-stats-cover");
    const file = resolveCover(this.app, book);
    if (file) el.createEl("img", { attr: { src: this.app.vault.getResourcePath(file), loading: "lazy" } });
    else el.createDiv({ cls: "shelfmark-placeholder-title", text: book.title });
  }
}
