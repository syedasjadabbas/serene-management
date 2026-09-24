"use client";

import { useState } from "react";

/**
 * Cursors of the pages loaded so far for one list; starts over whenever the
 * list key (view, filter, search) changes.
 */
export function useCursorPages(key: string) {
  const [pages, setPages] = useState<{ key: string; cursors: (string | undefined)[] }>({
    key,
    cursors: [undefined],
  });
  const cursors = pages.key === key ? pages.cursors : [undefined];
  return {
    cursors,
    loadMore: (cursor: string) => setPages({ key, cursors: [...cursors, cursor] }),
  };
}
