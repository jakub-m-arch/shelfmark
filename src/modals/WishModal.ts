import { App, Modal, Setting } from "obsidian";
import type { ShelfmarkSettings } from "../settings";
import { WISH_PRIORITIES, type BookEntry } from "../types";

export interface Wish {
  priority: string;
  price?: number;
  shopUrl: string;
  gift: boolean;
}

/** Wishlist details: how much you want it, for how much, where, and whether it is a gift idea. */
export class WishModal extends Modal {
  constructor(
    app: App,
    private settings: ShelfmarkSettings,
    private book: BookEntry,
    private onSubmit: (wish: Wish) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(`Wishlist: ${this.book.title}`);
    const wish: Wish = {
      priority: this.book.wishPriority ?? "",
      price: this.book.price,
      shopUrl: this.book.shopUrl ?? "",
      gift: this.book.gift,
    };

    new Setting(this.contentEl).setName("How much you want it").addDropdown((d) => {
      d.addOption("", "—");
      for (const p of WISH_PRIORITIES) d.addOption(p.id, p.label);
      d.setValue(wish.priority).onChange((v) => (wish.priority = v));
    });

    new Setting(this.contentEl).setName(this.settings.currency ? `Price (${this.settings.currency})` : "Price").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.inputMode = "decimal";
      t.inputEl.step = "0.01";
      if (wish.price) t.setValue(String(wish.price));
      t.onChange((v) => (wish.price = Number(v) > 0 ? Number(v) : undefined));
    });

    new Setting(this.contentEl)
      .setName("Where to buy")
      .setDesc("A link to a bookshop or second-hand store.")
      .addText((t) => {
        t.inputEl.type = "url";
        t.setPlaceholder("https://…").setValue(wish.shopUrl).onChange((v) => (wish.shopUrl = v.trim()));
      });

    new Setting(this.contentEl)
      .setName("Gift idea")
      .setDesc("Goes to the top of the wishlist you can send to family and friends.")
      .addToggle((t) => t.setValue(wish.gift).onChange((v) => (wish.gift = v)));

    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText("Save")
        .setCta()
        .onClick(() => {
          this.close();
          this.onSubmit(wish);
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
