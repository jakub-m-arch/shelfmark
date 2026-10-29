import { App, Modal, Setting } from "obsidian";

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private heading: string,
    private message: string,
    private items: string[],
    private confirmText: string,
    private onConfirm: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.heading);
    this.contentEl.createEl("p", { text: this.message });
    if (this.items.length) {
      const list = this.contentEl.createEl("ul", { cls: "shelfmark-confirm-list" });
      for (const item of this.items) list.createEl("li", { text: item });
    }
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(this.confirmText)
          .setWarning()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
