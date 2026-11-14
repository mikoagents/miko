import { FilterSkeleton } from "../components/app/segmented-control.js";
import type { ReactNode } from "react";
import { DataTableSkeleton } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";

export const COLUMNS = [
  { header: "Trigger", fill: true, skeleton: { secondary: true, icon: true } },
  { header: "Event", fill: true, className: "hidden md:table-cell", skeleton: { secondary: true } },
  {
    header: "Target",
    fill: true,
    className: "hidden xl:table-cell",
    skeleton: { secondary: true },
  },
  { header: "Last triggered", className: "hidden sm:table-cell", skeleton: { secondary: true } },
  { header: "Status", skeleton: { pill: true } },
];

export const FILTERS = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

export const DESCRIPTION = "Choose when a workflow runs and write what it does in code.";

export function TriggersLoading({ controls }: { controls?: ReactNode }) {
  return (
    <>
      <PageHeader title="Triggers" description={DESCRIPTION} />
      <div className="grid gap-6">
        {controls ?? <FilterSkeleton />}
        <DataTableSkeleton label="Triggers" columns={COLUMNS} />
      </div>
    </>
  );
}
