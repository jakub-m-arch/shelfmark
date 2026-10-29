import { App, Modal, Notice, Setting } from "obsidian";
import { today } from "../library";
import { knownPeople, startLoan, type LoanDirection } from "../loans";
import type { BookEntry } from "../types";

const LABELS: Record<LoanDirection, { title: string; person: string; saved: string }> = {
  lent: { title: "Lend", person: "To whom", saved: "Loan saved." },
  borrowed: { title: "Borrowed", person: "From whom", saved: "Loan saved." },
};

/** Records a loan: the person, the date and (optionally) the due date. */
export class LoanModal extends Modal {
  constructor(app: App, private book: BookEntry, private direction: LoanDirection) {
    super(app);
  }

  onOpen(): void {
    const labels = LABELS[this.direction];
    this.modalEl.addClass("shelfmark-loan-modal");
    this.titleEl.setText(`${labels.title}: ${this.book.title}`);

    let person = "";
    let since = today();
    let returnBy = "";

    new Setting(this.contentEl).setName(labels.person).addText((t) => {
      t.setPlaceholder("Name").onChange((v) => (person = v.trim()));
      // Suggestions from earlier loans, so the same person doesn't end up spelled three ways.
      const list = this.contentEl.createEl("datalist", { attr: { id: "shelfmark-loan-people" } });
      for (const p of knownPeople(this.app)) list.createEl("option", { value: p });
      t.inputEl.setAttr("list", "shelfmark-loan-people");
      window.setTimeout(() => t.inputEl.focus(), 0);
    });

    new Setting(this.contentEl).setName("Since").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(since).onChange((v) => (since = v || today()));
    });

    new Setting(this.contentEl)
      .setName("Due back")
      .setDesc("Optional. After this date the library reminds you about this book.")
      .addText((t) => {
        t.inputEl.type = "date";
        t.onChange((v) => (returnBy = v));
      });

    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText("Save")
        .setCta()
        .onClick(async () => {
          if (!person) {
            new Notice("Enter a name.");
            return;
          }
          this.close();
          await startLoan(this.app, this.book.file, this.direction, { person, since, returnBy: returnBy || undefined });
          new Notice(labels.saved);
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
