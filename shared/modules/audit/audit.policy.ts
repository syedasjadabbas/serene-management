/**
 * Financial redaction of audit snapshots (Phase 10, M1; docs/ARCHITECTURE.md
 * D54). Audit and history surfaces are governed by `audit:read` or by the
 * resource's own read permission (a stay's history by `frontdesk:read`), but
 * ledger facts inside `before`/`after` — folio balances and settlement,
 * posted amounts, taxes, revenue — are billing data. Without `billing:read`
 * for the row's scope their values are replaced by a marker, so general audit
 * or operational access never becomes a way around billing permissions.
 *
 * Reservation pricing (rate plan, quoted totals) is reservation data and stays
 * visible: reservation staff see it on the reservation itself.
 */

export const FINANCIAL_REDACTION = "(restricted)";

/** Keys whose whole value is billing data. */
const FINANCIAL_KEYS = new Set([
  "folio",
  "folios",
  "net",
  "taxes",
  "settlement",
  "payments",
  "refunds",
  "deposits",
  "penalty",
]);

/** Money-like keys by suffix: amount, balance, revenue, total, price (e.g. balanceAfter, noShowFeeTotal). */
const FINANCIAL_SUFFIX = /(amount|balance|revenue|total|price)$/i;

export function isFinancialAuditKey(key: string): boolean {
  return FINANCIAL_KEYS.has(key) || FINANCIAL_SUFFIX.test(key);
}

/** Returns a copy of an audit snapshot with financial values replaced; other values unchanged. */
export function redactFinancial(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactFinancial);
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    result[key] = isFinancialAuditKey(key) ? FINANCIAL_REDACTION : redactFinancial(inner);
  }
  return result;
}

/**
 * Guest contact and restriction details in audit snapshots (L9): shown only
 * to callers who may read guest profiles (`guests:read`), as on the profile.
 * Names stay visible so the trail still identifies the record.
 */
const PERSONAL_KEYS = new Set(["email", "phone", "contacts", "addresses", "restrictionReason"]);

function redactKeys(value: unknown, keys: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => redactKeys(item, keys));
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    result[key] = keys.has(key) ? FINANCIAL_REDACTION : redactKeys(inner, keys);
  }
  return result;
}

/** The snapshot pair as a caller may see it. */
export function auditSnapshots<
  T extends { before: unknown; after: unknown; resourceType?: string },
>(row: T, financialVisible: boolean, personalVisible = true): { before: unknown; after: unknown } {
  let before = row.before;
  let after = row.after;
  if (!financialVisible) {
    before = redactFinancial(before);
    after = redactFinancial(after);
  }
  if (!personalVisible && row.resourceType === "Guest") {
    before = redactKeys(before, PERSONAL_KEYS);
    after = redactKeys(after, PERSONAL_KEYS);
  }
  return { before, after };
}
