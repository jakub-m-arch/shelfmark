import { AbstractInputSuggest, App, Modal, Setting } from "obsidian";
import { allSeries } from "../library";
import type { BookEntry } from "../types";

/** Suggests series already in the library, to avoid typos like "Witchr". */
class SeriesSuggest extends AbstractInputSuggest<string> {
  constructor(app: App, private input: HTMLInputElement, private series: string[]) {
    super(app, input);
  }

  getSuggestions(query: string): string[] {
    const q = query.toLocaleLowerCase();
    return this.series.filter((s) => s.toLocaleLowerCase().includes(q));
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.input.value = value;
    this.input.dispatchEvent(new Event("input"));
    this.close();
  }
}

export class SeriesModal extends Modal {
  constructor(
    app: App,
    private book: BookEntry,
    private onSubmit: (series: string, index: number | undefined) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(`Series: ${this.book.title}`);
    let series = this.book.series ?? "";
    let index = this.book.seriesIndex;
    const submit = () => {
      this.close();
      this.onSubmit(series.trim(), index);
    };

    new Setting(this.contentEl).setName("Series name").addText((t) => {
      t.setPlaceholder("e.g. The Witcher").setValue(series).onChange((v) => (series = v));
      new SeriesSuggest(this.app, t.inputEl, allSeries(this.app));
      window.setTimeout(() => t.inputEl.focus(), 0);
    });

    new Setting(this.contentEl).setName("Volume").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.inputMode = "decimal";
      t.inputEl.step = "0.5";
      if (index) t.setValue(String(index));
      t.onChange((v) => (index = Number(v) > 0 ? Number(v) : undefined));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
    });

    const buttons = new Setting(this.contentEl);
    if (this.book.series) {
      buttons.addButton((b) =>
        b.setButtonText("Remove from series").onClick(() => {
          series = "";
          index = undefined;
          submit();
        })
      );
    }
    buttons.addButton((b) => b.setButtonText("Save").setCta().onClick(submit));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
