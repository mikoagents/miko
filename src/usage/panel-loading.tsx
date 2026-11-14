import { DataTableSkeleton, type DataColumn } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";
import { Section } from "../components/app/section.js";

export const LIMITS_TITLE = "Limits";

export const LIMITS_DESCRIPTION = "What this organization is allowed, and how much is in use.";

export const HISTORY_TITLE = "History";

export const HISTORY_DESCRIPTION = "Every change to this organization's limits, most recent first.";

export const LIMIT_COLUMNS: readonly DataColumn[] = [
  { header: "Resource", fill: true },
  { header: "Limit" },
  { header: "In use", align: "end" },
];

export const HISTORY_COLUMNS: readonly DataColumn[] = [
  { header: "Change" },
  { header: "Reason", fill: true },
  { header: "Who" },
  { header: "When", align: "end" },
];

export function UsageLoading({ name }: { name?: string }) {
  return (
    <>
      <PageHeader
        title="Usage"
        description={
          name === undefined
            ? "Limits and usage for this organization."
            : `Limits and usage for ${name}.`
        }
      />
      <Section title={LIMITS_TITLE} description={LIMITS_DESCRIPTION}>
        <DataTableSkeleton label="Limits" columns={LIMIT_COLUMNS} />
      </Section>
      <Section title={HISTORY_TITLE} description={HISTORY_DESCRIPTION}>
        <DataTableSkeleton label="History" columns={HISTORY_COLUMNS} rows={2} />
      </Section>
    </>
  );
}
