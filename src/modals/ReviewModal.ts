import { App, Modal, Notice } from "obsidian";
import type ShelfmarkPlugin from "../main";
import type { ClaudeRun } from "../claude";

export interface ReviewTask<T> {
  title: string;
  /** Shown while Claude is working. */
  waiting: string;
  /** Shown when there's nothing to change. */
  empty: string;
  /** The prompt and how to read the answer; null when there's nothing to send (then `empty` is shown). */
  prepare: () => Promise<{ prompt: string; parse: (answer: string) => T[] } | null>;
  render: (el: HTMLElement, item: T) => void;
  apply: (items: T[]) => Promise<void>;
  /** An extra note below the proposal count. */
  note?: (items: T[]) => string;
}

/**
 * A shared dialog for changes proposed by Claude: every proposal has a checkbox,
 * and only what is checked and approved reaches the notes.
 */
export class ReviewModal<T> extends Modal {
  private statusEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private footerEl!: HTMLElement;
  private run: ClaudeRun | null = null;

  constructor(app: App, private plugin: ShelfmarkPlugin, private task: ReviewTask<T>) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("shelfmark-genres-modal");
    this.titleEl.setText(this.task.title);
    this.statusEl = this.contentEl.createDiv("shelfmark-suggest-status");
    this.bodyEl = this.contentEl.createDiv("shelfmark-genres-body");
    this.footerEl = this.contentEl.createDiv("shelfmark-pick-bar");
    void this.ask();
  }

  private async ask(): Promise<void> {
    this.statusEl.setText(this.task.waiting);
    const stop = this.footerEl.createEl("button", { text: "Stop" });
    stop.addEventListener("click", () => this.run?.abort());
    try {
      const request = await this.task.prepare();
      if (!request) {
        this.statusEl.setText(this.task.empty);
        this.footerEl.empty();
        return;
      }
      this.run = this.plugin.startClaude(request.prompt);
      if (!this.run) return this.close();
      this.render(request.parse(await this.run.result));
    } catch (e) {
      this.statusEl.setText(e instanceof Error ? e.message : String(e));
      this.footerEl.empty();
    } finally {
      this.run = null;
    }
  }

  private render(items: T[]): void {
    this.footerEl.empty();
    if (!items.length) {
      this.statusEl.setText(this.task.empty);
      return;
    }
    const note = this.task.note?.(items);
    this.statusEl.setText(`Proposals: ${items.length}. Uncheck what you don't want.${note ? ` ${note}` : ""}`);

    const chosen = new Set(items);
    const list = this.bodyEl.createDiv("shelfmark-genres-list");
    for (const item of items) {
      const row = list.createEl("label", { cls: "shelfmark-genres-row shelfmark-review-row" });
      const box = row.createEl("input", { type: "checkbox" });
      box.checked = true;
      box.addEventListener("change", () => (box.checked ? chosen.add(item) : chosen.delete(item)));
      this.task.render(row.createDiv("shelfmark-review-item"), item);
    }

    const apply = this.footerEl.createEl("button", { cls: "mod-cta", text: "Apply selected" });
    apply.addEventListener("click", async () => {
      apply.disabled = true;
      apply.setText("Saving…");
      const selected = items.filter((i) => chosen.has(i));
      await this.task.apply(selected);
      new Notice(selected.length ? `Changes saved: ${selected.length}.` : "Nothing changed.");
      this.close();
    });
  }

  onClose(): void {
    this.run?.abort();
    this.contentEl.empty();
  }
}
