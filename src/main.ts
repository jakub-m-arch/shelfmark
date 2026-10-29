import { FileSystemAdapter, MarkdownView, Menu, Notice, Plugin, TFile, debounce } from "obsidian";
import { prepareRequest, profilePath, rejectSuggestion, saveAnswer, type Suggestion } from "./ai";
import { askClaude, claudeAvailable, findClaude, type ClaudeRun } from "./claude";
import {
  BOOK_TYPE,
  addToQueue,
  createBookNote,
  exportWishlist,
  findDuplicate,
  findOrphanCovers,
  getBook,
  getBooks,
  isBook,
  migrateCoverLinks,
  migratePanels,
  refreshMetadata,
  removeFromQueue,
  resolveCoverLink,
  today,
  trashCoverIfUnused,
  type EntryKind,
} from "./library";
import { BookSearchModal } from "./modals/BookSearchModal";
import { withDescription } from "./providers";
import { BookSuggestModal } from "./modals/BookSuggestModal";
import { NumberPromptModal } from "./modals/NumberPromptModal";
import { EntryModal } from "./modals/EntryModal";
import { QueueModal } from "./modals/QueueModal";
import { SeriesModal } from "./modals/SeriesModal";
import { WishModal } from "./modals/WishModal";
import { GenresModal } from "./modals/GenresModal";
import { PickModal } from "./modals/PickModal";
import { RecapModal } from "./modals/RecapModal";
import { ReviewModal } from "./modals/ReviewModal";
import { authorsTask } from "./aiAuthors";
import { descriptionsTask } from "./aiDescriptions";
import { hasEarlierVolumes } from "./aiRecap";
import { LoanModal } from "./modals/LoanModal";
import { ReadDateModal } from "./modals/ReadDateModal";
import { ReadDatesModal } from "./modals/ReadDatesModal";
import { formatReadDate } from "./readDates";
import { bookLoan, endLoan, getLoans, isOverdue, type Loan, type LoanDirection } from "./loans";
import { ConfirmModal } from "./modals/ConfirmModal";
import { CoverModal } from "./modals/CoverModal";
import { StatusSuggestModal } from "./modals/StatusSuggestModal";
import { ShelfmarkSettingTab, DEFAULT_SETTINGS, type ShelfmarkSettings } from "./settings";
import { FORMATS, STATUSES, type AddBookOptions, type BookEntry, type BookSearchResult, type BookStatus } from "./types";
import { BookPanel } from "./views/BookPanel";
import { LibraryView, VIEW_TYPE_LIBRARY } from "./views/LibraryView";
import { StatsView, VIEW_TYPE_STATS } from "./views/StatsView";

export default class ShelfmarkPlugin extends Plugin {
  settings!: ShelfmarkSettings;
  /** The running Claude request and the current step (the library view shows progress). */
  aiRun: ClaudeRun | null = null;
  aiStep = "";

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_LIBRARY, (leaf) => new LibraryView(leaf, this));
    this.registerView(VIEW_TYPE_STATS, (leaf) => new StatsView(leaf, this));
    this.addRibbonIcon("library", "Open library", () => this.activateLibrary());
    this.addRibbonIcon("bar-chart-3", "Reading stats", () => this.openStats());
    this.registerMarkdownCodeBlockProcessor("shelfmark", (_source, el, ctx) => {
      ctx.addChild(new BookPanel(el, this, ctx.sourcePath));
    });

    this.addCommand({
      id: "open-library",
      name: "Open library",
      callback: () => this.activateLibrary(),
    });
    this.addCommand({
      id: "read-dates",
      name: "Fill in dates read",
      callback: () => this.openReadDates(),
    });
    this.addCommand({
      id: "open-stats",
      name: "Open reading stats",
      callback: () => void this.openStats(),
    });
    this.addCommand({
      id: "add-book",
      name: "Add book",
      callback: () => this.openSearch(),
    });
    this.addCommand({
      id: "set-status",
      name: "Change status of current book",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isBook(this.app, file)) return false;
        if (!checking) new StatusSuggestModal(this.app, (s) => this.setStatus(file, s)).open();
        return true;
      },
    });

    this.addCommand({
      id: "update-progress",
      name: "Update reading progress",
      callback: () => this.withBook((b) => this.askProgress(b)),
    });
    this.addCommand({
      id: "add-note",
      name: "Add note to book",
      callback: () => this.withBook((b) => this.addEntry(b, "note")),
    });
    this.addCommand({
      id: "add-thought",
      name: "Add thought to book",
      callback: () => this.withBook((b) => this.addEntry(b, "thought")),
    });
    this.addCommand({
      id: "add-quote",
      name: "Add quote",
      callback: () => this.withBook((b) => this.addEntry(b, "quote")),
    });
    this.addCommand({
      id: "open-queue",
      name: "Reading queue",
      callback: () => this.openQueue(),
    });
    this.addCommand({
      id: "export-wishlist",
      name: "Export wishlist to a note",
      callback: () => void this.exportWishlist(),
    });
    this.addCommand({
      id: "change-cover",
      name: "Change cover of current book",
      checkCallback: (checking) => this.withActiveBook(checking, (f) => this.changeCover(f)),
    });
    this.addCommand({
      id: "refresh-metadata",
      name: "Refresh data of current book",
      checkCallback: (checking) => this.withActiveBook(checking, (f) => this.refreshBook(f)),
    });
    this.addCommand({
      id: "clean-covers",
      name: "Delete unused covers",
      callback: () => this.cleanCovers(),
    });

    this.addCommand({
      id: "ai-suggest",
      name: "Suggest books (Claude)",
      checkCallback: (checking) => {
        if (!claudeAvailable()) return false;
        if (!checking) void this.suggestBooks();
        return true;
      },
    });
    this.addCommand({
      id: "ai-pick",
      name: "What should I read next? (Claude)",
      checkCallback: (checking) => {
        if (!claudeAvailable()) return false;
        if (!checking) this.openPick();
        return true;
      },
    });
    this.addCommand({
      id: "ai-genres",
      name: "Tidy up genres (Claude)",
      checkCallback: (checking) => {
        if (!claudeAvailable()) return false;
        if (!checking) this.openGenres();
        return true;
      },
    });
    this.addCommand({
      id: "ai-authors",
      name: "Unify authors (Claude)",
      checkCallback: (checking) => {
        if (!claudeAvailable()) return false;
        if (!checking) this.openAuthors();
        return true;
      },
    });
    this.addCommand({
      id: "ai-descriptions",
      name: "Fill in descriptions (Claude)",
      checkCallback: (checking) => {
        if (!claudeAvailable()) return false;
        if (!checking) this.openDescriptions();
        return true;
      },
    });
    this.addCommand({
      id: "ai-recap",
      name: "Recap previous volumes (Claude)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const book = file && claudeAvailable() ? getBook(this.app, file) : undefined;
        if (!book || !hasEarlierVolumes(this.app, book)) return false;
        if (!checking) this.openRecap(book);
        return true;
      },
    });
    this.addCommand({
      id: "ai-profile",
      name: "Open reading profile",
      callback: () => void this.openProfile(),
    });

    this.addSettingTab(new ShelfmarkSettingTab(this.app, this));

    this.registerEvent(
      this.app.metadataCache.on("deleted", (file, prev) => {
        if (!this.settings.deleteCoverWithNote || prev?.frontmatter?.type !== BOOK_TYPE) return;
        const cover = resolveCoverLink(this.app, prev.frontmatter.cover, file.path);
        // A short delay so the link cache forgets the deleted note.
        if (cover) window.setTimeout(() => void trashCoverIfUnused(this.app, this.settings, cover, file.path), 1000);
      })
    );

    // A class on book note views lets us hide properties in those notes only.
    const retag = debounce(() => this.tagBookViews(), 200, true);
    this.registerEvent(this.app.workspace.on("file-open", () => this.tagBookViews()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.tagBookViews()));
    this.registerEvent(this.app.metadataCache.on("changed", retag));

    this.app.workspace.onLayoutReady(async () => {
      this.tagBookViews();
      const migrated = await migrateCoverLinks(this.app);
      if (migrated) console.log(`Shelfmark: converted ${migrated} covers to links`);
      const panels = await migratePanels(this.app);
      if (panels) console.log(`Shelfmark: added the panel to ${panels} notes`);
      // A short delay so Obsidian has loaded the properties of all notes.
      window.setTimeout(() => this.remindLoans(), 3000);
    });
  }

  /** The current note if it is a book; otherwise pick one from a list. */
  private withBook(run: (book: BookEntry) => void): void {
    const file = this.app.workspace.getActiveFile();
    const active = file && getBooks(this.app).find((b) => b.file.path === file.path);
    if (active) run(active);
    else new BookSuggestModal(this.app, run).open();
  }

  async toggleFavorite(file: TFile): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (fm.favorite === true) delete fm.favorite;
      else fm.favorite = true;
    });
  }

  editWish(book: BookEntry): void {
    new WishModal(this.app, this.settings, book, async (wish) => {
      await this.app.fileManager.processFrontMatter(book.file, (fm) => {
        const set = (key: string, value: unknown) => {
          if (value === undefined || value === "" || value === false) delete fm[key];
          else fm[key] = value;
        };
        set("wish_priority", wish.priority);
        set("price", wish.price);
        set("shop_url", wish.shopUrl);
        set("gift", wish.gift);
      });
    }).open();
  }

  /** "Bought": the book moves from the wishlist to the shelf, in the chosen format. */
  boughtMenu(book: BookEntry): Menu {
    const menu = new Menu();
    for (const format of FORMATS) {
      menu.addItem((item) =>
        item.setTitle(`Bought: ${format}`).onClick(async () => {
          await this.app.fileManager.processFrontMatter(book.file, (fm) => {
            fm.owned = true;
            fm.format = format;
            delete fm.gift;
          });
          new Notice(`“${book.title}” is now on your shelf.`);
        })
      );
    }
    return menu;
  }

  openQueue(): void {
    new QueueModal(this.app).open();
  }

  async toggleQueue(book: BookEntry): Promise<void> {
    if (book.queue !== undefined) {
      await removeFromQueue(this.app, book.file);
      new Notice("Removed from the reading queue.");
      return;
    }
    await addToQueue(this.app, book.file);
    // A queued book is waiting to be read, so it gets the "to read" status.
    if (book.status !== "to read") {
      await this.app.fileManager.processFrontMatter(book.file, (fm) => {
        fm.status = "to read";
      });
    }
    new Notice("Added to the reading queue.");
  }

  async exportWishlist(): Promise<void> {
    const file = await exportWishlist(this.app, this.settings);
    await this.app.workspace.getLeaf(false).openFile(file);
    new Notice("Wishlist ready. You can export it to PDF from the note menu.");
  }

  editSeries(book: BookEntry): void {
    new SeriesModal(this.app, book, async (series, index) => {
      await this.app.fileManager.processFrontMatter(book.file, (fm) => {
        fm.series = series || null;
        fm.series_index = series && index ? index : null;
      });
    }).open();
  }

  /** Opens the library with a filter set, e.g. after clicking a series name in a note. */
  async openLibraryFiltered(filters: Record<string, string>): Promise<void> {
    await this.activateLibrary();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_LIBRARY)[0];
    if (leaf?.view instanceof LibraryView) leaf.view.applyFilters(filters);
  }

  addEntry(book: BookEntry, kind: EntryKind): void {
    new EntryModal(this.app, this, book, kind).open();
  }

  statusMenu(book: BookEntry, menu = new Menu()): Menu {
    for (const s of STATUSES) {
      menu.addItem((item) =>
        item
          .setTitle(s.label)
          .setIcon(s.icon)
          .setChecked(book.status === s.id)
          .onClick(() => this.setStatus(book.file, s.id))
      );
      // Right below "Read": pick a date, for books read long ago or on another day than today.
      if (s.id === "read") {
        const when = book.status === "read" ? formatReadDate(book.finished) : "";
        menu.addItem((item) =>
          item
            .setTitle(book.status === "read" ? `When read… (${when || "unknown"})` : "Read earlier…")
            .setIcon("calendar-check")
            .onClick(() => this.editReadDate(book))
        );
      }
    }
    return menu;
  }

  editReadDate(book: BookEntry): void {
    new ReadDateModal(this.app, book).open();
  }

  openReadDates(): void {
    new ReadDatesModal(this.app).open();
  }

  /** The full book menu, shared by the library and the panel in the note. */
  bookMenu(book: BookEntry): Menu {
    const menu = this.statusMenu(book);
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(book.favorite ? "Remove from favorites" : "Add to favorites")
        .setIcon("heart")
        .onClick(() => this.toggleFavorite(book.file))
    );
    menu.addItem((item) =>
      item
        .setTitle(book.queue !== undefined ? "Remove from reading queue" : "Add to reading queue")
        .setIcon("list-ordered")
        .onClick(() => this.toggleQueue(book))
    );
    if (!book.owned) {
      menu.addItem((item) => item.setTitle("Wishlist…").setIcon("gift").onClick(() => this.editWish(book)));
    }
    menu.addSeparator();
    for (let n = 5; n >= 1; n--) {
      menu.addItem((item) =>
        item
          .setTitle("★".repeat(n) + "☆".repeat(5 - n))
          .setChecked(book.rating === n)
          .onClick(() => this.setRating(book.file, n))
      );
    }
    if (book.rating) {
      menu.addItem((item) => item.setTitle("Clear rating").setIcon("eraser").onClick(() => this.setRating(book.file, null)));
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("Update progress").setIcon("bookmark-plus").onClick(() => this.askProgress(book))
    );
    menu.addItem((item) =>
      item.setTitle("Add note").setIcon("pencil-line").onClick(() => this.addEntry(book, "note"))
    );
    menu.addItem((item) => item.setTitle("Add quote").setIcon("quote").onClick(() => this.addEntry(book, "quote")));
    menu.addItem((item) =>
      item.setTitle("Add thought").setIcon("lightbulb").onClick(() => this.addEntry(book, "thought"))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(book.owned ? "I don\'t own this book" : "I own this book")
        .setIcon(book.owned ? "package-minus" : "package-check")
        .onClick(() => this.setOwned(book.file, !book.owned))
    );
    const loan = bookLoan(book);
    if (loan) {
      menu.addItem((item) =>
        item
          .setTitle(loan.direction === "lent" ? `Returned by ${loan.person}` : `Given back to ${loan.person}`)
          .setIcon("undo-2")
          .onClick(() => void this.endLoan(loan))
      );
    } else {
      menu.addItem((item) =>
        item
          .setTitle(book.owned ? "Lend to someone…" : "Borrowed from someone…")
          .setIcon("hand-helping")
          .onClick(() => this.startLoan(book, book.owned ? "lent" : "borrowed"))
      );
    }
    menu.addItem((item) =>
      item
        .setTitle(book.series ? "Change series" : "Set series")
        .setIcon("library-big")
        .onClick(() => this.editSeries(book))
    );
    if (this.settings.aiEnabled && claudeAvailable() && hasEarlierVolumes(this.app, book)) {
      menu.addItem((item) =>
        item.setTitle("Recap previous volumes").setIcon("history").onClick(() => this.openRecap(book))
      );
    }
    menu.addItem((item) => item.setTitle("Change cover").setIcon("image").onClick(() => this.changeCover(book.file)));
    menu.addItem((item) => item.setTitle("Refresh data").setIcon("refresh-cw").onClick(() => this.refreshBook(book.file)));
    return menu;
  }

  askProgress(book: BookEntry): void {
    new NumberPromptModal(
      this.app,
      `Progress: ${book.title}`,
      "Which page are you on?",
      book.currentPage,
      (page) => void this.setProgress(book.file, page),
      book.pages ? `The book has ${book.pages} pages.` : undefined
    ).open();
  }

  /** Saves the page; a book not yet "reading" starts being read, and the last page finishes it. */
  async setProgress(file: TFile, page: number): Promise<void> {
    let finished = false;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.current_page = page;
      if (fm.status !== "reading" && fm.status !== "read") fm.status = "reading";
      delete fm.queue;
      if (!fm.started) fm.started = today();
      const pages = Number(fm.pages);
      if (pages > 0 && page >= pages && fm.status !== "read") {
        fm.status = "read";
        if (!fm.finished) fm.finished = today();
        finished = true;
      }
    });
    if (finished) new Notice("Last page! The book is marked as read.");
  }

  setGoal(): void {
    new NumberPromptModal(
      this.app,
      "Yearly goal",
      "How many books do you want to read this year?",
      this.settings.yearlyGoal || undefined,
      async (goal) => {
        this.settings.yearlyGoal = goal;
        await this.saveSettings();
        this.refreshLibraryViews();
      },
      "Enter 0 to hide the goal."
    ).open();
  }

  refreshLibraryViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_LIBRARY)) {
      if (leaf.view instanceof LibraryView) leaf.view.render();
    }
  }

  private withActiveBook(checking: boolean, run: (file: TFile) => void): boolean {
    const file = this.app.workspace.getActiveFile();
    if (!file || !isBook(this.app, file)) return false;
    if (!checking) run(file);
    return true;
  }

  private bookQuery(file: TFile): string {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    if (fm.isbn13) return String(fm.isbn13);
    const author = Array.isArray(fm.author) ? fm.author[0] : fm.author;
    return [fm.title ?? file.basename, author].filter(Boolean).join(" ");
  }

  changeCover(file: TFile): void {
    new CoverModal(this.app, this, file, this.bookQuery(file)).open();
  }

  refreshBook(file: TFile): void {
    new BookSearchModal(
      this.app,
      this,
      this.bookQuery(file),
      async (r) => {
        try {
          const changed = await refreshMetadata(this.app, this.settings, file, await withDescription(r));
          new Notice(changed.length ? `Updated: ${changed.join(", ")}` : "Nothing to fill in.");
        } catch (e) {
          console.error("Shelfmark: could not refresh data", e);
          new Notice(`Could not refresh data: ${e instanceof Error ? e.message : e}`);
        }
      },
      "Refresh data: choose an edition"
    ).open();
  }

  cleanCovers(): void {
    const orphans = findOrphanCovers(this.app, this.settings);
    if (!orphans.length) {
      new Notice("All covers are in use.");
      return;
    }
    new ConfirmModal(
      this.app,
      "Unused covers",
      `Found ${orphans.length} covers that no note uses. Move them to the trash?`,
      orphans.map((f) => f.name),
      "Move to trash",
      async () => {
        for (const f of orphans) await this.app.fileManager.trashFile(f);
        new Notice(`Moved to trash: ${orphans.length}`);
      }
    ).open();
  }

  onunload(): void {
    this.aiRun?.abort();
    document.body.removeClass("shelfmark-show-props");
    this.app.workspace.iterateAllLeaves((leaf) => leaf.view.containerEl.removeClass("shelfmark-book-note"));
  }

  tagBookViews(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      const book = !!view.file && isBook(this.app, view.file);
      view.containerEl.toggleClass("shelfmark-book-note", book && this.settings.hideProperties);
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateLibrary(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_LIBRARY)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_LIBRARY, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /** Profile and suggestions from Claude Code; desktop only. */
  async suggestBooks(): Promise<void> {
    if (this.aiRun) return;
    if (!claudeAvailable()) {
      new Notice("Suggestions can be made in Obsidian on desktop.");
      return;
    }
    const step = (s: string) => {
      this.aiStep = s;
      this.refreshLibraryViews();
    };
    try {
      step("Gathering library data…");
      const request = await prepareRequest(this.app, this.settings);
      this.aiRun = this.startClaude(request.prompt);
      if (!this.aiRun) return;
      step("Claude is reading your library (usually 1–2 minutes)…");
      const answer = await this.aiRun.result;
      const count = await saveAnswer(this.app, this.settings, request, answer, step);
      new Notice(count ? `Claude suggests ${count} books.` : "Claude found no new suggestions.");
    } catch (e) {
      console.error("Shelfmark: AI suggestions", e);
      new Notice(`Suggestions: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.aiRun = null;
      step("");
    }
  }

  /** Runs Claude Code in the vault folder; null when that is impossible (e.g. on mobile). */
  startClaude(prompt: string): ClaudeRun | null {
    const adapter = this.app.vault.adapter;
    if (!claudeAvailable() || !(adapter instanceof FileSystemAdapter)) {
      new Notice("Claude Code works only in Obsidian on desktop.");
      return null;
    }
    return askClaude(this.settings.claudePath || findClaude(), adapter.getBasePath(), prompt, this.settings.aiModel);
  }

  startLoan(book: BookEntry, direction: LoanDirection): void {
    new LoanModal(this.app, book, direction).open();
  }

  async endLoan(loan: Loan): Promise<void> {
    await endLoan(this.app, loan);
    new Notice(loan.direction === "lent" ? `“${loan.book.title}” is back on the shelf.` : `Gave back “${loan.book.title}”.`);
  }

  private remindLoans(): void {
    const overdue = getLoans(this.app).filter(isOverdue);
    if (!overdue.length) return;
    const names = overdue.slice(0, 3).map((l) => `“${l.book.title}” (${l.person})`).join(", ");
    new Notice(`Loans need attention: ${names}${overdue.length > 3 ? "…" : ""}`, 10000);
  }

  openPick(): void {
    new PickModal(this.app, this).open();
  }

  openGenres(): void {
    new GenresModal(this.app, this).open();
  }

  openAuthors(): void {
    new ReviewModal(this.app, this, authorsTask(this.app, this.settings)).open();
  }

  openDescriptions(): void {
    new ReviewModal(this.app, this, descriptionsTask(this.app, this.settings)).open();
  }

  openRecap(book: BookEntry): void {
    new RecapModal(this.app, this, book).open();
  }

  /** Library cleanups done by Claude; every change goes through a review dialog. */
  cleanupMenu(): Menu {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Tidy up genres").setIcon("tags").onClick(() => this.openGenres()));
    menu.addItem((i) => i.setTitle("Unify authors").setIcon("users").onClick(() => this.openAuthors()));
    menu.addItem((i) => i.setTitle("Fill in descriptions").setIcon("text").onClick(() => this.openDescriptions()));
    return menu;
  }

  stopSuggesting(): void {
    this.aiRun?.abort();
  }

  async rejectSuggestion(s: Suggestion): Promise<void> {
    await rejectSuggestion(this.app, this.settings, s);
  }

  async openProfile(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(profilePath(this.settings));
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    else new Notice("The profile is created with the first suggestions from Claude.");
  }

  async openStats(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_STATS)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_STATS, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  openSearch(query = ""): void {
    new BookSearchModal(this.app, this, query).open();
  }

  async addBook(result: BookSearchResult, opts: AddBookOptions): Promise<void> {
    const existing = result.sourceId ? findDuplicate(this.app, result) : undefined;
    if (existing) {
      new Notice(`“${existing.title}” is already in the library.`);
      await this.app.workspace.getLeaf(false).openFile(existing.file);
      return;
    }
    try {
      const file = await createBookNote(this.app, this.settings, result, opts);
      new Notice(`Added “${result.title}”.`);
      if (this.settings.openAfterAdd) await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      console.error("Shelfmark: could not add the book", e);
      new Notice(`Could not add the book: ${e instanceof Error ? e.message : e}`);
    }
  }

  async setStatus(file: TFile, status: BookStatus): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.status = status;
      // The queue holds books waiting to be read; a started or set-aside book leaves it.
      if (status !== "to read") delete fm.queue;
      if ((status === "reading" || status === "read") && !fm.started) fm.started = today();
      if (status === "read" && !fm.finished) fm.finished = today();
    });
  }

  async setRating(file: TFile, rating: number | null): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.rating = rating;
    });
  }

  async setOwned(file: TFile, owned: boolean): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.owned = owned;
    });
  }
}
