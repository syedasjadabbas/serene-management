import { Card } from "@/components/ui/Card";

/** Property facts formerly shown at the top of the overview, kept for reference. */
export function PropertyDetailsCard({
  facts,
  compact = false,
}: {
  facts: { label: string; value: string; mono?: boolean }[];
  /** In a one-third column: two facts per row at most. */
  compact?: boolean;
}) {
  return (
    <Card title="Property details">
      <dl
        className={
          compact
            ? "grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
            : "grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3"
        }
      >
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="truncate label-caps">{fact.label}</dt>
            <dd
              className={
                fact.mono
                  ? "mt-1 truncate font-mono text-sm font-medium"
                  : "mt-1 truncate text-sm font-medium"
              }
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
