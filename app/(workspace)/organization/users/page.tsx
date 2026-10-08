import type { Metadata } from "next";
import { OrganizationSectionGuard } from "../components/OrganizationSectionGuard";
import { UsersPanel } from "./components/UsersPanel";

export const metadata: Metadata = { title: "Users & roles" };

export default function OrganizationUsersPage() {
  return (
    <OrganizationSectionGuard segment="users">
      <UsersPanel />
    </OrganizationSectionGuard>
  );
}
