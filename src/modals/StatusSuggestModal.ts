import { App, FuzzySuggestModal } from "obsidian";
import { STATUSES, type BookStatus } from "../types";

type Status = (typeof STATUSES)[number];

export class StatusSuggestModal extends FuzzySuggestModal<Status> {
  constructor(app: App, private onChoose: (status: BookStatus) => void) {
    super(app);
    this.setPlaceholder("Choose a status");
  }

  getItems(): Status[] {
    return [...STATUSES];
  }

  getItemText(item: Status): string {
    return item.label;
  }

  onChooseItem(item: Status): void {
    this.onChoose(item.id);
  }
}
