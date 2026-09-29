"use client";

import { ChevronsUpDown, type LucideIcon, Search, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "./cn";
import { controlClass, fieldErrorClass, fieldHintClass, fieldLabelClass } from "./field";
import {
  OptionGroupHeading,
  OptionRow,
  highlight,
  matches,
  popoverPanelClass,
  useActiveOption,
  useAnchoredPopover,
} from "./listbox";
import { Spinner } from "./Spinner";

export interface SelectItem {
  value: string;
  label: string;
  /** One line under the label (room status, company code, dates). */
  description?: string;
  /** Items with the same group are listed under one heading, in order. */
  group?: string;
  icon?: LucideIcon;
  /** Extra words the search matches (codes, synonyms). */
  keywords?: string;
  disabled?: boolean;
}

export interface SearchableSelectProps {
  label: string;
  hideLabel?: boolean;
  items: readonly SelectItem[];
  /** Selected value; "" or null means nothing selected. */
  value: string | null;
  onChange: (value: string, item: SelectItem | null) => void;
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  /** Search field inside the panel: default when there are more than 7 items or options load asynchronously. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Shows a clear button while something is selected (selects ""). */
  clearable?: boolean;
  disabled?: boolean;
  errors?: string[];
  hint?: string;
  className?: string;
  /**
   * Asynchronous options: the parent searches (debounced) with the query it
   * receives here and passes the results as `items`; no local filtering.
   */
  onSearchChange?: (query: string) => void;
  /** The selected item's label when it may not be among `items` (async). */
  selectedLabel?: string;
  loading?: boolean;
  /** Async: minimum characters before searching, and what to show until then. */
  minSearchLength?: number;
  searchPrompt?: string;
  emptyText?: ReactNode;
}

/**
 * The SERENE dropdown (docs/DESIGN_SYSTEM.md §6): a combobox button that
 * opens a branded listbox in the top layer, with an optional search field,
 * groups, highlighted matches, a check on the selected option, loading and
 * empty states. Keys: Enter, Space or ArrowDown open; arrows, Home and End
 * move; Enter chooses; Escape closes without choosing (and never closes a
 * surrounding dialog); focus returns to the button. Typing on the closed
 * button starts a search.
 */
export function SearchableSelect({
  label,
  hideLabel = false,
  items,
  value,
  onChange,
  placeholder = "Select",
  searchable,
  searchPlaceholder,
  clearable = false,
  disabled = false,
  errors,
  hint,
  className,
  onSearchChange,
  selectedLabel,
  loading = false,
  minSearchLength = 0,
  searchPrompt,
  emptyText = "No matches",
}: SearchableSelectProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const async = onSearchChange !== undefined;
  const withSearch = searchable ?? (async || items.length > 7);
  const { popoverRef, style } = useAnchoredPopover(rootRef, open);

  const selected = items.find((item) => item.value === value) ?? null;
  const shown = useMemo(
    () =>
      async || !query.trim()
        ? items
        : items.filter((item) =>
            matches(query, item.label, item.description, item.keywords, item.group),
          ),
    [async, items, query],
  );
  const optionId = useCallback((index: number) => `${id}-opt-${index}`, [id]);
  const choose = (index: number) => {
    const item = shown[index];
    if (!item || item.disabled) return;
    onChange(item.value, item);
    close();
  };
  const nav = useActiveOption({
    count: shown.length,
    isDisabled: (index) => Boolean(shown[index]?.disabled),
    onChoose: choose,
    optionId,
  });

  function openList(seed = "") {
    if (disabled) return;
    setQuery(seed);
    onSearchChange?.(seed);
    const index = seed
      ? 0
      : Math.max(
          0,
          items.findIndex((item) => item.value === value),
        );
    nav.setActive(items.length ? index : -1);
    setOpen(true);
  }
  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }

  // Move focus into the panel once it is open.
  useEffect(() => {
    if (!open) return;
    (withSearch ? searchRef.current : listRef.current)?.focus();
  }, [open, withSearch]);

  // Close when a click or focus lands outside the control and its panel.
  useEffect(() => {
    if (!open) return;
    const inside = (node: EventTarget | null) =>
      node instanceof Node &&
      (rootRef.current?.contains(node) || popoverRef.current?.contains(node));
    const onPointer = (event: PointerEvent) => {
      if (!inside(event.target)) close(false);
    };
    const onFocus = (event: FocusEvent) => {
      if (!inside(event.target)) close(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open, popoverRef]);

  function onButtonKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openList();
    } else if (withSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      openList(event.key);
    }
  }

  // Keys inside the open panel (search field or listbox).
  const panelKeyRef = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  const onPanelKey = (event: globalThis.KeyboardEvent) => {
    if (event.key === "Escape") {
      // Handled here so a surrounding <dialog> does not close too.
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (nav.onKey(event.key, event.target === searchRef.current)) event.preventDefault();
  };
  useEffect(() => {
    panelKeyRef.current = onPanelKey;
  });
  useEffect(() => {
    const panel = popoverRef.current;
    if (!panel) return;
    const onKey = (event: globalThis.KeyboardEvent) => panelKeyRef.current(event);
    panel.addEventListener("keydown", onKey);
    return () => panel.removeEventListener("keydown", onKey);
  }, [popoverRef]);

  const error = errors?.[0];
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  const shownLabel = selected?.label ?? (value ? selectedLabel : undefined);
  const tooShort = async && query.trim().length < minSearchLength;

  let lastGroup: string | undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span id={`${id}-label`} className={hideLabel ? "sr-only" : fieldLabelClass}>
        {label}
      </span>
      <div ref={rootRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={`${id}-label ${id}-value`}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          disabled={disabled}
          onClick={() => (open ? close() : openList())}
          onKeyDown={onButtonKey}
          className={controlClass(
            Boolean(error),
            cn(
              "flex h-control w-full items-center gap-2 text-start focus-visible:outline-none",
              clearable && shownLabel ? "ps-3 pe-16" : "ps-3 pe-9",
              open && "border-brand shadow-[0_0_0_3px_rgb(16_124_65/0.14)]",
            ),
          )}
        >
          {selected?.icon ? (
            <selected.icon aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
          ) : null}
          <span
            id={`${id}-value`}
            className={cn("min-w-0 flex-1 truncate", !shownLabel && "text-fg-muted")}
          >
            {shownLabel ?? placeholder}
          </span>
        </button>
        {clearable && shownLabel && !disabled ? (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={() => {
              onChange("", null);
              buttonRef.current?.focus();
            }}
            className="absolute inset-y-1 end-8 inline-flex w-7 items-center justify-center rounded-[7px] text-fg-muted hover:bg-surface-sunken hover:text-fg"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
        <ChevronsUpDown
          aria-hidden="true"
          className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
        />

        <div ref={popoverRef} popover="manual" style={style} className={popoverPanelClass}>
          {withSearch && open ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3">
              <Search aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-label={`Search ${label.toLowerCase()}`}
                aria-controls={listId}
                aria-expanded={open}
                aria-autocomplete="list"
                aria-activedescendant={nav.active >= 0 ? optionId(nav.active) : undefined}
                autoComplete="off"
                spellCheck={false}
                value={query}
                placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}…`}
                onChange={(event) => {
                  setQuery(event.target.value);
                  onSearchChange?.(event.target.value);
                  nav.setActive(0);
                }}
                className="h-11 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
              />
              {loading ? <Spinner label="Searching" /> : null}
            </div>
          ) : null}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={`${id}-label`}
            tabIndex={-1}
            aria-activedescendant={
              !withSearch && nav.active >= 0 ? optionId(nav.active) : undefined
            }
            className="min-h-0 flex-1 overflow-y-auto p-1.5 outline-none"
          >
            {/* Options exist only while open: a closed control carries no
            option markup (lighter pages, no hydration differences). */}
            {!open ? null : tooShort ? (
              <li role="presentation" className="px-2.5 py-3 text-sm text-fg-muted">
                {searchPrompt ?? `Type at least ${minSearchLength} characters`}
              </li>
            ) : loading && shown.length === 0 ? (
              <li role="presentation" className="px-2.5 py-3 text-sm text-fg-muted">
                Searching…
              </li>
            ) : shown.length === 0 ? (
              <li role="presentation" className="px-2.5 py-3 text-sm text-fg-muted">
                {emptyText}
              </li>
            ) : (
              shown.map((item, index) => {
                const heading = item.group && item.group !== lastGroup ? item.group : null;
                lastGroup = item.group;
                return (
                  <OptionGroupItem key={`${item.value}-${index}`} heading={heading}>
                    <OptionRow
                      id={optionId(index)}
                      label={highlight(item.label, async ? "" : query)}
                      description={item.description}
                      icon={item.icon}
                      selected={item.value === value}
                      active={index === nav.active}
                      disabled={item.disabled}
                      onChoose={() => choose(index)}
                      onHover={() => nav.setActive(index)}
                    />
                  </OptionGroupItem>
                );
              })
            )}
          </ul>
        </div>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className={fieldHintClass}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={fieldErrorClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** An option, preceded by its group heading when a new group starts. */
function OptionGroupItem({ heading, children }: { heading: string | null; children: ReactNode }) {
  return heading ? (
    <>
      <li role="presentation">
        <OptionGroupHeading>{heading}</OptionGroupHeading>
      </li>
      {children}
    </>
  ) : (
    <>{children}</>
  );
}
