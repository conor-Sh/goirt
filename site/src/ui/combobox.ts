export interface ComboboxEntry<T> {
  id: string;
  label: string;
  meta?: string;
  kind?: string;
  group?: string;
  disabled?: boolean;
  value: T;
}

export interface ComboboxModel<T> {
  entries: ComboboxEntry<T>[];
  announcement: string;
  message?: string;
}

export interface ComboboxConfig<T> {
  root: HTMLElement;
  input: HTMLInputElement;
  listbox: HTMLElement;
  live: HTMLElement;
  status?: HTMLElement;
  resolve(query: string): ComboboxModel<T>;
  onSelect(entry: ComboboxEntry<T>): void;
  onEscape?(): void;
}

export class Combobox<T> {
  private readonly config: ComboboxConfig<T>;
  private entries: ComboboxEntry<T>[] = [];
  private activeIndex = -1;
  private openState = false;

  constructor(config: ComboboxConfig<T>) {
    this.config = config;
    const { root, input, listbox } = config;

    input.addEventListener("focus", () => {
      this.refresh();
      this.open();
    });
    input.addEventListener("input", () => {
      this.refresh();
      this.open();
    });
    input.addEventListener("keydown", (event) => this.onKeyDown(event));
    listbox.addEventListener("pointerdown", (event) => event.preventDefault());
    root.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !root.contains(next)) this.close();
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Node && !root.contains(event.target)) {
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get query(): string {
    return this.config.input.value;
  }

  refresh(): void {
    const model = this.config.resolve(this.config.input.value);
    this.entries = model.entries;
    this.render();
    this.config.live.textContent = model.announcement;

    if (this.config.status) {
      if (model.message) {
        this.config.status.textContent = model.message;
        this.config.status.hidden = false;
      } else {
        this.config.status.textContent = "";
        this.config.status.hidden = true;
      }
    }

    this.activeIndex = -1;
    this.syncActive();
    if (this.openState && this.entries.length === 0) this.close();
  }

  open(): void {
    if (this.entries.length === 0) return;
    this.openState = true;
    this.config.listbox.hidden = false;
    this.config.input.setAttribute("aria-expanded", "true");
    this.syncActive();
  }

  close(): void {
    this.openState = false;
    this.activeIndex = -1;
    this.config.listbox.hidden = true;
    this.config.input.setAttribute("aria-expanded", "false");
    this.config.input.removeAttribute("aria-activedescendant");
    for (const element of this.optionElements()) {
      element.classList.remove("is-active");
      element.setAttribute("aria-selected", "false");
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        if (!this.openState) this.open();
        this.moveActive(1);
        return;
      }
      case "ArrowUp": {
        event.preventDefault();
        if (!this.openState) this.open();
        this.moveActive(-1);
        return;
      }
      case "Home": {
        if (!this.openState) return;
        event.preventDefault();
        const selectable = this.selectableIndices();
        if (selectable.length > 0) this.setActive(selectable[0]);
        return;
      }
      case "End": {
        if (!this.openState) return;
        event.preventDefault();
        const selectable = this.selectableIndices();
        if (selectable.length > 0) this.setActive(selectable.at(-1) ?? -1);
        return;
      }
      case "Enter": {
        if (!this.openState) return;
        event.preventDefault();
        if (this.activeIndex >= 0) {
          this.select(this.activeIndex);
        } else {
          const first = this.selectableIndices()[0];
          if (first !== undefined) this.select(first);
        }
        return;
      }
      case "Escape": {
        if (this.openState) {
          event.preventDefault();
          this.close();
          return;
        }
        this.config.onEscape?.();
        return;
      }
      case "Tab": {
        this.close();
        return;
      }
      default:
        return;
    }
  }

  private selectableIndices(): number[] {
    return this.entries
      .map((entry, index) => (entry.disabled ? -1 : index))
      .filter((index) => index >= 0);
  }

  private moveActive(delta: 1 | -1): void {
    const selectable = this.selectableIndices();
    if (selectable.length === 0) return;
    const position = selectable.indexOf(this.activeIndex);
    let next: number;
    if (position < 0) {
      next = delta > 0 ? selectable[0] : selectable[selectable.length - 1];
    } else {
      next =
        selectable[
          (position + delta + selectable.length) % selectable.length
        ];
    }
    this.setActive(next);
  }

  private setActive(index: number): void {
    if (this.entries.length === 0) return;
    const entry = this.entries[index];
    if (!entry || entry.disabled) return;
    this.activeIndex = index;
    this.syncActive();
    const element = this.optionElements()[this.activeIndex];
    if (element instanceof HTMLElement) element.scrollIntoView({ block: "nearest" });
  }

  private syncActive(): void {
    this.optionElements().forEach((element, index) => {
      const active = index === this.activeIndex;
      element.classList.toggle("is-active", active);
      element.setAttribute("aria-selected", active ? "true" : "false");
    });

    if (this.activeIndex >= 0 && this.openState) {
      this.config.input.setAttribute(
        "aria-activedescendant",
        this.optionId(this.activeIndex),
      );
    } else {
      this.config.input.removeAttribute("aria-activedescendant");
    }
  }

  private optionElements(): HTMLElement[] {
    return Array.from(
      this.config.listbox.querySelectorAll<HTMLElement>('[role="option"]'),
    );
  }

  private optionId(index: number): string {
    return `${this.config.input.id}-option-${index}`;
  }

  private render(): void {
    const fragment = document.createDocumentFragment();
    let lastGroup: string | undefined;
    this.entries.forEach((entry, index) => {
      if (entry.group && entry.group !== lastGroup) {
        const heading = document.createElement("div");
        heading.className = "search-group-label";
        heading.setAttribute("role", "presentation");
        heading.textContent = entry.group;
        fragment.append(heading);
        lastGroup = entry.group;
      }
      if (entry.group === undefined) lastGroup = undefined;

      const option = document.createElement("div");
      option.id = this.optionId(index);
      option.className = "search-option";
      if (entry.kind) option.classList.add(`search-option-${entry.kind}`);
      if (entry.disabled) {
        option.classList.add("search-option-disabled");
        option.setAttribute("aria-disabled", "true");
      }
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");

      const label = document.createElement("span");
      label.className = "search-option-label";
      label.textContent = entry.label;
      option.append(label);

      if (entry.meta) {
        const meta = document.createElement("span");
        meta.className = "search-option-meta";
        meta.textContent = entry.meta;
        option.append(meta);
      }

      option.addEventListener("pointermove", () => {
        if (!entry.disabled && this.activeIndex !== index) this.setActive(index);
      });
      option.addEventListener("click", () => this.select(index));
      fragment.append(option);
    });
    this.config.listbox.replaceChildren(fragment);
  }

  private select(index: number): void {
    const entry = this.entries[index];
    if (!entry || entry.disabled) return;
    this.close();
    this.config.onSelect(entry);
  }
}
