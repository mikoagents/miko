import { FilterSkeleton } from "../components/app/segmented-control.js";
import type { ReactNode } from "react";
import { DataTableSkeleton, type DataColumn } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";

export const DAEMON_COLUMNS: readonly DataColumn[] = [
  { header: "Slug", fill: true, skeleton: { secondary: true } },
  { header: "ID", className: "hidden xl:table-cell" },
  { header: "Status", skeleton: { pill: true } },
  { header: "Providers" },
  {
    header: "Access",
    fill: true,
    className: "hidden md:table-cell",
    skeleton: { secondary: true },
  },
  { header: "Last seen", className: "hidden lg:table-cell" },
  { header: "Registered", className: "hidden xl:table-cell" },
  { header: "", align: "end" },
];

export const DAEMONS_DESCRIPTION = "Stable daemon identities registered to this organization.";

export function DaemonsLoading({ controls }: { controls?: ReactNode }) {
  return (
    <>
      <PageHeader id="daemons-heading" title="Daemons" description={DAEMONS_DESCRIPTION} />
      <div className="grid gap-6">
        {controls ?? <FilterSkeleton />}
        <DataTableSkeleton label="Daemons" columns={DAEMON_COLUMNS} />
      </div>
    </>
  );
}
