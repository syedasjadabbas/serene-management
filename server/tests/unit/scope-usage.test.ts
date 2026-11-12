import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guard for the data-scope rule: a Prisma `where` must take its property /
 * organization filter from `propertyWhere` / `organizationWhere`
 * (`server/lib/scope.ts`), never from a hand-written
 * `propertyId: ctx.propertyId` / `organizationId: ctx.organizationId`.
 * Justified exceptions carry `// scope-exempt: <reason>` on that line.
 */
const MODULES = join(__dirname, "..", "..", "modules");
const LITERAL = /^(propertyId|organizationId)$/;
const CTX_VALUE = /^ctx\.(propertyId|organizationId)$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(repository|service)\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

function isWhereContext(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)) {
      if (n.name.text === "where") return true;
      if (["data", "create", "update", "select", "include", "orderBy"].includes(n.name.text)) {
        return false;
      }
    }
    if (ts.isVariableDeclaration(n)) {
      return (
        (n.type !== undefined && /WhereInput/.test(n.type.getText())) ||
        (ts.isIdentifier(n.name) && n.name.text === "where")
      );
    }
    if (ts.isFunctionLike(n) || ts.isReturnStatement(n)) return false;
  }
  return false;
}

function findViolations(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines = text.split(/\r?\n/);
  const found: string[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isPropertyAssignment(n) &&
      ts.isIdentifier(n.name) &&
      LITERAL.test(n.name.text) &&
      CTX_VALUE.test(n.initializer.getText()) &&
      isWhereContext(n)
    ) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line;
      if (!/scope-exempt:\s*\S/.test(lines[line] ?? "")) {
        found.push(`${file}:${line + 1}: ${n.getText()}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe("data scope usage", () => {
  it("builds Prisma where scope with propertyWhere / organizationWhere", () => {
    const violations = sourceFiles(MODULES).flatMap((f) =>
      findViolations(relative(MODULES, f), readFileSync(f, "utf8")),
    );
    expect(violations).toEqual([]);
  });

  it("flags a hand-written scope in a where and honours scope-exempt", () => {
    const bad = "const r = tx.x.findMany({ where: { propertyId: ctx.propertyId, id } });";
    expect(findViolations("a.ts", bad)).toHaveLength(1);
    const ok = "tx.x.create({ data: { propertyId: ctx.propertyId } });";
    expect(findViolations("a.ts", ok)).toHaveLength(0);
    const exempt =
      "tx.x.findMany({ where: { propertyId: ctx.propertyId } }); // scope-exempt: reason";
    expect(findViolations("a.ts", exempt)).toHaveLength(0);
    const typed = "const a: Prisma.XWhereInput[] = [{ organizationId: ctx.organizationId }];";
    expect(findViolations("a.ts", typed)).toHaveLength(1);
  });
});
