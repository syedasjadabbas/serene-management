"use client";

import { Building2 } from "lucide-react";
import { useState } from "react";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAccountsQuery } from "@/lib/api/endpoints/accounts.api";

export interface PickedCompany {
  id: string;
  label: string;
}

/**
 * Company selector: the SERENE searchable dropdown over a debounced
 * server-side search of active companies. Restricted companies are listed
 * but cannot be chosen. The server re-validates the chosen company wherever
 * it is used.
 */
export function CompanyPicker({
  value,
  onChange,
  label = "Company (optional)",
}: {
  value: PickedCompany | null;
  onChange: (company: PickedCompany | null) => void;
  label?: string;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 250);
  const results = useAccountsQuery(
    { q: debounced, type: "COMPANY", status: "ACTIVE", limit: 8 },
    { skip: debounced.length < 2 },
  );
  const companies = debounced.length >= 2 ? (results.data?.items ?? []) : [];

  return (
    <SearchableSelect
      label={label}
      items={companies.map((company) => ({
        value: company.id,
        label: company.name,
        description: [
          company.code,
          [company.city, company.countryCode].filter(Boolean).join(", "),
          company.isRestricted ? "Restricted" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        icon: Building2,
        disabled: company.isRestricted,
      }))}
      value={value?.id ?? ""}
      selectedLabel={value?.label}
      onChange={(id) => {
        const company = companies.find((c) => c.id === id);
        onChange(
          company
            ? {
                id: company.id,
                label: `${company.name}${company.code ? ` (${company.code})` : ""}`,
              }
            : null,
        );
      }}
      onSearchChange={setSearch}
      loading={results.isFetching || debounced !== search.trim()}
      minSearchLength={2}
      searchPlaceholder="Company name or code"
      placeholder="Search for a company"
      clearable
      emptyText="No company found"
    />
  );
}
