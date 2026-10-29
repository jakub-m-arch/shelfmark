import { App, Modal, Notice, Setting } from "obsidian";
import type ShelfmarkPlugin from "../main";
import { withDescription } from "../providers";
import { FORMATS, STATUSES, type AddBookOptions, type BookSearchResult, type BookStatus } from "../types";
import { readDateFromState, renderReadDateFields, type ReadDateState } from "./ReadDateModal";

export class AddBookModal extends Modal {
  private opts: AddBookOptions;

  constructor(app: App, private plugin: ShelfmarkPlugin, private result: BookSearchResult) {
    super(app);
    this.opts = { status: plugin.settings.defaultStatus, owned: false, format: "" };
  }

  onOpen(): void {
    const r = this.result;
    this.modalEl.addClass("shelfmark-add-modal");
    this.titleEl.setText(r.title);

    const head = this.contentEl.createDiv("shelfmark-add-head");
    if (r.thumbnailUrl) {
      const img = head.createEl("img", { cls: "shelfmark-add-cover", attr: { src: r.thumbnailUrl } });
      img.addEventListener("error", () => img.remove());
    }
    const info = head.createDiv();
    if (r.subtitle) info.createDiv({ cls: "shelfmark-result-subtitle", text: r.subtitle });
    if (r.authors.length) info.createDiv({ cls: "shelfmark-result-author", text: r.authors.join(", ") });
    const meta = [r.publisher, r.publishedDate, r.pages ? `${r.pages} pp.` : "", r.isbn13]
      .filter(Boolean)
      .join(" · ");
    if (meta) info.createDiv({ cls: "shelfmark-result-meta", text: meta });
    if (r.averageRating) {
      info.createDiv({
        cls: "shelfmark-result-meta",
        text: `Average rating: ${r.averageRating}/5${r.ratingsCount ? ` (${r.ratingsCount} ratings)` : ""}`,
      });
    }
    if (r.translators?.length) {
      info.createDiv({ cls: "shelfmark-result-meta", text: `transl. ${r.translators.join(", ")}` });
    }
    const desc = this.contentEl.createEl("p", { cls: "shelfmark-add-desc" });
    this.showDescription(desc);

    const readDate: ReadDateState = { when: "today" };
    new Setting(this.contentEl).setName("Status").addDropdown((d) => {
      for (const s of STATUSES) d.addOption(s.id, s.label);
      d.setValue(this.opts.status).onChange((v) => {
        this.opts.status = v as BookStatus;
        whenEl.toggle(v === "read");
      });
    });
    const whenEl = this.contentEl.createDiv();
    renderReadDateFields(whenEl, readDate);
    whenEl.toggle(this.opts.status === "read");

    new Setting(this.contentEl).setName("I own it").addToggle((t) =>
      t.setValue(this.opts.owned).onChange((v) => (this.opts.owned = v))
    );

    new Setting(this.contentEl).setName("Format").addDropdown((d) => {
      d.addOption("", "—");
      for (const f of FORMATS) d.addOption(f, f);
      d.setValue(this.opts.format).onChange((v) => (this.opts.format = v));
    });

    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText("Add to library")
        .setCta()
        .onClick(async () => {
          if (this.opts.status === "read" && readDate.when !== "today") {
            if (readDate.when === "date" && !readDate.year) {
              new Notice("Enter the year you read it, or choose “Don't remember”.");
              return;
            }
            this.opts.finished = readDateFromState(readDate) ?? null;
          }
          b.setDisabled(true).setButtonText("Adding…");
          await this.plugin.addBook(this.result, this.opts);
          this.close();
        })
    );
  }

  /** Shows the description right away if there is one; otherwise fetches it from Open Library in the background. */
  private async showDescription(el: HTMLElement): Promise<void> {
    if (!this.result.description) {
      el.setText("Looking for a description…");
      this.result = await withDescription(this.result);
    }
    const plain = (this.result.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!plain) {
      el.remove();
      return;
    }
    el.setText(plain.length > 400 ? `${plain.slice(0, 400)}…` : plain);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
