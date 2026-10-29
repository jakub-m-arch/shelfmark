import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type ShelfmarkPlugin from "../main";
import { fetchImage, imageExt, replaceCover, type ImageData } from "../library";
import { BookSearchModal } from "./BookSearchModal";

export class CoverModal extends Modal {
  constructor(app: App, private plugin: ShelfmarkPlugin, private file: TFile, private query: string) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Change cover");

    new Setting(this.contentEl)
      .setName("Search online")
      .setDesc("Choose the edition whose cover you want to use.")
      .addButton((b) =>
        b.setButtonText("Search").onClick(() => {
          this.close();
          new BookSearchModal(
            this.app,
            this.plugin,
            this.query,
            async (r) => {
              const image = await fetchImage(r.coverUrls);
              if (!image) {
                new Notice("This edition has no cover to download.");
                return;
              }
              await this.apply(image);
            },
            "Choose a cover"
          ).open();
        })
      );

    const input = this.contentEl.createEl("input", {
      type: "file",
      attr: { accept: "image/*", style: "display: none" },
    });
    input.addEventListener("change", async () => {
      const picked = input.files?.[0];
      if (!picked) return;
      this.close();
      await this.apply({ data: await picked.arrayBuffer(), ext: imageExt(picked.type) });
    });

    new Setting(this.contentEl)
      .setName("From device")
      .setDesc("Your own photo, e.g. of your copy. On a phone you can take it with the camera.")
      .addButton((b) => b.setButtonText("Choose file").onClick(() => input.click()));

    new Setting(this.contentEl)
      .setName("From clipboard")
      .setDesc("A copied image or image URL. You can also just press ⌘V / Ctrl+V in this window.")
      .addButton((b) => b.setButtonText("Paste").onClick(() => void this.pasteFromClipboard()));

    // Pasting with the shortcut also works where the browser won't let a button read the clipboard.
    this.modalEl.addEventListener("paste", (e) => void this.onPaste(e));
    document.addEventListener("paste", this.documentPaste);
  }

  private documentPaste = (e: ClipboardEvent) => {
    if (!this.modalEl.contains(e.target as Node)) void this.onPaste(e);
  };

  private async onPaste(e: ClipboardEvent): Promise<void> {
    const data = e.clipboardData;
    if (!data) return;
    const file = Array.from(data.files).find((f) => f.type.startsWith("image/"));
    const text = data.getData("text/plain").trim();
    if (!file && !isUrl(text)) return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
    if (file) await this.apply({ data: await file.arrayBuffer(), ext: imageExt(file.type) });
    else await this.applyUrl(text);
  }

  private async pasteFromClipboard(): Promise<void> {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        this.close();
        await this.apply({ data: await blob.arrayBuffer(), ext: imageExt(type) });
        return;
      }
      const text = (await navigator.clipboard.readText()).trim();
      if (isUrl(text)) {
        this.close();
        await this.applyUrl(text);
        return;
      }
      new Notice("The clipboard has no image or image URL.");
    } catch {
      new Notice("No access to the clipboard. Press ⌘V / Ctrl+V in this window.");
    }
  }

  private async applyUrl(url: string): Promise<void> {
    const image = await fetchImage([url]);
    if (image) await this.apply(image);
    else new Notice("There is no downloadable image at this URL.");
  }

  private async apply(image: ImageData): Promise<void> {
    try {
      await replaceCover(this.app, this.plugin.settings, this.file, image);
      new Notice("Cover changed.");
    } catch (e) {
      console.error("Shelfmark: could not change the cover", e);
      new Notice(`Could not change the cover: ${e instanceof Error ? e.message : e}`);
    }
  }

  onClose(): void {
    document.removeEventListener("paste", this.documentPaste);
    this.contentEl.empty();
  }
}

function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text);
}
