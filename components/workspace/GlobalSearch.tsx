"use client";

import {
  BedDouble,
  Building2,
  CalendarCheck,
  Contact,
  History,
  type LucideIcon,
  Receipt,
  Search,
  Star,
  Tags,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { OptionRow, highlight, useActiveOption } from "@/components/ui/listbox";
import { Spinner } from "@/components/ui/Spinner";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useLazyGlobalSearchQuery } from "@/lib/api/endpoints/search.api";
import {
  SEARCH_MIN_QUERY,
  SEARCH_RESULT_TYPES,
  isCurrentSearch,
  searchResultRoute,
} from "@/modules/search/search.policy";
import type { SearchHitView, SearchResultType } from "@/modules/search/search.types";

export type SearchSource = SearchResultType;

const SOURCE_META: Record<SearchSource, { label: string; icon: LucideIcon }> = {
  reservations: { label: "Reservations", icon: CalendarCheck },
  guests: { label: "Guests", icon: Contact },
  rooms: { label: "Rooms", icon: BedDouble },
  folios: { label: "Folios", icon: Receipt },
  companies: { label: "Companies", icon: Building2 },
  groups: { label: "Groups", icon: UsersRound },
  maintenance: { label: "Maintenance", icon: Wrench },
  ratePlans: { label: "Rate plans", icon: Tags },
};
const ORDER = SEARCH_RESULT_TYPES;
const MIN_QUERY = SEARCH_MIN_QUERY;
const RECENT_KEY = "sm:recent-searches";

function readRecent(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v) => typeof v === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}
function saveRecent(query: string) {
  try {
    const next = [query, ...readRecent().filter((q) => q !== query)].slice(0, 5);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode): recent searches are a convenience only.
  }
}

export interface GlobalSearchProps {
  /** The current property; null in the organization workspace. */
  property: { id: string; code: string } | null;
  /** Codes of the properties the user can access: a result never opens anywhere else. */
  openableCodes: readonly string[];
  /**
   * Types this user may search (mirrors the server's checks, for the hint
   * text only: the server decides what is searched and returned).
   */
  sources: SearchSource[];
}

type FlatHit = SearchHitView;

/**
 * Global search (Ctrl/Cmd+K): a command palette over every record type the
 * user may open, scoped to the current property (guests and companies are
 * organization profiles). One request per debounced query; an older
 * request is cancelled and its response can never replace newer results.
 * Results are grouped by type with the match highlighted; arrows move,
 * Enter opens, Escape closes and focus returns to the search button.
 * Recent searches (this browser only) show before typing.
 */
export function GlobalSearch({ property, openableCodes, sources }: GlobalSearchProps) {
  const router = useRouter();
  const id = useId();
  const listId = `${id}-results`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const debounced = useDebouncedValue(query.trim(), 200);
  const searching = debounced.length >= MIN_QUERY;

  const propertyId = property?.id ?? null;
  const [runSearch, search] = useLazyGlobalSearchQuery();
  // One request per debounced text. Moving on (new text, closed palette,
  // another property, unmount) cancels the one still in flight; the same
  // text never starts a second request (repeated effects included).
  const inFlight = useRef<{ key: string; abort: () => void } | null>(null);
  const start = useCallback(
    (q: string, force: boolean) => {
      inFlight.current?.abort();
      const request = runSearch({ q, propertyId }, !force);
      inFlight.current = { key: `${propertyId ?? ""}\n${q}`, abort: () => request.abort() };
    },
    [runSearch, propertyId],
  );
  useEffect(() => {
    if (!open || !searching) {
      inFlight.current?.abort();
      inFlight.current = null;
      return;
    }
    if (inFlight.current?.key === `${propertyId ?? ""}\n${debounced}`) return;
    start(debounced, false);
  }, [open, searching, debounced, propertyId, start]);
  useEffect(() => () => inFlight.current?.abort(), []);

  const wanted = { q: debounced, propertyId };
  // Only the response to the text on screen is shown (stale-response guard).
  const result = isCurrentSearch(search.currentData, search.originalArgs, wanted)
    ? search.currentData
    : undefined;
  const failed =
    searching &&
    search.isError &&
    search.originalArgs?.q === debounced &&
    search.originalArgs.propertyId === propertyId;

  const groups = useMemo(() => (searching && result ? result.groups : []), [searching, result]);

  const flat = useMemo(() => groups.flatMap((group) => group.hits), [groups]);
  // The route is built here from the result's type, never taken from the
  // response, and only for a property the user can access.
  const hrefOf = (hit: FlatHit | undefined): string | null => {
    if (!hit?.propertyCode || !openableCodes.includes(hit.propertyCode)) return null;
    return searchResultRoute(hit);
  };
  const openable = (hit: FlatHit | undefined): hit is FlatHit => hrefOf(hit) !== null;
  const optionId = useCallback((index: number) => `${id}-hit-${index}`, [id]);
  const nav = useActiveOption({
    count: flat.length,
    isDisabled: (index) => !openable(flat[index]),
    onChoose: (index) => go(flat[index]),
    optionId,
  });

  const openPalette = useCallback(() => {
    setRecent(readRecent());
    setQuery("");
    setOpen(true);
  }, []);
  function close() {
    setOpen(false);
  }
  function go(hit: FlatHit | undefined) {
    const href = hrefOf(hit);
    if (!href) return;
    saveRecent(query.trim());
    close();
    router.push(href as Route);
  }

  // Ctrl/Cmd+K anywhere in the workspace.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (dialogRef.current?.open) inputRef.current?.focus();
        else openPalette();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openPalette]);

  // The native modal dialog: focus trap, Escape, backdrop; focus returns to the button.
  const wasOpen = useRef(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    // Opened with Ctrl/Cmd+K the dialog would hand focus back to the page
    // body; always return it to the search button.
    if (!open && wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // A click on the backdrop lands on the <dialog> element itself: close.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClick = (event: MouseEvent) => {
      if (event.target === dialog) setOpen(false);
    };
    dialog.addEventListener("click", onClick);
    return () => dialog.removeEventListener("click", onClick);
  }, []);

  // First result becomes active as results arrive.
  useEffect(() => {
    nav.setActive(flat.length ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the result set changes
  }, [flat]);

  // Arrow keys and Enter in the search field (listener keeps JSX semantic).
  const keyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyRef.current = (event) => {
      if (nav.onKey(event.key, true)) event.preventDefault();
    };
  });
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onKey = (event: KeyboardEvent) => keyRef.current(event);
    input.addEventListener("keydown", onKey);
    return () => input.removeEventListener("keydown", onKey);
  }, [open]);

  const loading = searching && !failed && (!result || debounced !== query.trim());
  const shortcut =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘K"
      : "Ctrl K";

  // Index of each group's first hit in the flat list (option ids, active option).
  const offsets = groups.map((_, g) =>
    groups.slice(0, g).reduce((n, group) => n + group.hits.length, 0),
  );
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={openPalette}
        className={cn(
          "flex h-10 shrink-0 items-center gap-2 rounded-md border border-border bg-surface text-sm text-fg-muted shadow-card transition-colors duration-150 hover:border-border-strong/60 hover:bg-surface-sunken",
          "w-10 justify-center xl:w-full xl:max-w-md xl:justify-start xl:px-3",
        )}
      >
        <Search
          aria-hidden="true"
          className="size-[1.125rem] shrink-0 text-fg-secondary xl:size-4 xl:text-fg-muted"
        />
        <span className="sr-only xl:not-sr-only xl:flex-1 xl:truncate xl:text-start">
          Search guests, reservations, rooms…
        </span>
        <kbd
          suppressHydrationWarning
          className="hidden rounded-[5px] border border-border-subtle bg-surface-sunken px-1.5 font-mono text-2xs text-fg-secondary xl:inline"
        >
          {shortcut}
        </kbd>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Global search"
        onClose={() => setOpen(false)}
        className={cn(
          "m-0 h-dvh max-h-dvh w-full max-w-none bg-surface-raised p-0 text-fg backdrop:bg-overlay",
          "sm:mx-auto sm:mt-[12vh] sm:h-auto sm:max-h-[70vh] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:rounded-xl sm:border sm:border-border-subtle sm:shadow-overlay",
          "transition-[opacity,translate] duration-150 ease-out-quart motion-reduce:transition-none starting:-translate-y-1 starting:opacity-0",
        )}
      >
        {open ? (
          <div className="flex h-full max-h-[inherit] flex-col">
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle px-4">
              <Search aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-label="Search guests, reservations, rooms and more"
                aria-expanded={flat.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={nav.active >= 0 ? optionId(nav.active) : undefined}
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search guests, reservations, rooms…"
                className="h-full min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-muted"
              />
              {loading ? <Spinner label="Searching" /> : null}
              <button
                type="button"
                onClick={close}
                aria-label="Close search"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-sunken hover:text-fg"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <ul id={listId} role="listbox" aria-label="Search results" className="flex flex-col">
                {groups.map((group, g) => {
                  const meta = SOURCE_META[group.type];
                  const headingId = `${id}-${group.type}`;
                  return (
                    <li key={group.type} role="presentation" className="mb-1">
                      <div id={headingId} className="px-2.5 pt-2.5 pb-1 label-caps">
                        {meta.label}
                      </div>
                      <ul role="group" aria-labelledby={headingId}>
                        {group.hits.map((hit, h) => {
                          const current = offsets[g]! + h;
                          return (
                            <OptionRow
                              key={`${group.type}-${hit.id}`}
                              id={optionId(current)}
                              icon={hit.vip ? Star : meta.icon}
                              label={highlight(hit.title, debounced)}
                              description={highlight(hit.subtitle, debounced)}
                              trailing={
                                openable(hit)
                                  ? (hit.meta ?? undefined)
                                  : "Not available in your properties"
                              }
                              disabled={!openable(hit)}
                              active={current === nav.active}
                              onChoose={() => go(hit)}
                              onHover={() => nav.setActive(current)}
                            />
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ul>

              {!searching ? (
                <div className="px-2.5 py-3">
                  {recent.length ? (
                    <>
                      <p className="pb-1.5 label-caps">Recent searches</p>
                      <ul className="flex flex-col">
                        {recent.map((item) => (
                          <li key={item}>
                            <button
                              type="button"
                              onClick={() => {
                                setQuery(item);
                                inputRef.current?.focus();
                              }}
                              className="flex min-h-10 w-full items-center gap-3 rounded-md px-2 text-start text-sm text-fg hover:bg-surface-sunken"
                            >
                              <History aria-hidden="true" className="size-4 text-fg-muted" />
                              {item}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  <p className={cn("text-sm text-fg-secondary", recent.length > 0 && "mt-4")}>
                    Type at least {MIN_QUERY} characters. Searches{" "}
                    {ORDER.filter((s) => sources.includes(s))
                      .map((s) => SOURCE_META[s].label.toLowerCase())
                      .join(", ")}
                    {property ? " in this property" : ""}.
                  </p>
                </div>
              ) : failed ? (
                <div role="alert" className="px-3 py-10 text-center">
                  <p className="text-sm font-semibold text-fg">Search is unavailable</p>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Check your connection, then{" "}
                    <button
                      type="button"
                      onClick={() => start(debounced, true)}
                      className="font-medium text-fg underline underline-offset-2"
                    >
                      try again
                    </button>
                    .
                  </p>
                </div>
              ) : !loading && flat.length === 0 ? (
                <div role="status" className="px-3 py-10 text-center">
                  <p className="text-sm font-semibold text-fg">No results for “{debounced}”</p>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Check the spelling, or try a confirmation number, room or surname.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="hidden shrink-0 items-center gap-4 border-t border-border-subtle px-4 py-2.5 text-xs text-fg-muted sm:flex">
              <span>
                <kbd className="font-mono">↑↓</kbd> move
              </span>
              <span>
                <kbd className="font-mono">Enter</kbd> open
              </span>
              <span>
                <kbd className="font-mono">Esc</kbd> close
              </span>
              <span aria-live="polite" className="ms-auto">
                {searching && !loading && !failed
                  ? `${flat.length} result${flat.length === 1 ? "" : "s"}`
                  : ""}
              </span>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
