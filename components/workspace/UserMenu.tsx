"use client";

import { KeyRound, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/components/ui/cn";
import { SignOutButton } from "@/components/session/SignOutButton";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import { Disclosure } from "./Disclosure";
import { ProfileDialog } from "./ProfileDialog";

/** One look for every account-menu entry: icon, label, 32px (44px on touch). */
const ITEM =
  "flex h-8 w-full items-center justify-start gap-2.5 rounded-md px-2 text-start text-sm font-normal text-fg hover:bg-surface-sunken pointer-coarse:h-11 [&_svg]:text-fg-muted";
/** The same entries in the navigation drawer: 44px touch rows. */
const PANEL_ITEM =
  "flex min-h-11 w-full items-center justify-start gap-3 rounded-md px-3 text-start text-base font-medium text-fg hover:bg-surface-sunken [&_svg]:text-fg-muted";

/**
 * The signed-in user's account: profile, password, sign out. `menu` (the
 * default) is the account chip in the header; `panel` lists the same
 * entries inline for the navigation drawer on phones, where the header has
 * no room for the chip.
 */
export function UserMenu({ variant = "menu" }: { variant?: "menu" | "panel" }) {
  const { data: me } = useMeQuery();
  const [dialog, setDialog] = useState<"profile" | "password" | null>(null);
  if (!me) return null;

  const panel = variant === "panel";
  const identity = (
    <div className={cn("flex items-center gap-3", panel ? "px-3 pb-2" : "px-2 py-2")}>
      <Avatar name={me.user.displayName} src={me.user.avatarUrl} tone="solid" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{me.user.displayName}</p>
        <p className="truncate text-xs text-fg-muted">{me.user.email}</p>
        <p className="truncate text-xs text-fg-muted">{me.organization.name}</p>
      </div>
    </div>
  );
  const entries = (close: () => void) => {
    const item = panel ? PANEL_ITEM : ITEM;
    return (
      <>
        <button
          type="button"
          className={item}
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
          className={item}
          onClick={() => {
            close();
            setDialog("password");
          }}
        >
          <KeyRound aria-hidden="true" className="size-4" />
          Change password
        </button>
        {panel ? null : <div className="my-1 border-t border-border-subtle" />}
        <SignOutButton className={item}>
          <LogOut aria-hidden="true" className="size-4" />
          Sign out
        </SignOutButton>
      </>
    );
  };

  return (
    <>
      {panel ? (
        <section aria-label="Account" className="flex flex-col gap-0.5">
          {identity}
          {entries(() => {})}
        </section>
      ) : (
        <Disclosure
          align="end"
          buttonClassName="h-10 rounded-md border border-border bg-surface ps-1 pe-1 shadow-card hover:bg-surface-sunken sm:pe-2 min-[87.5rem]:pe-2.5"
          chevronClassName="hidden sm:block"
          label={
            <>
              <Avatar name={me.user.displayName} src={me.user.avatarUrl} size="sm" tone="solid" />
              <span className="sr-only flex-col items-start text-start leading-tight min-[87.5rem]:not-sr-only min-[87.5rem]:flex">
                <span className="max-w-40 truncate text-sm font-semibold">
                  {me.user.displayName}
                </span>
                <span className="hidden max-w-40 truncate text-2xs text-fg-muted min-[87.5rem]:block">
                  {me.user.email}
                </span>
              </span>
            </>
          }
        >
          {(close) => (
            <div className="flex w-64 flex-col p-1">
              {identity}
              <div className="my-1 border-t border-border-subtle" />
              {entries(close)}
            </div>
          )}
        </Disclosure>
      )}
      {dialog === "profile" ? <ProfileDialog me={me} onClose={() => setDialog(null)} /> : null}
      {dialog === "password" ? <ChangePasswordDialog onClose={() => setDialog(null)} /> : null}
    </>
  );
}
