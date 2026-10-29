import { ItemView, Keymap, WorkspaceLeaf, debounce, moment, setIcon, type ViewStateResult } from "obsidian";
import type ShelfmarkPlugin from "../main";
import { getSuggestions, visibleSuggestions, type Suggestion } from "../ai";
import { claudeAvailable } from "../claude";
import { getBooks, getQueue, resolveCover } from "../library";
import { bookLoan, getLoans, isOverdue, loanSummary } from "../loans";
import { formatPrice } from "../format";
import { formatReadDate } from "../readDates";
import { FORMATS, STATUSES, WISH_PRIORITIES, statusLabel, wishPriorityRank, type BookEntry } from "../types";

export const VIEW_TYPE_LIBRARY = "shelfmark-library";

type SortKey = "added" | "title" | "author" | "rating" | "finished" | "series";
type ViewMode = "grid" | "list";
type PresetKey = "unread" | "wishlist" | "favorites" | "loans";

/** Ready-made shelves: combinations of conditions that regular filters can't express. */
const PRESETS: Record<PresetKey, { label: string; icon: string; test: (b: BookEntry) => boolean }> = {
  unread: {
    label: "Owned, unread",
    icon: "book-marked",
    test: (b) => b.owned && !["read", "abandoned", "never"].includes(b.status ?? ""),
  },
  wishlist: {
    label: "Wishlist",
    icon: "gift",
    test: (b) => !b.owned && (!b.status || b.status === "to read"),
  },
  favorites: { label: "Favorites", icon: "heart", test: (b) => b.favorite },
  loans: { label: "On loan", icon: "hand-helping", test: (b) => !!bookLoan(b) },
};

/** An empty value means "no filter". */
interface Filters {
  owned: "" | "yes" | "no";
  format: string;
  rating: "" | "5" | "4" | "3" | "none";
  author: string;
  series: string;
  category: string;
  year: string;
  language: string;
}

const NO_FILTERS: Filters = {
  owned: "",
  format: "",
  rating: "",
  author: "",
  series: "",
  category: "",
  year: "",
  language: "",
};
const NONE = "__none__";

const OWNED_ICONS: Record<string, string> = {
  print: "book",
  ebook: "tablet-smartphone",
  audiobook: "headphones",
};

const RATINGS: Record<Exclude<Filters["rating"], "">, string> = {
  "5": "★★★★★",
  "4": "★★★★ and up",
  "3": "★★★ and up",
  none: "Unrated",
};

const FILTER_LABELS: Record<keyof Filters, string> = {
  owned: "Copy",
  format: "Format",
  rating: "Rating",
  author: "Author",
  series: "Series",
  category: "Genre",
  year: "Read in",
  language: "Language",
};

interface LibraryState {
  status?: string;
  sort?: SortKey;
  filters?: Partial<Filters>;
  showFilters?: boolean;
  preset?: PresetKey | "";
  mode?: ViewMode;
}

const SORTS: Record<SortKey, string> = {
  added: "Recently added",
  title: "Title",
  author: "Author",
  rating: "Rating",
  finished: "Date read",
  series: "Series",
};

export class LibraryView extends ItemView {
  private status = "all";
  private query = "";
  private sort: SortKey = "added";
  private filters: Filters = { ...NO_FILTERS };
  private showFilters = false;
  private preset: PresetKey | "" = "";
  private mode: ViewMode = "grid";
  private presetsEl!: HTMLElement;
  private modeButtons: Partial<Record<ViewMode, HTMLElement>> = {};
  private sortSel!: HTMLSelectElement;
  private filterBtn!: HTMLElement;
  private filtersEl!: HTMLElement;
  private chipsEl!: HTMLElement;
  private goalEl!: HTMLElement;
  private readingEl!: HTMLElement;
  private loansEl!: HTMLElement;
  private queueEl!: HTMLElement;
  private suggestEl!: HTMLElement;
  private tabsEl!: HTMLElement;
  private gridEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private plugin: ShelfmarkPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_LIBRARY;
  }

  getDisplayText(): string {
    return "Library";
  }

  getIcon(): string {
    return "library";
  }

  getState(): Record<string, unknown> {
    const state: LibraryState = {
      status: this.status,
      sort: this.sort,
      filters: this.filters,
      showFilters: this.showFilters,
      preset: this.preset,
      mode: this.mode,
    };
    return state as Record<string, unknown>;
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state ?? {}) as LibraryState;
    if (s.status) this.status = s.status;
    if (s.sort && s.sort in SORTS) this.sort = s.sort;
    this.filters = { ...NO_FILTERS, ...s.filters };
    this.showFilters = !!s.showFilters;
    this.preset = s.preset && s.preset in PRESETS ? s.preset : "";
    this.mode = s.mode === "list" ? "list" : "grid";
    if (this.sortSel) this.sortSel.value = this.sort;
    this.render();
    await super.setState(state, result);
  }

  /** Sets filters from outside (e.g. clicking a series in a note) and shows all statuses. */
  applyFilters(filters: Partial<Filters>): void {
    this.filters = { ...NO_FILTERS, ...filters };
    this.status = "all";
    this.preset = "";
    if (filters.series) this.sort = "series";
    if (this.sortSel) this.sortSel.value = this.sort;
    this.changed();
  }

  /** Saves the view state in the workspace layout, so filters survive a restart. */
  private changed(): void {
    this.render();
    this.app.workspace.requestSaveLayout();
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("shelfmark-view");

    const toolbar = root.createDiv("shelfmark-toolbar");
    const search = toolbar.createEl("input", {
      cls: "shelfmark-filter-input",
      type: "search",
      placeholder: "Search the library…",
    });
    search.addEventListener("input", () => {
      this.query = search.value.trim().toLocaleLowerCase();
      this.renderGrid();
    });

    this.sortSel = toolbar.createEl("select", { cls: "dropdown" });
    for (const [key, label] of Object.entries(SORTS)) this.sortSel.createEl("option", { value: key, text: label });
    this.sortSel.value = this.sort;
    this.sortSel.addEventListener("change", () => {
      this.sort = this.sortSel.value as SortKey;
      this.changed();
    });

    this.filterBtn = toolbar.createEl("button", { cls: "shelfmark-filter-btn" });
    this.filterBtn.addEventListener("click", () => {
      this.showFilters = !this.showFilters;
      this.changed();
    });

    const modes = toolbar.createDiv("shelfmark-mode-toggle");
    for (const [mode, icon, label] of [
      ["grid", "layout-grid", "Covers"],
      ["list", "list", "List"],
    ] as [ViewMode, string, string][]) {
      const btn = modes.createEl("button", { attr: { "aria-label": label } });
      setIcon(btn, icon);
      btn.addEventListener("click", () => {
        this.mode = mode;
        this.changed();
      });
      this.modeButtons[mode] = btn;
    }

    const statsBtn = toolbar.createEl("button", { cls: "shelfmark-filter-btn", attr: { "aria-label": "Reading stats" } });
    setIcon(statsBtn, "bar-chart-3");
    statsBtn.addEventListener("click", () => void this.plugin.openStats());

    const addBtn = toolbar.createEl("button", { cls: "mod-cta shelfmark-add-btn" });
    setIcon(addBtn.createSpan(), "plus");
    addBtn.createSpan({ text: "Add" });
    addBtn.addEventListener("click", () => this.plugin.openSearch());

    this.filtersEl = root.createDiv("shelfmark-filters");
    this.chipsEl = root.createDiv("shelfmark-chips");
    this.goalEl = root.createDiv("shelfmark-goal");
    this.readingEl = root.createDiv("shelfmark-reading");
    this.loansEl = root.createDiv("shelfmark-loans");
    this.queueEl = root.createDiv("shelfmark-queue");
    this.suggestEl = root.createDiv("shelfmark-suggest");
    this.presetsEl = root.createDiv("shelfmark-presets");
    this.tabsEl = root.createDiv("shelfmark-tabs");
    this.gridEl = root.createDiv("shelfmark-grid");

    const refresh = debounce(() => this.render(), 300, true);
    this.registerEvent(this.app.metadataCache.on("changed", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
    this.app.workspace.onLayoutReady(() => this.render());
  }

  /** Books after the panel filters (without status and search, which count separately). */
  private filteredBooks(): BookEntry[] {
    const f = this.filters;
    return getBooks(this.app).filter((b) => {
      if (f.owned && b.owned !== (f.owned === "yes")) return false;
      if (f.format && (f.format === NONE ? !!b.format : b.format !== f.format)) return false;
      if (f.rating === "none" && b.rating) return false;
      if (f.rating && f.rating !== "none" && (b.rating ?? 0) < Number(f.rating)) return false;
      if (this.preset && !PRESETS[this.preset].test(b)) return false;
      if (f.author && !b.authors.includes(f.author)) return false;
      if (f.series && b.series !== f.series) return false;
      if (f.category && !b.categories.includes(f.category)) return false;
      if (f.year && !(b.status === "read" && b.finished?.startsWith(f.year))) return false;
      if (f.language && b.language !== f.language) return false;
      return true;
    });
  }

  private activeFilters(): (keyof Filters)[] {
    return (Object.keys(this.filters) as (keyof Filters)[]).filter((k) => this.filters[k]);
  }

  render(): void {
    if (!this.tabsEl) return;
    this.renderFilters();
    this.renderGoal();
    this.renderReading();
    this.renderLoans();
    this.renderQueue();
    this.renderSuggestions();
    this.renderPresets();
    this.renderTabs();
    this.renderGrid();
  }

  private renderGoal(): void {
    this.goalEl.empty();
    const goal = this.plugin.settings.yearlyGoal;
    const year = moment().year();
    if (!goal) {
      const btn = this.goalEl.createEl("button", { cls: "shelfmark-goal-set", text: `Set a goal for ${year}` });
      btn.addEventListener("click", () => this.plugin.setGoal());
      return;
    }

    const read = getBooks(this.app).filter(
      (b) => b.status === "read" && b.finished?.startsWith(String(year))
    ).length;
    const elapsed = moment().dayOfYear() / (moment().isLeapYear() ? 366 : 365);
    const diff = read - Math.floor(goal * elapsed);
    const pace =
      read >= goal
        ? "Goal reached! 🎉"
        : diff > 0
          ? `${diff} ahead of schedule`
          : diff < 0
            ? `${-diff} behind schedule`
            : "On track";

    const box = this.goalEl.createDiv({ cls: "shelfmark-goal-box", attr: { "aria-label": "Change goal" } });
    const head = box.createDiv("shelfmark-goal-head");
    head.createSpan({ cls: "shelfmark-goal-title", text: `${year} goal: ${read} of ${goal}` });
    head.createSpan({ cls: "shelfmark-goal-pace", text: pace });
    const bar = box.createDiv("shelfmark-progress-track");
    bar.createDiv({ cls: "shelfmark-progress-fill", attr: { style: `width: ${Math.min(100, (read / goal) * 100)}%` } });
    box.addEventListener("click", () => this.plugin.setGoal());
  }

  /** "Reading now": books in progress, with buttons for quick entries. */
  private renderReading(): void {
    this.readingEl.empty();
    const reading = getBooks(this.app)
      .filter((b) => b.status === "reading")
      .sort((a, b) => b.added - a.added);
    if (!reading.length) return;

    this.readingEl.createDiv({ cls: "shelfmark-section-title", text: "Reading now" });
    const list = this.readingEl.createDiv("shelfmark-reading-list");
    for (const book of reading) {
      const row = list.createDiv("shelfmark-reading-item");
      const thumb = row.createDiv("shelfmark-reading-thumb");
      const cover = resolveCover(this.app, book);
      if (cover) thumb.createEl("img", { attr: { src: this.app.vault.getResourcePath(cover), alt: book.title } });
      thumb.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(book.file));

      const info = row.createDiv("shelfmark-reading-info");
      const title = info.createDiv({ cls: "shelfmark-card-title", text: book.title });
      title.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(book.file));
      if (book.authors.length) info.createDiv({ cls: "shelfmark-card-author", text: book.authors.join(", ") });
      if (book.pages) {
        const page = book.currentPage ?? 0;
        const track = info.createDiv("shelfmark-progress-track");
        track.createDiv({
          cls: "shelfmark-progress-fill",
          attr: { style: `width: ${Math.min(100, (page / book.pages) * 100)}%` },
        });
        info.createDiv({ cls: "shelfmark-card-author", text: page ? `p. ${page} of ${book.pages}` : `${book.pages} pages` });
      }

      const actions = row.createDiv("shelfmark-reading-actions");
      const btn = (icon: string, label: string, run: () => void) => {
        const b = actions.createEl("button", { cls: "shelfmark-panel-btn", attr: { "aria-label": label } });
        setIcon(b.createSpan(), icon);
        b.createSpan({ text: label });
        b.addEventListener("click", run);
      };
      btn("bookmark-plus", "Progress", () => this.plugin.askProgress(book));
      btn("pencil-line", "Note", () => this.plugin.addEntry(book, "note"));
      btn("quote", "Quote", () => this.plugin.addEntry(book, "quote"));
      btn("lightbulb", "Thought", () => this.plugin.addEntry(book, "thought"));
    }
  }

  /** Books on loan: to whom, since when, and whether it is time to ask for them back. */
  private renderLoans(): void {
    this.loansEl.empty();
    const loans = getLoans(this.app);
    if (!loans.length) return;

    this.loansEl.createDiv({ cls: "shelfmark-section-title", text: "On loan" });
    const list = this.loansEl.createDiv("shelfmark-loans-list");
    for (const loan of loans) {
      const row = list.createDiv("shelfmark-loan-row");
      row.toggleClass("is-overdue", isOverdue(loan));
      setIcon(row.createSpan("shelfmark-loan-icon"), loan.direction === "lent" ? "arrow-up-right" : "arrow-down-left");
      const info = row.createDiv("shelfmark-loan-info");
      const title = info.createDiv({ cls: "shelfmark-card-title", text: loan.book.title });
      title.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(loan.book.file));
      info.createDiv({ cls: "shelfmark-card-author", text: loanSummary(loan) });
      if (isOverdue(loan)) {
        info.createDiv({
          cls: "shelfmark-loan-warning",
          text: loan.returnBy ? "Past its due date" : "Away for a long time: maybe send a reminder",
        });
      }
      const back = row.createEl("button", { cls: "shelfmark-panel-btn" });
      setIcon(back.createSpan(), "undo-2");
      back.createSpan({ text: loan.direction === "lent" ? "Returned" : "Gave back" });
      back.addEventListener("click", () => void this.plugin.endLoan(loan));
    }
  }

  private filterValueLabel(key: keyof Filters): string {
    const v = this.filters[key];
    if (key === "owned") return v === "yes" ? "owned" : "not owned";
    if (key === "format") return v === NONE ? "no format" : v;
    if (key === "rating") return RATINGS[v as keyof typeof RATINGS] ?? v;
    return v;
  }

  private renderFilters(): void {
    const active = this.activeFilters();
    this.filterBtn.empty();
    setIcon(this.filterBtn.createSpan(), "filter");
    this.filterBtn.createSpan({ text: active.length ? `Filters (${active.length})` : "Filters" });
    this.filterBtn.toggleClass("is-active", this.showFilters || active.length > 0);

    // Chips for active filters: you see what narrows the list and can remove it with one click.
    this.chipsEl.empty();
    for (const key of active) {
      const chip = this.chipsEl.createEl("button", { cls: "shelfmark-chip" });
      chip.createSpan({ text: `${FILTER_LABELS[key]}: ${this.filterValueLabel(key)}` });
      setIcon(chip.createSpan("shelfmark-chip-x"), "x");
      chip.addEventListener("click", () => {
        this.filters[key] = "" as never;
        this.changed();
      });
    }
    if (active.length > 1) {
      const clear = this.chipsEl.createEl("button", { cls: "shelfmark-chip-clear", text: "Clear all" });
      clear.addEventListener("click", () => {
        this.filters = { ...NO_FILTERS };
        this.changed();
      });
    }

    this.filtersEl.empty();
    this.filtersEl.toggle(this.showFilters);
    if (!this.showFilters) return;

    const books = getBooks(this.app);
    const uniq = (values: (string | undefined)[]) =>
      [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
    const years = uniq(books.filter((b) => b.status === "read").map((b) => b.finished?.slice(0, 4))).reverse();

    const options: Record<keyof Filters, [string, string][]> = {
      owned: [["yes", "Owned"], ["no", "Not owned"]],
      format: [...FORMATS.map((f) => [f, f] as [string, string]), [NONE, "No format"]],
      rating: Object.entries(RATINGS),
      author: uniq(books.flatMap((b) => b.authors)).map((a) => [a, a]),
      series: uniq(books.map((b) => b.series)).map((s) => [s, s]),
      category: uniq(books.flatMap((b) => b.categories)).map((c) => [c, c]),
      year: years.map((y) => [y, y]),
      language: uniq(books.map((b) => b.language)).map((l) => [l, l]),
    };

    for (const key of Object.keys(options) as (keyof Filters)[]) {
      // A filter with nothing to choose from only clutters the panel.
      if (!options[key].length && !this.filters[key]) continue;
      const field = this.filtersEl.createDiv("shelfmark-filter-field");
      field.createEl("label", { text: FILTER_LABELS[key] });
      const sel = field.createEl("select", { cls: "dropdown" });
      sel.createEl("option", { value: "", text: "All" });
      for (const [value, label] of options[key]) sel.createEl("option", { value, text: label });
      sel.value = this.filters[key];
      sel.toggleClass("is-set", !!this.filters[key]);
      sel.addEventListener("change", () => {
        this.filters[key] = sel.value as never;
        this.changed();
      });
    }

    if (this.plugin.settings.aiEnabled && claudeAvailable()) {
      const cleanup = this.filtersEl.createEl("button", { cls: "shelfmark-panel-btn shelfmark-filters-genres" });
      setIcon(cleanup.createSpan(), "sparkles");
      cleanup.createSpan({ text: "Clean up with Claude" });
      setIcon(cleanup.createSpan("shelfmark-chevron"), "chevron-down");
      cleanup.addEventListener("click", (e) => this.plugin.cleanupMenu().showAtMouseEvent(e));
    }
  }

  /** "Up next": the first books of the reading queue as a row of numbered covers. */
  private renderQueue(): void {
    this.queueEl.empty();
    const queue = getQueue(this.app);
    const head = this.queueEl.createDiv("shelfmark-section-head");
    head.createDiv({ cls: "shelfmark-section-title", text: "Reading queue" });
    const tools = head.createDiv("shelfmark-section-tools");
    if (this.plugin.settings.aiEnabled && claudeAvailable()) {
      const pick = tools.createEl("button", { cls: "shelfmark-panel-btn shelfmark-section-btn" });
      setIcon(pick.createSpan(), "sparkles");
      pick.createSpan({ text: "What next?" });
      pick.addEventListener("click", () => this.plugin.openPick());
    }
    const manage = tools.createEl("button", { cls: "shelfmark-panel-btn shelfmark-section-btn" });
    setIcon(manage.createSpan(), queue.length ? "arrow-up-down" : "plus");
    manage.createSpan({ text: queue.length ? "Arrange queue" : "Create queue" });
    manage.addEventListener("click", () => this.plugin.openQueue());
    if (!queue.length) {
      this.queueEl.addClass("is-empty");
      return;
    }
    this.queueEl.removeClass("is-empty");

    const strip = this.queueEl.createDiv("shelfmark-queue-strip");
    queue.slice(0, 8).forEach((book, i) => {
      const item = strip.createDiv({ cls: "shelfmark-queue-item", attr: { "aria-label": book.title } });
      const cover = item.createDiv("shelfmark-queue-cover");
      const file = resolveCover(this.app, book);
      if (file) cover.createEl("img", { attr: { src: this.app.vault.getResourcePath(file), loading: "lazy" } });
      else cover.createDiv({ cls: "shelfmark-placeholder-title", text: book.title });
      item.createDiv({ cls: "shelfmark-queue-num", text: String(i + 1) });
      item.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(book.file));
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.showMenu(book, e);
      });
    });
    if (queue.length > 8) {
      const more = strip.createDiv({ cls: "shelfmark-queue-more", text: `+${queue.length - 8}` });
      more.addEventListener("click", () => this.plugin.openQueue());
    }
  }

  /** "For you": suggestions from Claude with buttons to add or dismiss them. */
  private renderSuggestions(): void {
    this.suggestEl.empty();
    const data = getSuggestions(this.app, this.plugin.settings);
    const canRun = claudeAvailable();
    if (!this.plugin.settings.aiEnabled || (!data && !canRun)) return;

    const list = data ? visibleSuggestions(this.app, data) : [];
    const head = this.suggestEl.createDiv("shelfmark-section-head");
    head.createDiv({ cls: "shelfmark-section-title", text: "For you" });
    const tools = head.createDiv("shelfmark-section-tools");
    const btn = (icon: string, label: string, run: () => void) => {
      const b = tools.createEl("button", { cls: "shelfmark-panel-btn shelfmark-section-btn" });
      setIcon(b.createSpan(), icon);
      b.createSpan({ text: label });
      b.addEventListener("click", run);
    };
    if (data) btn("user-round", "Profile", () => void this.plugin.openProfile());
    if (this.plugin.aiRun || this.plugin.aiStep) {
      btn("square", "Stop", () => this.plugin.stopSuggesting());
    } else if (canRun) {
      btn("sparkles", data ? "New suggestions" : "Suggest books", () => void this.plugin.suggestBooks());
    }

    if (this.plugin.aiStep) {
      this.suggestEl.createDiv({ cls: "shelfmark-suggest-status", text: this.plugin.aiStep });
    }
    if (!list.length) {
      if (!this.plugin.aiStep) {
        this.suggestEl.createDiv({
          cls: "shelfmark-suggest-status",
          text: data
            ? "You've seen all suggestions. Ask for new ones."
            : "Claude will look at your ratings, statuses and notes, describe your taste and suggest books.",
        });
      }
      return;
    }

    const strip = this.suggestEl.createDiv("shelfmark-suggest-strip");
    for (const s of list) this.renderSuggestion(strip, s);
  }

  private renderSuggestion(strip: HTMLElement, s: Suggestion): void {
    const card = strip.createDiv("shelfmark-suggest-card");
    const cover = card.createDiv("shelfmark-suggest-cover");
    if (s.cover) {
      const img = cover.createEl("img", { attr: { src: s.cover, loading: "lazy", alt: s.title } });
      img.addEventListener("error", () => img.remove());
    }
    cover.createDiv({ cls: "shelfmark-placeholder-title", text: s.title });

    const info = card.createDiv("shelfmark-suggest-info");
    info.createDiv({ cls: "shelfmark-card-title", text: s.title });
    info.createDiv({ cls: "shelfmark-card-author", text: [s.author, s.year].filter(Boolean).join(" · ") });
    const tags = info.createDiv("shelfmark-suggest-tags");
    tags.createSpan({ cls: `shelfmark-suggest-kind is-${s.kind}`, text: s.kind === "discovery" ? "Discovery" : "Safe bet" });
    if (!s.verified) {
      tags.createSpan({
        cls: "shelfmark-suggest-unverified",
        text: "not in catalogs",
        attr: { "aria-label": "This book wasn\'t found in any catalog. It may have a different title or not exist." },
      });
    }
    info.createDiv({ cls: "shelfmark-suggest-reason", text: s.reason, attr: { "aria-label": s.reason } });

    const actions = info.createDiv("shelfmark-suggest-actions");
    const add = actions.createEl("button", { cls: "shelfmark-panel-btn" });
    setIcon(add.createSpan(), "plus");
    add.createSpan({ text: "Add" });
    add.addEventListener("click", () => this.plugin.openSearch(`${s.title} ${s.author}`));
    const reject = actions.createEl("button", { cls: "shelfmark-panel-btn", attr: { "aria-label": "Not for me" } });
    setIcon(reject.createSpan(), "x");
    reject.createSpan({ text: "Not for me" });
    reject.addEventListener("click", () => {
      card.remove();
      void this.plugin.rejectSuggestion(s);
    });
  }

  private renderPresets(): void {
    this.presetsEl.empty();
    for (const btn of Object.entries(this.modeButtons)) btn[1]?.toggleClass("is-active", btn[0] === this.mode);

    // Shelf counts without the shelf itself, so you can see how many books each would show.
    const current = this.preset;
    this.preset = "";
    const base = this.filteredBooks();
    this.preset = current;

    for (const [key, p] of Object.entries(PRESETS) as [PresetKey, (typeof PRESETS)[PresetKey]][]) {
      const count = base.filter(p.test).length;
      const btn = this.presetsEl.createEl("button", { cls: "shelfmark-preset" });
      setIcon(btn.createSpan(), p.icon);
      btn.createSpan({ text: p.label });
      btn.createSpan({ cls: "shelfmark-preset-count", text: String(count) });
      btn.toggleClass("is-active", key === this.preset);
      btn.addEventListener("click", () => {
        this.preset = this.preset === key ? "" : key;
        this.changed();
      });
    }
  }

  private renderTabs(): void {
    const books = this.filteredBooks();
    this.tabsEl.empty();
    const tabs: { id: string; label: string; count: number }[] = [
      { id: "all", label: "All", count: books.length },
      ...STATUSES.map((s) => ({
        id: s.id as string,
        label: s.label,
        count: books.filter((b) => b.status === s.id).length,
      })),
    ];
    for (const t of tabs) {
      const tab = this.tabsEl.createEl("button", {
        cls: "shelfmark-tab",
        text: `${t.label} ${t.count}`,
      });
      if (t.id === this.status) tab.addClass("is-active");
      tab.addEventListener("click", () => {
        this.status = t.id;
        this.changed();
      });
    }
  }

  private visibleBooks(): BookEntry[] {
    let books = this.filteredBooks();
    if (this.status !== "all") books = books.filter((b) => b.status === this.status);
    if (this.query) {
      books = books.filter((b) =>
        [b.title, ...b.authors, b.isbn13 ?? ""].some((s) => s.toLocaleLowerCase().includes(this.query))
      );
    }
    const cmp = (a: string, b: string) => a.localeCompare(b);
    const sorters: Record<SortKey, (a: BookEntry, b: BookEntry) => number> = {
      added: (a, b) => b.added - a.added,
      title: (a, b) => cmp(a.title, b.title),
      author: (a, b) => cmp(a.authors[0] ?? "", b.authors[0] ?? "") || cmp(a.title, b.title),
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
      finished: (a, b) => cmp(b.finished ?? "", a.finished ?? ""),
      // Books without a series last; within a series by volume number.
      series: (a, b) =>
        Number(!a.series) - Number(!b.series) ||
        cmp(a.series ?? "", b.series ?? "") ||
        (a.seriesIndex ?? Infinity) - (b.seriesIndex ?? Infinity) ||
        cmp(a.title, b.title),
    };
    // On the wishlist, what you want most matters most.
    if (this.preset === "wishlist" && this.sort === "added") {
      return books.sort(
        (a, b) => wishPriorityRank(a.wishPriority) - wishPriorityRank(b.wishPriority) || b.added - a.added
      );
    }
    return books.sort(sorters[this.sort]);
  }

  private renderGrid(): void {
    const books = this.visibleBooks();
    this.gridEl.empty();
    if (!books.length) {
      const empty = this.gridEl.createDiv("shelfmark-empty");
      empty.setText(
        this.query || this.status !== "all" || this.preset || this.activeFilters().length
          ? "No books match."
          : "The library is empty. Add your first book with the “Add” button."
      );
      return;
    }
    this.gridEl.toggleClass("shelfmark-grid", this.mode === "grid");
    this.gridEl.toggleClass("shelfmark-list", this.mode === "list");
    if (this.mode === "list") this.renderList(books);
    else for (const book of books) this.renderCard(book);
  }

  private renderList(books: BookEntry[]): void {
    const head = this.gridEl.createDiv("shelfmark-row shelfmark-row-head");
    for (const label of ["", "Title", "Series", "Status", "Rating", "Copy", "Read"]) {
      head.createDiv({ text: label });
    }
    for (const book of books) {
      const row = this.gridEl.createDiv("shelfmark-row");
      row.toggleClass("is-not-owned", !book.owned);

      const thumb = row.createDiv("shelfmark-row-thumb");
      const cover = resolveCover(this.app, book);
      if (cover) thumb.createEl("img", { attr: { src: this.app.vault.getResourcePath(cover), loading: "lazy" } });

      const main = row.createDiv("shelfmark-row-main");
      const title = main.createDiv({ cls: "shelfmark-row-title" });
      if (book.favorite) setIcon(title.createSpan("shelfmark-row-heart"), "heart");
      title.createSpan({ text: book.title });
      if (book.authors.length) main.createDiv({ cls: "shelfmark-card-author", text: book.authors.join(", ") });

      row.createDiv({
        cls: "shelfmark-row-series",
        text: book.series ? `${book.series}${book.seriesIndex ? ` #${book.seriesIndex}` : ""}` : "",
      });

      const status = row.createDiv({ cls: "shelfmark-row-status", attr: { "data-status": book.status ?? "" } });
      const icon = STATUSES.find((s) => s.id === book.status)?.icon;
      if (icon) setIcon(status.createSpan(), icon);
      status.createSpan({ cls: "shelfmark-row-status-label", text: statusLabel(book.status) });

      row.createDiv({ cls: "shelfmark-stars", text: book.rating ? "★".repeat(book.rating) : "" });

      const owned = row.createDiv("shelfmark-row-owned");
      if (book.owned) {
        setIcon(owned.createSpan(), OWNED_ICONS[book.format ?? ""] ?? "check");
        owned.createSpan({ text: book.format ?? "owned" });
      } else owned.setText("—");

      row.createDiv({
        cls: "shelfmark-row-date",
        text: book.status === "read" ? formatReadDate(book.finished) : "",
      });

      row.addEventListener("click", (e) => void this.app.workspace.getLeaf(Keymap.isModEvent(e)).openFile(book.file));
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.showMenu(book, e);
      });
    }
  }

  private renderCard(book: BookEntry): void {
    const card = this.gridEl.createDiv("shelfmark-card");
    const coverEl = card.createDiv("shelfmark-cover");
    const coverFile = resolveCover(this.app, book);
    if (coverFile) {
      coverEl.createEl("img", {
        attr: { src: this.app.vault.getResourcePath(coverFile), loading: "lazy", alt: book.title },
      });
    } else {
      coverEl.addClass("is-placeholder");
      coverEl.createDiv({ cls: "shelfmark-placeholder-title", text: book.title });
    }

    if (book.status) {
      const badge = coverEl.createDiv({ cls: "shelfmark-status-badge", attr: { "data-status": book.status } });
      const icon = STATUSES.find((s) => s.id === book.status)?.icon;
      if (icon) setIcon(badge, icon);
      badge.setAttr("aria-label", statusLabel(book.status));
    }

    if (book.status === "reading" && book.pages && book.currentPage) {
      const pct = Math.min(100, Math.round((book.currentPage / book.pages) * 100));
      const track = coverEl.createDiv({
        cls: "shelfmark-progress-track shelfmark-cover-progress",
        attr: { "aria-label": `Page ${book.currentPage} of ${book.pages} (${pct}%)` },
      });
      track.createDiv({ cls: "shelfmark-progress-fill", attr: { style: `width: ${pct}%` } });
    }

    const loan = bookLoan(book);
    if (loan) {
      const badge = coverEl.createDiv({ cls: "shelfmark-loan-badge", attr: { "aria-label": loanSummary(loan) } });
      setIcon(badge, "hand-helping");
    }

    // Books you don't own are dimmed; owned ones get a badge with the format of your copy.
    card.toggleClass("is-not-owned", !book.owned);
    if (book.owned) {
      const owned = coverEl.createDiv({
        cls: "shelfmark-owned-badge",
        attr: { "aria-label": book.format ? `Owned · ${book.format}` : "Owned" },
      });
      setIcon(owned, OWNED_ICONS[book.format ?? ""] ?? "check");
    }

    const heart = coverEl.createDiv({
      cls: "shelfmark-card-heart",
      attr: { "aria-label": book.favorite ? "Remove from favorites" : "Add to favorites" },
    });
    heart.toggleClass("is-active", book.favorite);
    setIcon(heart, "heart");
    heart.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.plugin.toggleFavorite(book.file);
    });

    const more = coverEl.createDiv({ cls: "shelfmark-more clickable-icon", attr: { "aria-label": "Options" } });
    setIcon(more, "more-vertical");
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showMenu(book, e);
    });

    card.createDiv({ cls: "shelfmark-card-title", text: book.title });
    if (book.authors.length) card.createDiv({ cls: "shelfmark-card-author", text: book.authors.join(", ") });
    if (!book.owned && (book.price || book.wishPriority || book.gift)) {
      const wish = [
        book.gift ? "🎁" : "",
        WISH_PRIORITIES.find((p) => p.id === book.wishPriority)?.label ?? "",
        book.price ? formatPrice(book.price, this.plugin.settings) : "",
      ].filter(Boolean);
      card.createDiv({ cls: "shelfmark-card-wish", text: wish.join(" · ") });
    }
    if (book.series) {
      card.createDiv({
        cls: "shelfmark-card-series",
        text: `${book.series}${book.seriesIndex ? ` #${book.seriesIndex}` : ""}`,
      });
    }
    if (book.rating) {
      card.createDiv({ cls: "shelfmark-stars", text: "★".repeat(book.rating) + "☆".repeat(Math.max(0, 5 - book.rating)) });
    }

    card.addEventListener("click", (e) => {
      void this.app.workspace.getLeaf(Keymap.isModEvent(e)).openFile(book.file);
    });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showMenu(book, e);
    });
  }

  private showMenu(book: BookEntry, evt: MouseEvent): void {
    this.plugin.bookMenu(book).showAtMouseEvent(evt);
  }
}
