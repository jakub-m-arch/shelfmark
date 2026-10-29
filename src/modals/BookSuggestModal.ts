import { App, FuzzySuggestModal } from "obsidian";
import { getBooks } from "../library";
import type { BookEntry } from "../types";

/** Picks a book from the library; the ones you're reading come first. */
export class BookSuggestModal extends FuzzySuggestModal<BookEntry> {
  constructor(app: App, private onChoose: (book: BookEntry) => void) {
    super(app);
    this.setPlaceholder("Choose a book");
  }

  getItems(): BookEntry[] {
    const reading = (b: BookEntry) => (b.status === "reading" ? 0 : 1);
    return getBooks(this.app).sort((a, b) => reading(a) - reading(b) || b.added - a.added);
  }

  getItemText(book: BookEntry): string {
    return book.authors.length ? `${book.title} — ${book.authors.join(", ")}` : book.title;
  }

  onChooseItem(book: BookEntry): void {
    this.onChoose(book);
  }
}
