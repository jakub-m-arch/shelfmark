import { App, PluginSettingTab, Setting } from "obsidian";
import type ShelfmarkPlugin from "./main";
import { CLAUDE_MODELS, claudeAvailable, findClaude } from "./claude";
import { STATUSES, type BookStatus } from "./types";

export interface ShelfmarkSettings {
  folder: string;
  coversFolder: string;
  fileNameTemplate: string;
  defaultStatus: BookStatus;
  downloadCovers: boolean;
  deleteCoverWithNote: boolean;
  openAfterAdd: boolean;
  yearlyGoal: number;
  hideProperties: boolean;
  detailsOpen: boolean;
  googleApiKey: string;
  usePolishNationalLibrary: boolean;
  language: string;
  currency: string;
  aiEnabled: boolean;
  claudePath: string;
  aiModel: string;
  aiCount: number;
}

export const DEFAULT_SETTINGS: ShelfmarkSettings = {
  folder: "Library",
  coversFolder: "Library/covers",
  fileNameTemplate: "{{author}} - {{title}}",
  defaultStatus: "to read",
  downloadCovers: true,
  deleteCoverWithNote: true,
  openAfterAdd: true,
  yearlyGoal: 0,
  hideProperties: true,
  detailsOpen: true,
  googleApiKey: "",
  usePolishNationalLibrary: false,
  language: "",
  currency: "",
  aiEnabled: true,
  claudePath: "",
  aiModel: "",
  aiCount: 10,
};

export class ShelfmarkSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ShelfmarkPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();

    new Setting(containerEl)
      .setName("Library folder")
      .setDesc("Where book notes are created.")
      .addText((t) =>
        t.setValue(s.folder).onChange(async (v) => {
          s.folder = v.trim();
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Covers folder")
      .addText((t) =>
        t.setValue(s.coversFolder).onChange(async (v) => {
          s.coversFolder = v.trim();
          await save();
        })
      );

    new Setting(containerEl)
      .setName("File name")
      .setDesc("Available: {{author}}, {{title}}, {{year}}")
      .addText((t) =>
        t.setValue(s.fileNameTemplate).onChange(async (v) => {
          s.fileNameTemplate = v || DEFAULT_SETTINGS.fileNameTemplate;
          await save();
        })
      );

    new Setting(containerEl).setName("Default status").addDropdown((d) => {
      for (const st of STATUSES) d.addOption(st.id, st.label);
      d.setValue(s.defaultStatus).onChange(async (v) => {
        s.defaultStatus = v as BookStatus;
        await save();
      });
    });

    new Setting(containerEl)
      .setName("Download covers")
      .setDesc("Saves the cover in the vault, so it works offline and on every device.")
      .addToggle((t) =>
        t.setValue(s.downloadCovers).onChange(async (v) => {
          s.downloadCovers = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Delete cover with the note")
      .setDesc("When a book note is deleted, its cover goes to the trash unless something else uses it.")
      .addToggle((t) =>
        t.setValue(s.deleteCoverWithNote).onChange(async (v) => {
          s.deleteCoverWithNote = v;
          await save();
        })
      );

    new Setting(containerEl).setName("Open note after adding").addToggle((t) =>
      t.setValue(s.openAfterAdd).onChange(async (v) => {
        s.openAfterAdd = v;
        await save();
      })
    );

    new Setting(containerEl)
      .setName("Hide properties in book notes")
      .setDesc("Instead of the long properties table, the book panel shows “Details”. Other notes are unaffected.")
      .addToggle((t) =>
        t.setValue(s.hideProperties).onChange(async (v) => {
          s.hideProperties = v;
          await save();
          this.plugin.tagBookViews();
        })
      );

    new Setting(containerEl)
      .setName("Yearly goal")
      .setDesc("Number of books to read this year. 0 hides the goal in the library.")
      .addText((t) => {
        t.inputEl.type = "number";
        t.setValue(String(s.yearlyGoal)).onChange(async (v) => {
          s.yearlyGoal = Math.max(0, Math.round(Number(v) || 0));
          await save();
          this.plugin.refreshLibraryViews();
        });
      });

    new Setting(containerEl)
      .setName("Currency")
      .setDesc("Shown next to wishlist prices, e.g. $, €, zł.")
      .addText((t) =>
        t.setValue(s.currency).onChange(async (v) => {
          s.currency = v.trim();
          await save();
        })
      );

    new Setting(containerEl).setName("Search").setHeading();

    new Setting(containerEl)
      .setName("Google Books API key")
      .setDesc(
        "Optional. Without a key Google Books is skipped, because it rejects anonymous requests. You can create a free key in the Google Cloud Console (Books API)."
      )
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(s.googleApiKey).onChange(async (v) => {
          s.googleApiKey = v.trim();
          await save();
        });
      });

    new Setting(containerEl)
      .setName("National Library of Poland")
      .setDesc("Polish editions from the BN catalog: publisher, year, translator, original title. No covers or descriptions.")
      .addToggle((t) =>
        t.setValue(s.usePolishNationalLibrary).onChange(async (v) => {
          s.usePolishNationalLibrary = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Preferred language")
      .setDesc(
        "Language code, e.g. en or de. Search prefers editions in this language, and Claude writes descriptions, genres and suggestions in it. Empty means all languages, with Claude writing in English."
      )
      .addText((t) =>
        t.setValue(s.language).onChange(async (v) => {
          s.language = v.trim().toLowerCase();
          await save();
        })
      );

    new Setting(containerEl).setName("AI suggestions").setHeading();

    new Setting(containerEl)
      .setName("Show suggestions")
      .setDesc(
        "The “For you” section in the library. Suggestions and the reading profile are made by Claude Code on your subscription (desktop only); your phone sees the saved results."
      )
      .addToggle((t) =>
        t.setValue(s.aiEnabled).onChange(async (v) => {
          s.aiEnabled = v;
          await save();
          this.plugin.refreshLibraryViews();
        })
      );

    if (!claudeAvailable()) return;

    new Setting(containerEl)
      .setName("Claude Code path")
      .setDesc(`Leave empty to detect automatically (currently: ${findClaude()}).`)
      .addText((t) =>
        t.setPlaceholder("~/.local/bin/claude").setValue(s.claudePath).onChange(async (v) => {
          s.claudePath = v.trim();
          await save();
        })
      );

    new Setting(containerEl).setName("Model").addDropdown((d) => {
      for (const [id, label] of CLAUDE_MODELS) d.addOption(id, label);
      d.setValue(s.aiModel).onChange(async (v) => {
        s.aiModel = v;
        await save();
      });
    });

    new Setting(containerEl)
      .setName("Tidy up genres")
      .setDesc("Claude builds one consistent genre vocabulary and suggests missing series. You approve every change.")
      .addButton((b) => b.setButtonText("Tidy up…").onClick(() => this.plugin.openGenres()));

    new Setting(containerEl)
      .setName("Unify authors")
      .setDesc("One spelling per author, e.g. “Lem, Stanisław” and “S. Lem” → “Stanisław Lem”.")
      .addButton((b) => b.setButtonText("Unify…").onClick(() => this.plugin.openAuthors()));

    new Setting(containerEl)
      .setName("Descriptions")
      .setDesc("Descriptions in your preferred language for books with none or with a description in another language, marked as written by Claude.")
      .addButton((b) => b.setButtonText("Fill in…").onClick(() => this.plugin.openDescriptions()));

    new Setting(containerEl)
      .setName("Number of suggestions")
      .addSlider((sl) =>
        sl
          .setLimits(3, 20, 1)
          .setDynamicTooltip()
          .setValue(s.aiCount)
          .onChange(async (v) => {
            s.aiCount = v;
            await save();
          })
      );
  }
}
