"use client";

import { type KeyboardEvent, useId, useRef } from "react";

/**
 * WAI-ARIA tabs behaviour for existing tab buttons (no styling): ids linking
 * each tab to the panel, a roving tabindex (only the selected tab is in the
 * Tab order), and ArrowLeft/ArrowRight (mirrored in RTL), Home and End that
 * select and focus a tab (automatic activation).
 *
 *   const tabs = useTabs(ids, selected, select);
 *   <div role="tablist" aria-label="…">{ids.map((id) => <button {...tabs.tab(id)} …/>)}</div>
 *   <div {...tabs.panel}>…</div>
 */
export function useTabs<T extends string | number>(
  ids: readonly T[],
  selected: T | undefined,
  onSelect: (id: T) => void,
) {
  const prefix = useId();
  const elements = useRef(new Map<T, HTMLElement>());
  const current = selected !== undefined && ids.includes(selected) ? selected : ids[0];

  function focusAndSelect(id: T) {
    onSelect(id);
    elements.current.get(id)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>, id: T) {
    const index = ids.indexOf(id);
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const step =
      event.key === "ArrowRight" ? (rtl ? -1 : 1) : event.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    let next: T | undefined;
    if (step !== 0) next = ids[(index + step + ids.length) % ids.length];
    else if (event.key === "Home") next = ids[0];
    else if (event.key === "End") next = ids[ids.length - 1];
    if (next === undefined) return;
    event.preventDefault();
    focusAndSelect(next);
  }

  const tabId = (id: T) => `${prefix}-tab-${String(id)}`;
  const panelId = `${prefix}-panel`;

  return {
    tab: (id: T) => ({
      id: tabId(id),
      role: "tab" as const,
      "aria-selected": id === current,
      "aria-controls": panelId,
      tabIndex: id === current ? 0 : -1,
      ref: (element: HTMLElement | null) => {
        if (element) elements.current.set(id, element);
        else elements.current.delete(id);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(event, id),
    }),
    panel: {
      id: panelId,
      role: "tabpanel" as const,
      "aria-labelledby": current === undefined ? undefined : tabId(current),
    },
  };
}
