import type { Metadata } from "next";
import { CompanyDetailView } from "./components/CompanyDetailView";

export const metadata: Metadata = { title: "Company" };

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ propertyCode: string; accountId: string }>;
}) {
  const { accountId } = await params;
  return <CompanyDetailView accountId={accountId} />;
}
