import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
/** The workflow without comments, for checks on what it actually does. */
const steps = workflow
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
  engines: { node: string };
};

describe("CI workflow (H7)", () => {
  it("runs on push and pull request, read-only", () => {
    expect(workflow).toMatch(/^on:\n {2}push:\n {2}pull_request:/m);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it("references only npm scripts that exist", () => {
    const used = [...workflow.matchAll(/npm run ([a-z:-]+)/g)].map((m) => m[1]!);
    expect(used).toEqual(
      expect.arrayContaining(["format:check", "typecheck", "lint", "test", "build"]),
    );
    for (const script of used) expect(pkg.scripts, script).toHaveProperty([script]);
  });

  it("uses a Node version the project supports", () => {
    const version = /node-version: "(\d+)"/.exec(workflow)?.[1];
    const minimum = /^>=(\d+)\.(\d+)/.exec(pkg.engines.node);
    expect(version).toBeDefined();
    expect(minimum).not.toBeNull();
    // setup-node resolves a major to its latest release, which satisfies ">=major.minor".
    expect(Number(version)).toBeGreaterThanOrEqual(Number(minimum![1]));
  });

  it("uses no Docker, no repository secrets, and never deploys or pushes", () => {
    expect(steps).not.toMatch(/docker|services:|container:/i);
    expect(steps).not.toMatch(/\$\{\{\s*secrets\./);
    expect(steps).not.toMatch(/git push|git tag|npm publish|deploy:/);
  });
});
