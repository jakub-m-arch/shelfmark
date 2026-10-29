import { MarkdownRenderChild, TFile, setIcon } from "obsidian";
import type ShelfmarkPlugin from "../main";
import { getBook, getQueue, missingVolumes, priceSearchUrl, resolveCover, seriesBooks } from "../library";
import { STATUSES, WISH_PRIORITIES, statusLabel, type BookEntry } from "../types";
import { hasEarlierVolumes } from "../aiRecap";
import { claudeAvailable } from "../claude";
import { bookLoan, isOverdue, loanSummary } from "../loans";
import { formatDate, formatPrice } from "../format";
import { formatReadDate } from "../readDates";

/** The panel at the top of a book note: cover, status, rating, progress and quick actions. */
export class BookPanel extends MarkdownRenderChild {
  constructor(containerEl: HTMLElement, private plugin: ShelfmarkPlugin, private sourcePath: string) {
    super(containerEl);
  }

  onload(): void {
    this.render();
    this.registerEvent(
      this.plugin.app.metadataCache.on("changed", (file) => {
        if (file.path === this.sourcePath) this.render();
      })
    );
  }

  private render(): void {
    const { app } = this.plugin;
    const el = this.containerEl;
    el.empty();
    el.addClass("shelfmark-panel");

    const file = app.vault.getAbstractFileByPath(this.sourcePath);
    const book = file instanceof TFile ? getBook(app, file) : undefined;
    if (!book) {
      el.createDiv({ cls: "shelfmark-panel-empty", text: "The Shelfmark panel only works in book notes." });
      return;
    }

    const cover = resolveCover(app, book);
    const coverEl = el.createDiv("shelfmark-panel-cover");
    if (cover) coverEl.createEl("img", { attr: { src: app.vault.getResourcePath(cover), alt: book.title } });
    else coverEl.createDiv({ cls: "shelfmark-placeholder-title", text: book.title });
    this.action(coverEl, () => this.plugin.changeCover(book.file));

    const info = el.createDiv("shelfmark-panel-info");
    info.createDiv({ cls: "shelfmark-panel-title", text: book.title });
    if (book.authors.length) info.createDiv({ cls: "shelfmark-panel-author", text: book.authors.join(", ") });
    if (book.series) {
      const series = info.createDiv({
        cls: "shelfmark-panel-series",
        text: book.seriesIndex ? `${book.series} · volume ${book.seriesIndex}` : book.series,
        attr: { "aria-label": "Show series in library" },
      });
      this.action(series, () => void this.plugin.openLibraryFiltered({ series: book.series ?? "" }));
    }

    const row = info.createDiv("shelfmark-panel-row");
    const status = row.createEl("button", { cls: "shelfmark-status-chip", attr: { "data-status": book.status ?? "" } });
    const icon = STATUSES.find((s) => s.id === book.status)?.icon;
    if (icon) setIcon(status.createSpan(), icon);
    status.createSpan({ text: statusLabel(book.status) });
    setIcon(status.createSpan("shelfmark-chevron"), "chevron-down");
    this.action(status, (e) => this.plugin.statusMenu(book).showAtMouseEvent(e));

    this.renderStars(row, book);

    const heart = row.createEl("button", {
      cls: "shelfmark-heart",
      attr: { "aria-label": book.favorite ? "Remove from favorites" : "Add to favorites" },
    });
    heart.toggleClass("is-active", book.favorite);
    setIcon(heart, "heart");
    this.action(heart, () => void this.plugin.toggleFavorite(book.file));

    const queued = book.queue !== undefined;
    const queue = row.createEl("button", {
      cls: "shelfmark-queue-chip",
      attr: { "aria-label": queued ? "Remove from queue" : "Add to reading queue" },
    });
    queue.toggleClass("is-active", queued);
    setIcon(queue.createSpan(), "list-ordered");
    const position = getQueue(this.plugin.app).findIndex((b) => b.file.path === book.file.path) + 1;
    queue.createSpan({ text: queued ? `Queued: #${position}` : "Queue" });
    this.action(queue, () => void this.plugin.toggleQueue(book));

    if (book.pages) {
      const progress = info.createDiv("shelfmark-panel-progress");
      const page = book.currentPage ?? 0;
      const track = progress.createDiv("shelfmark-progress-track");
      track.createDiv({
        cls: "shelfmark-progress-fill",
        attr: { style: `width: ${Math.min(100, (page / book.pages) * 100)}%` },
      });
      progress.createSpan({
        cls: "shelfmark-panel-pages",
        text: page ? `p. ${page} of ${book.pages}` : `${book.pages} pages`,
      });
    }

    const actions = info.createDiv("shelfmark-panel-actions");
    this.button(actions, "bookmark-plus", "Progress", () => this.plugin.askProgress(book));
    this.button(actions, "pencil-line", "Note", () => this.plugin.addEntry(book, "note"));
    this.button(actions, "quote", "Quote", () => this.plugin.addEntry(book, "quote"));
    this.button(actions, "lightbulb", "Thought", () => this.plugin.addEntry(book, "thought"));
    this.button(actions, "more-horizontal", "", (e) => this.plugin.bookMenu(book).showAtMouseEvent(e), "More");

    this.renderDetails(el, book);
  }

  /** The key properties in readable form, instead of Obsidian's properties table. */
  private renderDetails(parent: HTMLElement, book: BookEntry): void {
    const fm = this.plugin.app.metadataCache.getFileCache(book.file)?.frontmatter ?? {};
    const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v ? String(v) : "");
    const date = (v: unknown) => (v ? formatDate(String(v)) : "");
    const rows: [string, string][] = [
      ["Publisher", list(fm.publisher)],
      ["Published", list(fm.published)],
      ["Pages", list(fm.pages)],
      ["Translator", list(fm.translator)],
      ["Original title", list(fm.original_title)],
      ["Format", list(fm.format)],
      ["Copy", fm.owned === true ? "owned" : fm.owned === false ? "not owned" : ""],
      ["Started", date(fm.started)],
      ["Finished", fm.status === "read" ? formatReadDate(fm.finished ? String(fm.finished) : undefined) || "don't remember when" : ""],
      ["Added", date(fm.added)],
      ["Genre", list(fm.categories)],
      ["Average rating", fm.avg_rating ? `${fm.avg_rating}/5${fm.ratings_count ? ` (${fm.ratings_count})` : ""}` : ""],
      ["ISBN", list(fm.isbn13 ?? fm.isbn10)],
    ];

    this.renderLoan(parent, book);
    if (book.series) this.renderSeries(parent, book);
    if (!book.owned) this.renderWish(parent, book);

    const details = parent.createEl("details", { cls: "shelfmark-panel-details" });
    details.open = this.plugin.settings.detailsOpen;
    details.createEl("summary", { text: "Details" });
    details.addEventListener("toggle", () => {
      this.plugin.settings.detailsOpen = details.open;
      void this.plugin.saveSettings();
    });
    details.querySelector("summary")?.addEventListener("mousedown", (e) => e.stopPropagation());

    const grid = details.createDiv("shelfmark-details-grid");
    for (const [label, value] of rows) {
      if (!value) continue;
      grid.createDiv({ cls: "shelfmark-details-label", text: label });
      grid.createDiv({ cls: "shelfmark-details-value", text: value });
    }
    if (typeof fm.source === "string" && fm.source.startsWith("http")) {
      grid.createDiv({ cls: "shelfmark-details-label", text: "Source" });
      const value = grid.createDiv("shelfmark-details-value");
      value.createEl("a", { text: new URL(fm.source).hostname, href: fm.source, cls: "external-link" });
    }

    if (this.plugin.settings.hideProperties) {
      const footer = details.createDiv("shelfmark-details-footer");
      const shown = document.body.hasClass("shelfmark-show-props");
      this.button(footer, "list", shown ? "Hide properties" : "Edit properties", () => {
        document.body.toggleClass("shelfmark-show-props", !shown);
        this.render();
      });
    }
  }

  /** The loan bar: to or from whom, since when, and a return button. */
  private renderLoan(parent: HTMLElement, book: BookEntry): void {
    const loan = bookLoan(book);
    if (!loan) return;
    const box = parent.createDiv("shelfmark-panel-loan");
    box.toggleClass("is-overdue", isOverdue(loan));
    setIcon(box.createSpan("shelfmark-loan-icon"), "hand-helping");
    box.createSpan({ cls: "shelfmark-panel-loan-text", text: loanSummary(loan) });
    this.button(box, "undo-2", loan.direction === "lent" ? "Returned" : "Gave back", () => void this.plugin.endLoan(loan));
  }

  /** The wishlist section for books you don't own yet. */
  private renderWish(parent: HTMLElement, book: BookEntry): void {
    const box = parent.createDiv("shelfmark-panel-wish");
    const head = box.createDiv("shelfmark-wish-head");
    setIcon(head.createSpan("shelfmark-wish-icon"), "gift");
    head.createSpan({ cls: "shelfmark-volumes-title", text: "Wishlist" });

    const facts = box.createDiv("shelfmark-wish-facts");
    const priority = WISH_PRIORITIES.find((p) => p.id === book.wishPriority)?.label;
    if (priority) facts.createSpan({ cls: "shelfmark-wish-tag", text: priority });
    if (book.price) facts.createSpan({ cls: "shelfmark-wish-tag", text: `about ${formatPrice(book.price, this.plugin.settings)}` });
    if (book.gift) facts.createSpan({ cls: "shelfmark-wish-tag is-gift", text: "🎁 gift idea" });
    if (!priority && !book.price && !book.gift) {
      facts.createSpan({ cls: "shelfmark-panel-pages", text: "Add a priority or price, or mark it as a gift idea." });
    }

    const actions = box.createDiv("shelfmark-panel-actions");
    this.button(actions, "pencil", "Edit", () => this.plugin.editWish(book));
    if (book.shopUrl) this.button(actions, "shopping-cart", "Buy", () => window.open(book.shopUrl));
    this.button(actions, "search", "Compare prices", () => window.open(priceSearchUrl(book)));
    this.button(actions, "package-check", "Bought", (e) => this.plugin.boughtMenu(book).showAtMouseEvent(e));
  }

  /** Series volumes in the library, and gaps in the numbering. */
  private renderSeries(parent: HTMLElement, book: BookEntry): void {
    const books = seriesBooks(this.plugin.app, book.series ?? "");
    if (books.length < 2 && !book.seriesIndex) return;
    const box = parent.createDiv("shelfmark-panel-volumes");
    box.createDiv({ cls: "shelfmark-volumes-title", text: `Series “${book.series}”` });
    const list = box.createDiv("shelfmark-volumes-list");
    for (const b of books) {
      const item = list.createDiv({ cls: "shelfmark-volume" });
      item.toggleClass("is-current", b.file.path === book.file.path);
      item.toggleClass("is-not-owned", !b.owned);
      item.toggleClass("is-read", b.status === "read");
      item.createSpan({ cls: "shelfmark-volume-num", text: b.seriesIndex ? String(b.seriesIndex) : "–" });
      item.createSpan({ cls: "shelfmark-volume-title", text: b.title });
      if (b.status === "read") setIcon(item.createSpan("shelfmark-volume-icon"), "check");
      item.setAttr("aria-label", `${statusLabel(b.status)}${b.owned ? " · owned" : " · not owned"}`);
      if (b.file.path !== book.file.path) {
        this.action(item, () => void this.plugin.app.workspace.getLeaf(false).openFile(b.file));
      }
    }
    const missing = missingVolumes(books);
    if (missing.length) {
      box.createDiv({
        cls: "shelfmark-volumes-missing",
        text: `Missing from the library: ${missing.map((n) => `volume ${n}`).join(", ")}`,
      });
    }
    if (this.plugin.settings.aiEnabled && claudeAvailable() && hasEarlierVolumes(this.plugin.app, book)) {
      const actions = box.createDiv("shelfmark-panel-actions");
      this.button(actions, "history", "Recap previous volumes", () => this.plugin.openRecap(book));
    }
  }

  private renderStars(parent: HTMLElement, book: BookEntry): void {
    const stars = parent.createDiv({ cls: "shelfmark-panel-stars", attr: { "aria-label": "Rating" } });
    for (let n = 1; n <= 5; n++) {
      const star = stars.createSpan({ text: n <= (book.rating ?? 0) ? "★" : "☆" });
      // Clicking the current rating clears it.
      this.action(star, () => this.plugin.setRating(book.file, book.rating === n ? null : n));
    }
  }

  private button(parent: HTMLElement, icon: string, label: string, run: (e: MouseEvent) => void, aria?: string): void {
    const btn = parent.createEl("button", { cls: "shelfmark-panel-btn", attr: { "aria-label": aria ?? label } });
    setIcon(btn.createSpan(), icon);
    if (label) btn.createSpan({ text: label });
    this.action(btn, run);
  }

  /** In Live Preview a click on a code block switches it to editing; here it should only run the action. */
  private action(el: HTMLElement, run: (e: MouseEvent) => void): void {
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      run(e);
    });
  }
}
