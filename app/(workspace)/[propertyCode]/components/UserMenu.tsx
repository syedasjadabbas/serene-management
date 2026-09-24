"use client";

import { SignOutButton } from "@/components/session/SignOutButton";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import { Disclosure } from "./Disclosure";

export function UserMenu() {
  const { data: me } = useMeQuery();
  if (!me) return null;
  return (
    <Disclosure
      align="end"
      label={<span className="max-w-40 truncate">{me.user.displayName}</span>}
    >
      {() => (
        <div className="flex flex-col gap-1 p-1">
          <div className="px-2 py-1">
            <p className="text-sm font-medium">{me.user.displayName}</p>
            <p className="text-xs text-fg-muted">{me.user.email}</p>
            <p className="text-xs text-fg-muted">{me.organization.name}</p>
          </div>
          <SignOutButton className="justify-start" />
        </div>
      )}
    </Disclosure>
  );
}
