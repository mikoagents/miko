import { FilterSkeleton } from "../components/app/segmented-control.js";
import type { ReactNode } from "react";
import { DataTableSkeleton } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";

export const ACTIVITY_COLUMNS = [
  { header: "Trigger", fill: true, skeleton: { secondary: true } },
  { header: "Provider" },
  {
    header: "Source",
    skeleton: { secondary: true },
  },
  { header: "Status", fill: true, skeleton: { pill: true } },
  { header: "Received" },
];

export const ACTIVITY_DESCRIPTION = "Workflow runs, results and logs from your triggers.";

export const HISTORY_COLUMNS = [
  { header: "Started", fill: true },
  { header: "Event", fill: true, className: "hidden sm:table-cell", skeleton: { secondary: true } },
  { header: "Status", skeleton: { pill: true } },
];

export function TriggerRunHistorySkeleton() {
  return <DataTableSkeleton label="Run history" columns={HISTORY_COLUMNS} rows={5} />;
}

export function ActivityLoading({ controls }: { controls?: ReactNode }) {
  return (
    <>
      <PageHeader title="Activity" description={ACTIVITY_DESCRIPTION} />
      <div className="grid gap-6">
        {controls ?? <FilterSkeleton />}
        <DataTableSkeleton label="Trigger activity" columns={ACTIVITY_COLUMNS} />
      </div>
    </>
  );
}
