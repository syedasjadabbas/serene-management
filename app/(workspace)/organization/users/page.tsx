import type { Metadata } from "next";
import { UsersPanel } from "./components/UsersPanel";

export const metadata: Metadata = { title: "Users & roles" };

export default function OrganizationUsersPage() {
  return <UsersPanel />;
}
