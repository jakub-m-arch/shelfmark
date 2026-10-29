import { App, Modal, Setting } from "obsidian";

/** A simple dialog with a single number field. */
export class NumberPromptModal extends Modal {
  constructor(
    app: App,
    private heading: string,
    private label: string,
    private initial: number | undefined,
    private onSubmit: (value: number) => void,
    private hint?: string
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.heading);
    let input!: HTMLInputElement;
    const submit = () => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < 0) return;
      this.close();
      this.onSubmit(Math.round(value));
    };

    const setting = new Setting(this.contentEl).setName(this.label).addText((t) => {
      input = t.inputEl;
      input.type = "number";
      input.inputMode = "numeric";
      input.min = "0";
      if (this.initial !== undefined) t.setValue(String(this.initial));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
    });
    if (this.hint) setting.setDesc(this.hint);

    new Setting(this.contentEl).addButton((b) => b.setButtonText("Save").setCta().onClick(submit));
    window.setTimeout(() => input.select(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
