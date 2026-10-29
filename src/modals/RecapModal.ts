import { App, Component, MarkdownRenderer, Modal, Notice, setIcon } from "obsidian";
import type ShelfmarkPlugin from "../main";
import { buildRecapPrompt } from "../aiRecap";
import type { ClaudeRun } from "../claude";
import { addEntry } from "../library";
import type { BookEntry } from "../types";

/** A recap of a series' previous volumes, which can be saved to the book's notes. */
export class RecapModal extends Modal {
  private run: ClaudeRun | null = null;
  private component = new Component();

  constructor(app: App, private plugin: ShelfmarkPlugin, private book: BookEntry) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("shelfmark-recap-modal");
    this.titleEl.setText(`Before you read: ${this.book.title}`);
    this.component.load();
    void this.ask();
  }

  private async ask(): Promise<void> {
    const status = this.contentEl.createDiv({
      cls: "shelfmark-suggest-status",
      text: `Claude is recalling the previous volumes of “${this.book.series}”…`,
    });
    const bar = this.contentEl.createDiv("shelfmark-pick-bar");
    const stop = bar.createEl("button", { text: "Stop" });
    stop.addEventListener("click", () => this.run?.abort());
    try {
      this.run = this.plugin.startClaude(await buildRecapPrompt(this.app, this.plugin.settings, this.book));
      if (!this.run) return this.close();
      const text = (await this.run.result).trim();
      status.setText("No spoilers from this volume. Claude may get details wrong.");
      const body = this.contentEl.createDiv("shelfmark-recap-body markdown-rendered");
      await MarkdownRenderer.render(this.app, text, body, this.book.file.path, this.component);
      this.contentEl.appendChild(bar);
      bar.empty();
      const save = bar.createEl("button", { cls: "shelfmark-panel-btn" });
      setIcon(save.createSpan(), "pencil-line");
      save.createSpan({ text: "Save to notes" });
      save.addEventListener("click", async () => {
        await addEntry(this.app, this.book.file, { kind: "note", text: `**Recap of previous volumes (Claude)**\n\n${text}` });
        new Notice("Recap saved to the book's notes.");
        this.close();
      });
    } catch (e) {
      status.setText(e instanceof Error ? e.message : String(e));
      bar.empty();
    } finally {
      this.run = null;
    }
  }

  onClose(): void {
    this.run?.abort();
    this.component.unload();
    this.contentEl.empty();
  }
}
