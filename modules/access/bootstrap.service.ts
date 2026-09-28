import "server-only";
import { hashPassword } from "@/lib/auth/password";
import type { Db } from "@/lib/db/prisma";
import { recordAudit } from "@/modules/audit/audit.service";
import { bootstrapOrganization } from "./access.service";
import { type BootstrapInput, bootstrapSchema } from "./bootstrap.schema";

/**
 * First organization and administrator of a fresh installation (H1,
 * docs/DEPLOYMENT.md). Operator-only: invoked through the `ops:bootstrap`
 * command, never over HTTP.
 *
 * - Refuses as soon as ANY organization exists (it is not a way to add
 *   organizations or to reset access to an existing one).
 * - Serialized with a transaction-scoped advisory lock and fully
 *   transactional: either the organization, its role copies, the admin, the
 *   ORGANIZATION_ADMIN grant and the HIGH audit entry all exist, or nothing.
 * - The password is checked against the password policy and hashed with the
 *   application's argon2id before the transaction; it is never returned,
 *   logged or written to the audit trail.
 * - Creates no property: properties are added afterwards in the organization
 *   workspace (Organization → Properties).
 */

export type BootstrapRefusal =
  "ALREADY_BOOTSTRAPPED" | "REFERENCE_DATA_MISSING" | "UNKNOWN_CURRENCY" | "EMAIL_TAKEN";

export class BootstrapRefused extends Error {
  constructor(
    readonly reason: BootstrapRefusal,
    message: string,
  ) {
    super(message);
  }
}

export interface BootstrapResult {
  organizationId: string;
  organizationCode: string;
  adminUserId: string;
  adminEmail: string;
}

/** Arbitrary constant key of the advisory lock that serializes bootstraps. */
const BOOTSTRAP_LOCK_KEY = 7_406_319_001;

export async function bootstrapFirstOrganization(
  db: Db,
  rawInput: BootstrapInput,
  now: Date = new Date(),
): Promise<BootstrapResult> {
  const input = bootstrapSchema.parse(rawInput);
  const passwordHash = await hashPassword(input.adminPassword);

  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY}::bigint)) AS l`;
      if ((await tx.organization.count()) > 0) {
        throw new BootstrapRefused(
          "ALREADY_BOOTSTRAPPED",
          "An organization already exists; bootstrap only runs on a fresh installation.",
        );
      }
      const templates = await tx.role.count({ where: { organizationId: null, isSystem: true } });
      if (templates === 0) {
        throw new BootstrapRefused(
          "REFERENCE_DATA_MISSING",
          "Role templates are missing. Run `npm run ops:seed` first.",
        );
      }
      const currency = await tx.currency.findUnique({
        where: { code: input.baseCurrency },
        select: { code: true },
      });
      if (!currency) {
        throw new BootstrapRefused(
          "UNKNOWN_CURRENCY",
          `Unknown currency ${input.baseCurrency}. Run \`npm run ops:seed\` first, or choose a seeded currency.`,
        );
      }
      if (await tx.user.findUnique({ where: { email: input.adminEmail }, select: { id: true } })) {
        throw new BootstrapRefused("EMAIL_TAKEN", "That e-mail address is already in use.");
      }

      const organization = await bootstrapOrganization(tx, {
        code: input.organizationCode,
        name: input.organizationName,
        legalName: input.organizationLegalName,
        baseCurrency: input.baseCurrency,
      });
      const adminRoleId = organization.roleIdsByCode.ORGANIZATION_ADMIN;
      if (!adminRoleId) {
        // Rolls back the organization created above.
        throw new BootstrapRefused(
          "REFERENCE_DATA_MISSING",
          "The ORGANIZATION_ADMIN role template is missing. Run `npm run ops:seed` first.",
        );
      }

      const admin = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: input.adminEmail,
          displayName: input.adminDisplayName,
          passwordHash,
          passwordChangedAt: now,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      await tx.userRoleAssignment.create({
        data: {
          userId: admin.id,
          roleId: adminRoleId,
          scope: "ORGANIZATION",
          // The first administrator is granted by the installation itself.
          grantedById: admin.id,
        },
      });
      await recordAudit(
        tx,
        { organizationId: organization.id, actorType: "SYSTEM", requestId: "ops-bootstrap" },
        {
          action: "organization.bootstrap",
          resourceType: "Organization",
          resourceId: organization.id,
          risk: "HIGH",
          after: {
            organizationCode: input.organizationCode,
            baseCurrency: input.baseCurrency,
            adminUserId: admin.id,
            adminEmail: input.adminEmail,
            role: "ORGANIZATION_ADMIN",
          },
          reason: "First organization and administrator (ops:bootstrap)",
        },
      );
      return {
        organizationId: organization.id,
        organizationCode: input.organizationCode,
        adminUserId: admin.id,
        adminEmail: input.adminEmail,
      };
    },
    { maxWait: 15_000, timeout: 60_000 },
  );
}
