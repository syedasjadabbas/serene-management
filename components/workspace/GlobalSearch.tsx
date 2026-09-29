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
import { OptionRow, highlight, matches, useActiveOption } from "@/components/ui/listbox";
import { Spinner } from "@/components/ui/Spinner";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRatePlansQuery } from "@/lib/api/endpoints/rates.api";
import { useRoomBoardViewQuery, useRoomPickerQuery } from "@/lib/api/endpoints/rooms.api";
import {
  type RemoteSearchSource,
  type SearchHit,
  useGlobalSearchQuery,
} from "@/lib/api/endpoints/search.api";

export type SearchSource = RemoteSearchSource | "rooms" | "ratePlans";

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
/** Result groups in this order: today's work first, reference data last. */
const ORDER: SearchSource[] = [
  "reservations",
  "guests",
  "rooms",
  "folios",
  "companies",
  "groups",
  "maintenance",
  "ratePlans",
];
const MIN_QUERY = 2;
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

const titleCase = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");

export interface GlobalSearchProps {
  /** The current property; null in the organization workspace. */
  property: { id: string; code: string } | null;
  /** Property each organization-level record type (guests, companies) opens in; null = none permitted. */
  profileCodes: { guests: string | null; companies: string | null };
  /** Codes of the properties the user can access: a result never opens anywhere else. */
  openableCodes: readonly string[];
  /** Sources this user may search (already permission-filtered by the caller). */
  sources: SearchSource[];
  /** Where a room result opens (its board with the room selected), or null. */
  roomHref: ((roomId: string) => string) | null;
}

interface FlatHit extends SearchHit {
  source: SearchSource;
}

/**
 * Global search (Ctrl/Cmd+K): a command palette over every record type the
 * user may open, scoped to the current property (guests and companies are
 * organization profiles). Results are grouped by type with the match
 * highlighted; arrows move, Enter opens, Escape closes and focus returns to
 * the search button. Recent searches (this browser only) show before typing.
 */
export function GlobalSearch({
  property,
  profileCodes,
  openableCodes,
  sources,
  roomHref,
}: GlobalSearchProps) {
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

  const remote = sources.filter((s): s is RemoteSearchSource => s !== "rooms" && s !== "ratePlans");
  const search = useGlobalSearchQuery(
    { q: debounced, sources: remote, property, profileCodes },
    { skip: !open || !searching || remote.length === 0 },
  );
  const wantRooms = open && property !== null && sources.includes("rooms");
  const roomList = useRoomPickerQuery(property?.id ?? "", { skip: !wantRooms });
  const board = useRoomBoardViewQuery({ propertyId: property?.id ?? "" }, { skip: !wantRooms });
  const wantPlans = open && property !== null && sources.includes("ratePlans");
  const plans = useRatePlansQuery(property?.id ?? "", { skip: !wantPlans });

  const groups = useMemo(() => {
    if (!searching) return [] as { source: SearchSource; hits: FlatHit[] }[];
    const bySource = new Map<SearchSource, FlatHit[]>();
    for (const group of search.data ?? []) {
      bySource.set(
        group.source,
        group.hits.map((hit) => ({ ...hit, source: group.source })),
      );
    }
    if (wantRooms && roomHref && property) {
      const status = new Map((board.data?.items ?? []).map((row) => [row.id, row]));
      const rooms = (roomList.data ?? [])
        .filter((room) => matches(debounced, room.number, room.roomTypeCode))
        .slice(0, 5)
        .map((room): FlatHit => {
          const row = status.get(room.id);
          return {
            source: "rooms",
            id: room.id,
            title: `Room ${room.number}`,
            subtitle: [room.roomTypeCode, row?.floor?.name].filter(Boolean).join(" · "),
            meta: row
              ? `${titleCase(row.frontOfficeStatus)} · ${titleCase(row.housekeepingStatus)}`
              : undefined,
            href: roomHref(room.id),
          };
        });
      if (rooms.length) bySource.set("rooms", rooms);
    }
    if (wantPlans && property) {
      const found = (plans.data ?? [])
        .filter((plan) => matches(debounced, plan.code, plan.name))
        .slice(0, 5)
        .map((plan): FlatHit => ({
          source: "ratePlans",
          id: plan.id,
          title: `${plan.code} · ${plan.name}`,
          subtitle: `${titleCase(plan.kind)} · ${plan.currencyCode}`,
          meta: plan.status === "ACTIVE" ? undefined : "Inactive",
          href: `/${property.code}/rates/${plan.id}`,
        }));
      if (found.length) bySource.set("ratePlans", found);
    }
    return ORDER.filter((source) => bySource.has(source)).map((source) => ({
      source,
      hits: bySource.get(source)!,
    }));
  }, [
    searching,
    search.data,
    wantRooms,
    roomHref,
    property,
    board.data,
    roomList.data,
    debounced,
    wantPlans,
    plans.data,
  ]);

  const flat = useMemo(() => groups.flatMap((group) => group.hits), [groups]);
  // Last check before a link is used: its property must be one the user can
  // access (the routes are built from permitted properties already).
  const openable = (hit: FlatHit | undefined): hit is FlatHit & { href: string } =>
    Boolean(hit?.href && openableCodes.includes(hit.href.split("/")[1] ?? ""));
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
    if (!openable(hit)) return;
    saveRecent(query.trim());
    close();
    router.push(hit.href as Route);
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

  const loading = searching && (search.isFetching || debounced !== query.trim());
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
                  const meta = SOURCE_META[group.source];
                  const headingId = `${id}-${group.source}`;
                  return (
                    <li key={group.source} role="presentation" className="mb-1">
                      <div id={headingId} className="px-2.5 pt-2.5 pb-1 label-caps">
                        {meta.label}
                      </div>
                      <ul role="group" aria-labelledby={headingId}>
                        {group.hits.map((hit, h) => {
                          const current = offsets[g]! + h;
                          return (
                            <OptionRow
                              key={`${group.source}-${hit.id}`}
                              id={optionId(current)}
                              icon={hit.vip ? Star : meta.icon}
                              label={highlight(hit.title, debounced)}
                              description={highlight(hit.subtitle, debounced)}
                              trailing={
                                openable(hit) ? hit.meta : "Not available in your properties"
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
                {searching && !loading
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
