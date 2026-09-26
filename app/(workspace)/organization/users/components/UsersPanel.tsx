"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextField } from "@/components/ui/TextField";
import { useRolesQuery, useUsersQuery } from "@/lib/api/endpoints/organization.api";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";
import type { RoleAssignmentView, UserView } from "@/modules/users/users.types";
import { type UserDialog, UserDialogs } from "./UserDialogs";

const PAGE_SIZE = 25;

const STATUS_TONE = {
  ACTIVE: "success",
  INVITED: "info",
  LOCKED: "warning",
  DISABLED: "neutral",
} as const;

/**
 * Users of the organization and their role assignments. Each user's
 * assignments are shown only for scopes the viewer may inspect (D3); grants
 * and revocations are limited to scopes where the viewer holds users:manage.
 * No users are created here (D7).
 */
export function UsersPanel() {
  const { data: me } = useMeQuery();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<UserDialog | null>(null);
  const users = useUsersQuery({ page, pageSize: PAGE_SIZE, ...(search ? { q: search } : {}) });
  const roles = useRolesQuery();
  const error = toClientApiError(users.error);

  const orgManage =
    !!me && (me.user.isSuperAdmin || me.organizationPermissions.includes("users:manage"));
  const managedProperties = (me?.properties ?? []).filter(
    (p) => me?.user.isSuperAdmin || p.permissions.includes("users:manage"),
  );
  const canManage = (a: RoleAssignmentView) =>
    a.scope === "ORGANIZATION" ? orgManage : managedProperties.some((p) => p.id === a.property?.id);
  const canGrant = orgManage || managedProperties.length > 0;
  const isSelf = (user: UserView) => user.id === me?.user.id;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold">Users &amp; roles</h1>
        <p className="text-sm text-fg-secondary">
          Role assignments are shown for the scopes you may inspect. Users are invited outside this
          workspace.
        </p>
      </header>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(q.trim());
          setPage(1);
        }}
      >
        <TextField
          label="Search users"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or e-mail"
          maxLength={100}
          className="min-w-0 flex-1 basis-56"
        />
        <Button type="submit" size="touch" className="md:h-control md:text-sm">
          Search
        </Button>
      </form>

      {users.isLoading ? (
        <StatusPanel kind="loading" title="Loading users" />
      ) : error ? (
        <StatusPanel
          kind={error.status === 403 ? "forbidden" : "error"}
          title={error.status === 403 ? "Access denied" : "Could not load users"}
          description={error.message}
          requestId={error.requestId}
        />
      ) : users.data && users.data.items.length === 0 ? (
        <StatusPanel kind="empty" title="No users match" />
      ) : users.data ? (
        <section className="rounded-lg border border-border-subtle bg-surface">
          <ul className="flex flex-col divide-y divide-border-subtle">
            {users.data.items.map((user) => (
              <li
                key={user.id}
                className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-start"
              >
                <div className="min-w-0 md:w-72 md:shrink-0">
                  <p className="font-medium">
                    {user.displayName}
                    {isSelf(user) ? (
                      <span className="ms-1 text-xs text-fg-muted">(you)</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-fg-muted">{user.email}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                    <Badge tone={STATUS_TONE[user.status]}>{user.status.toLowerCase()}</Badge>
                    {user.lastLoginAt
                      ? `Last sign-in ${formatDateTime(user.lastLoginAt, "UTC")} UTC`
                      : "Never signed in"}
                  </p>
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {user.assignments.length === 0 ? (
                    <span className="text-xs text-fg-muted">No assignments in your scope</span>
                  ) : (
                    user.assignments.map((a) => (
                      <span
                        key={a.id}
                        className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-xs"
                      >
                        <span className="font-mono text-2xs text-fg-muted">
                          {a.scope === "ORGANIZATION" ? "ORG" : a.property?.code}
                        </span>
                        {a.role.name}
                        {canManage(a) && !isSelf(user) ? (
                          <button
                            type="button"
                            className="ms-1 inline-flex min-h-8 min-w-8 items-center justify-center rounded text-fg-muted hover:bg-surface-sunken hover:text-danger md:min-h-0 md:min-w-0"
                            aria-label={`Revoke ${a.role.name} from ${user.displayName}`}
                            onClick={() => setDialog({ kind: "revoke", user, assignment: a })}
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                    ))
                  )}
                </div>
                {!isSelf(user) && (canGrant || orgManage) ? (
                  <div className="flex flex-wrap gap-1.5 md:justify-end">
                    {canGrant && user.status !== "DISABLED" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="min-h-11 md:min-h-0"
                        onClick={() => setDialog({ kind: "grant", user })}
                      >
                        Grant role
                      </Button>
                    ) : null}
                    {orgManage && user.status === "LOCKED" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-11 md:min-h-0"
                        onClick={() => setDialog({ kind: "unlock", user })}
                      >
                        Unlock
                      </Button>
                    ) : null}
                    {orgManage && user.status !== "DISABLED" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-11 md:min-h-0"
                        onClick={() => setDialog({ kind: "disable", user })}
                      >
                        Disable
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-2.5 text-sm">
            <span className="text-fg-muted">
              Page {users.data.meta.page} of{" "}
              {Math.max(1, Math.ceil(users.data.meta.total / users.data.meta.pageSize))} ·{" "}
              {users.data.meta.total} users
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="ms-auto min-h-11 md:min-h-0"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="min-h-11 md:min-h-0"
              disabled={page * PAGE_SIZE >= users.data.meta.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="roles-heading"
        className="rounded-lg border border-border-subtle bg-surface"
      >
        <h2 id="roles-heading" className="border-b border-border-subtle px-4 py-2.5 font-semibold">
          Roles
        </h2>
        {roles.data ? (
          <ul className="grid gap-x-6 px-4 py-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {roles.data.map((role) => (
              <li key={role.id} className="flex items-baseline gap-2 py-1">
                <span className="font-medium">{role.name}</span>
                <span className="text-xs text-fg-muted">{role.permissions.length} permissions</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-fg-muted">
            {roles.isLoading ? "Loading roles…" : "Roles are not available."}
          </p>
        )}
      </section>

      {dialog ? (
        <UserDialogs
          dialog={dialog}
          roles={roles.data ?? []}
          orgManage={orgManage}
          managedProperties={managedProperties}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
