import type { Metadata } from "next";
import { SignOutButton } from "@/components/session/SignOutButton";
import { StatusPanel } from "@/components/ui/StatusPanel";

export const metadata: Metadata = { title: "No property access" };

export default function NoAccessPage() {
  return (
    <StatusPanel
      kind="forbidden"
      title="No property access"
      description="Your account is active but has not been given access to any property. Ask an administrator to assign you a role."
      action={<SignOutButton variant="secondary" />}
    />
  );
}
