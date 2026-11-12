import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { CompanyDetailView } from "./_components/CompanyDetailView";

export const metadata: Metadata = { title: "Company" };

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ propertyCode: string; accountId: string }>;
}) {
  const { accountId } = await params;
  return (
    <PermissionGate permission={P.ACCOUNTS_READ}>
      <CompanyDetailView accountId={accountId} />
    </PermissionGate>
  );
}
