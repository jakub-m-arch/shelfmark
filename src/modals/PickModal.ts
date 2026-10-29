import { App, Modal, Notice, setIcon } from "obsidian";
import type ShelfmarkPlugin from "../main";
import { MOODS, buildPickPrompt, parsePicks, pickCandidates, type ReadingPick } from "../aiPick";
import type { ClaudeRun } from "../claude";
import { addToQueue, resolveCover } from "../library";

/** "What should I read next?": the reader's wish → up to three books from their shelf. */
export class PickModal extends Modal {
  private moodEl!: HTMLTextAreaElement;
  private askBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private run: ClaudeRun | null = null;

  constructor(app: App, private plugin: ShelfmarkPlugin) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("shelfmark-pick-modal");
    this.titleEl.setText("What should I read next?");

    const count = pickCandidates(this.app).length;
    if (!count) {
      this.contentEl.createDiv({
        cls: "shelfmark-empty",
        text: "You have no unread books on the shelf or in the queue. Add a few and Claude will help you choose.",
      });
      return;
    }
    this.contentEl.createDiv({
      cls: "shelfmark-suggest-status",
      text: `Claude will choose from ${count} books you own or have queued.`,
    });

    const chips = this.contentEl.createDiv("shelfmark-pick-moods");
    for (const mood of MOODS) {
      const chip = chips.createEl("button", { cls: "shelfmark-chip", text: mood });
      chip.addEventListener("click", () => {
        this.moodEl.value = mood;
        void this.ask();
      });
    }

    this.moodEl = this.contentEl.createEl("textarea", {
      cls: "shelfmark-entry-text",
      attr: { rows: "2", placeholder: "What are you in the mood for? E.g. “something short for a train ride”" },
    });
    this.moodEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.ask();
      }
    });

    const bar = this.contentEl.createDiv("shelfmark-pick-bar");
    this.askBtn = bar.createEl("button", { cls: "mod-cta", text: "Suggest" });
    this.askBtn.addEventListener("click", () => void (this.run ? this.stop() : this.ask()));
    this.statusEl = bar.createDiv("shelfmark-suggest-status");
    this.resultsEl = this.contentEl.createDiv("shelfmark-pick-results");
    window.setTimeout(() => this.moodEl.focus(), 0);
  }

  private stop(): void {
    this.run?.abort();
  }

  private async ask(): Promise<void> {
    if (this.run) return;
    const candidates = pickCandidates(this.app);
    this.resultsEl.empty();
    this.statusEl.setText("Claude is looking through your shelf…");
    try {
      const prompt = await buildPickPrompt(this.app, this.plugin.settings, this.moodEl.value, candidates);
      this.run = this.plugin.startClaude(prompt);
      if (!this.run) return;
      this.askBtn.setText("Stop");
      const picks = parsePicks(await this.run.result, candidates);
      this.statusEl.setText(picks.length ? "" : "Claude picked nothing. Try describing it differently.");
      this.renderPicks(picks);
    } catch (e) {
      this.statusEl.setText(e instanceof Error ? e.message : String(e));
    } finally {
      this.run = null;
      this.askBtn?.setText("Suggest");
    }
  }

  private renderPicks(picks: ReadingPick[]): void {
    this.resultsEl.empty();
    for (const { book, reason } of picks) {
      const row = this.resultsEl.createDiv("shelfmark-pick-row");
      const thumb = row.createDiv("shelfmark-reading-thumb");
      const cover = resolveCover(this.app, book);
      if (cover) thumb.createEl("img", { attr: { src: this.app.vault.getResourcePath(cover), alt: book.title } });

      const info = row.createDiv("shelfmark-reading-info");
      info.createDiv({ cls: "shelfmark-card-title", text: book.title });
      info.createDiv({
        cls: "shelfmark-card-author",
        text: [book.authors.join(", "), book.pages ? `${book.pages} pages` : ""].filter(Boolean).join(" · "),
      });
      if (reason) info.createDiv({ cls: "shelfmark-pick-reason", text: reason });

      const actions = info.createDiv("shelfmark-suggest-actions");
      const btn = (icon: string, label: string, run: () => Promise<void>) => {
        const b = actions.createEl("button", { cls: "shelfmark-panel-btn" });
        setIcon(b.createSpan(), icon);
        b.createSpan({ text: label });
        b.addEventListener("click", () => void run());
      };
      btn("book-open", "Start reading", async () => {
        await this.plugin.setStatus(book.file, "reading");
        new Notice(`Enjoy “${book.title}”.`);
        this.close();
        await this.app.workspace.getLeaf(false).openFile(book.file);
      });
      btn("list-start", "Next in queue", async () => {
        await addToQueue(this.app, book.file, true);
        await this.plugin.setStatus(book.file, "to read");
        new Notice(`“${book.title}” is first in the queue.`);
      });
      btn("file-text", "Open", async () => {
        this.close();
        await this.app.workspace.getLeaf(false).openFile(book.file);
      });
    }
  }

  onClose(): void {
    this.run?.abort();
    this.contentEl.empty();
  }
}
