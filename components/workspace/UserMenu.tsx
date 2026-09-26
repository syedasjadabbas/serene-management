"use client";

import { useState } from "react";
import { SignOutButton } from "@/components/session/SignOutButton";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import { Disclosure } from "./Disclosure";

export function UserMenu() {
  const { data: me } = useMeQuery();
  const [changing, setChanging] = useState(false);
  if (!me) return null;
  return (
    <>
      <Disclosure
        align="end"
        label={<span className="max-w-40 truncate">{me.user.displayName}</span>}
      >
        {(close) => (
          <div className="flex flex-col gap-1 p-1">
            <div className="px-2 py-1">
              <p className="text-sm font-medium">{me.user.displayName}</p>
              <p className="text-xs text-fg-muted">{me.user.email}</p>
              <p className="text-xs text-fg-muted">{me.organization.name}</p>
            </div>
            <button
              type="button"
              className="flex min-h-11 items-center rounded-md px-2 text-start text-sm hover:bg-surface-sunken md:min-h-8"
              onClick={() => {
                close();
                setChanging(true);
              }}
            >
              Change password
            </button>
            <SignOutButton className="justify-start" />
          </div>
        )}
      </Disclosure>
      {changing ? <ChangePasswordDialog onClose={() => setChanging(false)} /> : null}
    </>
  );
}
