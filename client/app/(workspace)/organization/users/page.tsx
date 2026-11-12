import type { Metadata } from "next";
import { OrganizationSectionGuard } from "../_components/OrganizationSectionGuard";
import { UsersPanel } from "./_components/UsersPanel";

export const metadata: Metadata = { title: "Users & roles" };

export default function OrganizationUsersPage() {
  return (
    <OrganizationSectionGuard segment="users">
      <UsersPanel />
    </OrganizationSectionGuard>
  );
}
