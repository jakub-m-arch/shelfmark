import { moment } from "obsidian";
import type { ShelfmarkSettings } from "./settings";

/** Dates are always shown in English, regardless of Obsidian's language, to match the interface. */
export function formatDate(value: string | number | undefined): string {
  return value === undefined || value === "" ? "" : moment(value).locale("en").format("MMM D, YYYY");
}

export function formatPrice(price: number, settings: ShelfmarkSettings): string {
  return [price, settings.currency].filter(Boolean).join(" ");
}

/** The language Claude writes in: the preferred language from settings, or English. */
export function contentLanguage(settings: ShelfmarkSettings): string {
  if (!settings.language) return "English";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(settings.language) ?? settings.language;
  } catch {
    return settings.language;
  }
}
