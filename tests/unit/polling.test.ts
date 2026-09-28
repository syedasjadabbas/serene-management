import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * B10: every polling query pauses while the tab is hidden or unfocused
 * (RTK Query `skipPollingIfUnfocused`; focus is tracked by `setupListeners`
 * in lib/api/store.ts). A poll with interval 0 (paging past the first page)
 * does not poll at all.
 */

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("polling (B10)", () => {
  const files = ["app", "components", "hooks"].flatMap(sources);

  it("pauses every active poll in background tabs", () => {
    const offenders: string[] = [];
    let polls = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // Each options object that polls, as written in this codebase: `pollingInterval: X`
      // followed (within the same object) by `skipPollingIfUnfocused: true`.
      for (const match of text.matchAll(/pollingInterval:\s*([^,}\n]+)/g)) {
        if (match[1]!.trim() === "0") continue;
        polls += 1;
        const rest = text.slice(match.index, match.index! + 200);
        const object = rest.slice(0, rest.indexOf("}") === -1 ? undefined : rest.indexOf("}"));
        if (!/skipPollingIfUnfocused:\s*true/.test(object)) offenders.push(file);
      }
    }
    expect(polls).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });

  it("has RTK Query focus and visibility listeners registered", () => {
    expect(readFileSync("lib/api/store.ts", "utf8")).toMatch(/setupListeners\(store\.dispatch\)/);
  });
});
