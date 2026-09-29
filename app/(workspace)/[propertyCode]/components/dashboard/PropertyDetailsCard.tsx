import { Card } from "@/components/ui/Card";

/** Property facts formerly shown at the top of the overview, kept for reference. */
export function PropertyDetailsCard({
  facts,
}: {
  facts: { label: string; value: string; mono?: boolean }[];
}) {
  return (
    <Card title="Property details">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-xs text-fg-muted">{fact.label}</dt>
            <dd className={fact.mono ? "truncate font-mono text-sm" : "truncate text-sm"}>
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
