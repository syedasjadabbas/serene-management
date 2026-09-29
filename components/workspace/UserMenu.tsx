"use client";

import { KeyRound, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { SignOutButton } from "@/components/session/SignOutButton";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import { Disclosure } from "./Disclosure";
import { ProfileDialog } from "./ProfileDialog";

/** One look for every account-menu entry: icon, label, 32px (44px on touch). */
const ITEM =
  "flex h-8 w-full items-center justify-start gap-2.5 rounded-md px-2 text-start text-sm font-normal text-fg hover:bg-surface-sunken pointer-coarse:h-11 [&_svg]:text-fg-muted";

export function UserMenu() {
  const { data: me } = useMeQuery();
  const [dialog, setDialog] = useState<"profile" | "password" | null>(null);
  if (!me) return null;
  return (
    <>
      <Disclosure
        align="end"
        buttonClassName="h-auto min-h-control py-1 ps-1"
        label={
          <>
            <Avatar name={me.user.displayName} src={me.user.avatarUrl} size="sm" />
            <span className="sr-only flex-col items-start text-start leading-tight lg:not-sr-only lg:flex">
              <span className="max-w-40 truncate text-sm font-medium">{me.user.displayName}</span>
              <span className="hidden max-w-40 truncate text-2xs text-fg-muted xl:block">
                {me.organization.name}
              </span>
            </span>
          </>
        }
      >
        {(close) => (
          <div className="flex w-64 flex-col p-1">
            <div className="flex items-center gap-3 px-2 py-2">
              <Avatar name={me.user.displayName} src={me.user.avatarUrl} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{me.user.displayName}</p>
                <p className="truncate text-xs text-fg-muted">{me.user.email}</p>
                <p className="truncate text-xs text-fg-muted">{me.organization.name}</p>
              </div>
            </div>
            <div className="my-1 border-t border-border-subtle" />
            <button
              type="button"
              className={ITEM}
              onClick={() => {
                close();
                setDialog("profile");
              }}
            >
              <UserRound aria-hidden="true" className="size-4" />
              Edit profile
            </button>
            <button
              type="button"
              className={ITEM}
              onClick={() => {
                close();
                setDialog("password");
              }}
            >
              <KeyRound aria-hidden="true" className="size-4" />
              Change password
            </button>
            <div className="my-1 border-t border-border-subtle" />
            <SignOutButton className={ITEM}>
              <LogOut aria-hidden="true" className="size-4" />
              Sign out
            </SignOutButton>
          </div>
        )}
      </Disclosure>
      {dialog === "profile" ? <ProfileDialog me={me} onClose={() => setDialog(null)} /> : null}
      {dialog === "password" ? <ChangePasswordDialog onClose={() => setDialog(null)} /> : null}
    </>
  );
}
