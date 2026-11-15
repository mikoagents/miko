import { FilterSkeleton } from "../components/app/segmented-control.js";
import type { ReactNode } from "react";
import { DataTableSkeleton } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";
import { useMatches } from "@tanstack/react-router";
import { TriggerTemplateGallerySkeleton } from "./code/template-gallery.js";

export const COLUMNS = [
  { header: "Trigger", fill: true, skeleton: { secondary: true, icon: true } },
  { header: "Event", fill: true, className: "hidden md:table-cell", skeleton: { secondary: true } },
  { header: "Daemon", fill: true, skeleton: { secondary: true } },
  { header: "Last triggered", className: "hidden xl:table-cell", skeleton: { secondary: true } },
  { header: "Status", skeleton: { pill: true } },
];

export const FILTERS = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

export const DESCRIPTION = "Choose when a workflow runs and write what it does in code.";

export function TriggersLoading({ controls }: { controls?: ReactNode }) {
  const exploring = useMatches({
    select: (matches) => {
      const search: unknown = matches.at(-1)?.search;
      return (
        typeof search === "object" &&
        search !== null &&
        "scope" in search &&
        search.scope === "explore"
      );
    },
  });
  return (
    <>
      <PageHeader title="Triggers" description={DESCRIPTION} />
      <div className="grid gap-6">
        {controls ?? <FilterSkeleton />}
        {exploring ? (
          <TriggerTemplateGallerySkeleton />
        ) : (
          <DataTableSkeleton label="Triggers" columns={COLUMNS} />
        )}
      </div>
    </>
  );
}
