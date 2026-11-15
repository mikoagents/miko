import {
  ACTIVITY_COLUMNS,
  ACTIVITY_DESCRIPTION,
  HISTORY_COLUMNS,
  ActivityLoading,
  TriggerRunHistorySkeleton,
} from "./activity-loading.js";
/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop, eslint-plugin-react-perf/jsx-no-new-array-as-prop, eslint-plugin-react-perf/jsx-no-new-function-as-prop, eslint-plugin-react-perf/jsx-no-new-object-as-prop -- each record composes its link and table row, and draws its strip from the run each poll returns */
import { useSnapshotQuery } from "../queries/index.js";
import { useCallback, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { DataCell, DataRow, DataTable } from "../components/app/data-table.js";
import { FailureAlert } from "../components/app/failure-alert.js";
import { PageHeader } from "../components/app/page.js";
import { RelativeTime } from "../components/app/relative-time.js";
import { StatusPill, statusLabel } from "../components/app/status-pill.js";
import { TwoLine } from "../components/app/two-line.js";
import { PipelineStrip } from "../components/app/pipeline.js";
import { SegmentedControl } from "../components/app/segmented-control.js";
import { Button } from "../components/ui/button.js";
import { usePersistedChoice } from "../preferences/persisted-choice.js";
import { useRouteTenant } from "../projects/context.js";
import { triggerSnapshot, type TriggerSnapshot } from "./functions.js";
import { ACTIVITY_RUN_ROUTE, activityRunSearch } from "./activity-run.js";
import { triggerSourceLabel } from "./code/presentation.js";
import {
  milestoneDetail,
  milestoneTone,
  shapeSummary,
  stepCount,
  type RunShape,
} from "./code/run-presentation.js";
import { triggerRunHistory } from "./functions.js";
import {
  ACTIVITY_STATUS_FILTERS,
  ACTIVITY_STATUS_FILTER_OPTIONS,
  activityFilterEmpty,
  activityMatchesStatus,
  type ActivityStatusFilter,
} from "./activity-filter.js";

const HISTORY_EMPTY = {
  title: "No runs yet",
  description: "Runs will appear here when an event arrives, or when someone chooses Run now.",
};

export function TriggerActivityPanel() {
  const tenant = useRouteTenant();
  const load = useServerFn(triggerSnapshot);
  const organizationSlug = tenant.organization.slug;
  const snapshot = useSnapshotQuery({
    queryKey: ["triggers", organizationSlug],
    queryFn: () => load({ data: { organizationSlug } }),
  });
  const {
    value: filter,
    setValue: setFilter,
    ready,
  } = usePersistedChoice(
    `miko-hub-activity-status:${tenant.organization.id}`,
    ACTIVITY_STATUS_FILTERS,
    "all",
  );
  if (snapshot.status === "pending" || !ready)
    return (
      <ActivityLoading controls={<ActivityStatusFilter value={filter} onChange={setFilter} />} />
    );
  if (snapshot.status === "error") {
    return (
      <FailureAlert
        title="Activity unavailable"
        error={snapshot.error}
        fallback="Hub couldn't load trigger activity."
      />
    );
  }
  const activity = snapshot.data.activity.filter((run) =>
    activityMatchesStatus(run.status, filter),
  );
  return (
    <>
      <PageHeader title="Activity" description={ACTIVITY_DESCRIPTION} />
      <div className="grid gap-6">
        <ActivityStatusFilter value={filter} onChange={setFilter} />
        <DataTable
          label="Trigger activity"
          columns={ACTIVITY_COLUMNS}
          isEmpty={activity.length === 0}
          empty={
            snapshot.data.activity.length === 0
              ? activityFilterEmpty("all")
              : activityFilterEmpty(filter)
          }
        >
          {activity.map((run) => (
            <ActivityRow key={run.id} run={run} organizationSlug={organizationSlug} />
          ))}
        </DataTable>
      </div>
    </>
  );
}

/** Per-Trigger history is fetched independently, so busy workflows cannot hide another's runs. */
export function TriggerRunHistory({
  organizationSlug,
  triggerId,
}: {
  organizationSlug: string;
  triggerId: string;
}) {
  const [count, setCount] = useState(5);
  const showMore = useCallback(() => setCount((value) => value + 5), []);
  const load = useServerFn(triggerRunHistory);
  // Only the runs on screen carry a pipeline, so showing more asks again, over the shown list.
  const snapshot = useSnapshotQuery({
    queryKey: ["trigger-history", organizationSlug, triggerId, count],
    queryFn: () => load({ data: { organizationSlug, triggerId, pipelines: count } }),
    refetchInterval: 3000,
    keepPrevious: true,
  });
  if (snapshot.status === "pending") return <TriggerRunHistorySkeleton />;
  if (snapshot.status === "error")
    return (
      <FailureAlert
        title="Runs unavailable"
        error={snapshot.error}
        fallback="Hub couldn't load these runs."
        onRetry={snapshot.refetch}
      />
    );
  return (
    <div className="grid gap-3">
      <DataTable
        label="Run history"
        columns={HISTORY_COLUMNS}
        isEmpty={snapshot.data.length === 0}
        empty={HISTORY_EMPTY}
      >
        {snapshot.data.slice(0, count).map((run) => (
          <ActivityRow key={run.id} run={run} organizationSlug={organizationSlug} compact />
        ))}
      </DataTable>
      {snapshot.data.length > count ? (
        <div>
          <Button variant="outline" size="sm" onClick={showMore}>
            Show more runs
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ActivityStatusFilter({
  value,
  onChange,
}: {
  value: ActivityStatusFilter;
  onChange: (value: string) => void;
}) {
  return (
    <SegmentedControl
      label="Activity status"
      value={value}
      options={ACTIVITY_STATUS_FILTER_OPTIONS}
      onChange={onChange}
    />
  );
}

function ActivityRow({
  run,
  organizationSlug,
  compact = false,
}: {
  run: TriggerSnapshot["activity"][number];
  organizationSlug: string;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const destination = {
    to: ACTIVITY_RUN_ROUTE,
    params: { organizationSlug, triggerId: run.triggerId, runId: run.id },
    search: activityRunSearch(run.code),
  };
  return (
    <DataRow
      onSelect={() => {
        void navigate(destination);
      }}
    >
      <DataCell>
        <TwoLine
          primary={
            <Link
              {...destination}
              className="text-foreground hover:text-link"
              onClick={(event) => event.stopPropagation()}
              {...(compact ? { "aria-label": `Open run from ${run.receivedAt}` } : {})}
            >
              {compact ? <RelativeTime value={run.receivedAt} /> : run.triggerName}
            </Link>
          }
          {...(run.repo === null ? {} : { secondary: run.repo })}
        />
      </DataCell>
      {compact ? null : <DataCell>{triggerSourceLabel(run.provider)}</DataCell>}
      <DataCell>{run.source}</DataCell>
      {compact ? (
        <DataCell muted>
          <RunPipeline shape={run.pipeline} />
        </DataCell>
      ) : null}
      <DataCell>{run.daemons.join(" · ") || "—"}</DataCell>
      <DataCell>
        <TwoLine
          primary={<StatusPill tone={tone(run.status)}>{statusLabel(run.status)}</StatusPill>}
          {...(run.failureReason === null ? {} : { secondary: run.failureReason })}
        />
      </DataCell>
      {compact ? null : (
        <DataCell muted>
          <RelativeTime value={run.receivedAt} />
        </DataCell>
      )}
    </DataRow>
  );
}

/** A run's pipeline as a strip, its step count when it has no stage, or nothing to draw. */
function RunPipeline({ shape }: { shape: RunShape | null }) {
  if (shape === null) return "—";
  if (shape.stages.length === 0) return stepCount(shape.trailing);
  const now = Date.now();
  return (
    <PipelineStrip
      label={shapeSummary(shape, now)}
      stages={shape.stages.map((stage) => ({
        key: stage.milestones[0]?.operationId ?? "",
        marks: stage.milestones.map((milestone) => ({
          key: milestone.operationId,
          tone: milestoneTone(milestone),
          label: `${milestone.id} · ${milestoneDetail(milestone, now)}`,
        })),
      }))}
    />
  );
}

function tone(status: string): "success" | "danger" | "neutral" {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "timed_out" || status === "rejected") return "danger";
  return "neutral";
}
