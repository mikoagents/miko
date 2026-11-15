import { useMatches } from "@tanstack/react-router";
import { PipelineSkeleton } from "../components/app/pipeline.js";
import { Section } from "../components/app/section.js";
import { FilterSkeleton } from "../components/app/segmented-control.js";
import type { ReactNode } from "react";
import { DataTableSkeleton } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";
import { SummaryPanelSkeleton } from "../components/app/summary-panel.js";

export const ACTIVITY_COLUMNS = [
  { header: "Trigger", fill: true, skeleton: { secondary: true } },
  { header: "Provider", className: "hidden md:table-cell" },
  {
    header: "Source",
    fill: true,
    className: "hidden md:table-cell",
    skeleton: { secondary: true },
  },
  { header: "Daemon", fill: true, skeleton: { secondary: true } },
  { header: "Status", fill: true, skeleton: { pill: true } },
  { header: "Received", className: "hidden sm:table-cell" },
];

export const ACTIVITY_DESCRIPTION = "Workflow runs, results and logs from your triggers.";

export const ACTIVITY_RUN_DESCRIPTION = "Conversation, run details and diagnostics for this run.";

const RUN_LOADING_LABELS = ["Status", "Started", "Event", "Daemon"];

export const HISTORY_COLUMNS = [
  { header: "Started", fill: true },
  { header: "Event", fill: true, className: "hidden sm:table-cell", skeleton: { secondary: true } },
  { header: "Pipeline", className: "hidden sm:table-cell" },
  { header: "Daemon", fill: true, skeleton: { secondary: true } },
  { header: "Status", skeleton: { pill: true } },
];

export function TriggerRunHistorySkeleton() {
  return <DataTableSkeleton label="Run history" columns={HISTORY_COLUMNS} rows={5} />;
}

export function ActivityRunLoading() {
  const code = useMatches({
    select: (matches) => {
      const search: unknown = matches.at(-1)?.search;
      return (
        typeof search === "object" && search !== null && "code" in search && search.code === true
      );
    },
  });
  return (
    <>
      <PageHeader title="Activity details" description={ACTIVITY_RUN_DESCRIPTION} />
      {code ? (
        <Section title="Pipeline">
          <PipelineSkeleton />
        </Section>
      ) : null}
      <div className="grid gap-6">
        <FilterSkeleton />
        <SummaryPanelSkeleton label="Run" labels={RUN_LOADING_LABELS} />
      </div>
    </>
  );
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
