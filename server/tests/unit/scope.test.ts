import { describe, expect, it } from "vitest";
import {
  organizationFilterSql,
  organizationScoped,
  organizationWhere,
  propertyFilterSql,
  propertyScoped,
  propertyWhere,
} from "@/lib/scope";

const P = "11111111-1111-4111-8111-111111111111";
const O = "22222222-2222-4222-8222-222222222222";

describe("scope helpers", () => {
  it("builds a where from a context or a bare id object", () => {
    expect(propertyWhere({ propertyId: P })).toEqual({ propertyId: P });
    expect(organizationWhere({ organizationId: O })).toEqual({ organizationId: O });
  });

  it("merges the scope into an existing where and the scope wins", () => {
    expect(propertyScoped({ propertyId: P }, { id: "x", propertyId: "other" })).toEqual({
      id: "x",
      propertyId: P,
    });
    expect(organizationScoped({ organizationId: O }, { status: "ACTIVE" })).toEqual({
      status: "ACTIVE",
      organizationId: O,
    });
  });

  it("builds bound SQL predicates, with or without a table alias", () => {
    const aliased = propertyFilterSql({ propertyId: P }, "rr");
    expect(aliased.text).toBe('rr."property_id" = $1::uuid');
    expect(aliased.values).toEqual([P]);
    const bare = organizationFilterSql({ organizationId: O });
    expect(bare.text).toBe('"organization_id" = $1::uuid');
    expect(bare.values).toEqual([O]);
  });

  it("rejects an unsafe SQL alias", () => {
    expect(() => propertyFilterSql({ propertyId: P }, 'x"; DROP TABLE y; --')).toThrow(/alias/);
  });
});
