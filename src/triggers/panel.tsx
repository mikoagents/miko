import { COLUMNS, FILTERS, DESCRIPTION, TriggersLoading } from "./panel-loading.js";
/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop, eslint-plugin-react-perf/jsx-no-new-array-as-prop, eslint-plugin-react-perf/jsx-no-new-function-as-prop -- shared record surfaces compose their labels, facts and row navigation */
/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- organization URLs are resolved by the server outside generated route parameter types */
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Braces, Plus } from "lucide-react";
import { DataTable, DataRow, DataCell } from "../components/app/data-table.js";
import { FailureAlert } from "../components/app/failure-alert.js";
import { PageHeader } from "../components/app/page.js";
import { RelativeTime } from "../components/app/relative-time.js";
import { SegmentedControl } from "../components/app/segmented-control.js";
import { StatusPill, statusLabel } from "../components/app/status-pill.js";
import { TwoLine } from "../components/app/two-line.js";
import { Button } from "../components/ui/button.js";
import { useSnapshotQuery } from "../queries/index.js";
import { useRouteTenant } from "../projects/context.js";
import { ProviderGlyph } from "../connections/provider-glyph.js";
import { triggerSnapshot, type TriggerSnapshot } from "./functions.js";
import { useTriggerStatusFilter } from "./status-filter.js";
import { subscriptionListSummary, triggerTargetSummary } from "./code/presentation.js";
import { describeTriggerEvent } from "./configuration/editor.js";

type BrowserTrigger = TriggerSnapshot["triggers"][number];

const NEW_EMPTY = {
  title: "No triggers",
  description: "Start with a small script, choose when it runs, then deploy it to Hub.",
};
const FILTER_EMPTY = {
  all: { title: "No triggers", description: "Choose All to view every Trigger." },
  enabled: { title: "No enabled triggers", description: "Choose All to view every Trigger." },
  disabled: { title: "No disabled triggers", description: "Choose All to view every Trigger." },
};

export function TriggersPanel() {
  const navigate = useNavigate();
  const tenant = useRouteTenant();
  const organizationSlug = tenant.organization.slug;
  const load = useServerFn(triggerSnapshot);
  const snapshot = useSnapshotQuery({
    queryKey: ["triggers", organizationSlug],
    queryFn: () => load({ data: { organizationSlug } }),
  });
  const { filter, setFilter, ready } = useTriggerStatusFilter(tenant.organization.id);
  const path = (id: string) => `/o/${organizationSlug}/triggers/${id}` as never;
  const controls = (
    <SegmentedControl
      label="Trigger status"
      value={filter}
      options={FILTERS}
      onChange={setFilter}
    />
  );
  if (snapshot.status === "pending" || !ready) return <TriggersLoading controls={controls} />;
  if (snapshot.status === "error")
    return (
      <>
        <PageHeader title="Triggers" description={DESCRIPTION} />
        <FailureAlert
          title="Triggers unavailable"
          error={snapshot.error}
          fallback="Hub couldn't load Triggers."
          onRetry={snapshot.refetch}
        />
      </>
    );
  const data = snapshot.data;
  const visible = data.triggers.filter(
    (trigger) => filter === "all" || trigger.enabled === (filter === "enabled"),
  );
  return (
    <>
      <PageHeader title="Triggers" description={DESCRIPTION}>
        {data.canManage ? (
          <Button asChild>
            <Link to={path("new")}>
              <Plus aria-hidden="true" />
              New trigger
            </Link>
          </Button>
        ) : null}
      </PageHeader>
      <div className="grid gap-6">
        {controls}
        <DataTable
          label="Triggers"
          columns={COLUMNS}
          isEmpty={visible.length === 0}
          empty={data.triggers.length === 0 ? NEW_EMPTY : FILTER_EMPTY[filter]}
        >
          {visible.map((trigger) => (
            <DataRow
              key={trigger.id}
              onSelect={() => {
                void navigate({ to: path(trigger.id) });
              }}
            >
              <DataCell>
                <span className="flex items-center gap-3">
                  <TriggerGlyph trigger={trigger} />
                  <TwoLine
                    primary={
                      <Link
                        to={path(trigger.id)}
                        title={trigger.name}
                        className="text-foreground hover:text-link"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {trigger.name}
                      </Link>
                    }
                    secondary={
                      trigger.code?.agentSummary ??
                      trigger.draft?.agent ??
                      (trigger.format === "legacy_multistep" ? "Legacy YAML" : "Advanced YAML")
                    }
                  />
                </span>
              </DataCell>
              <DataCell>
                <TriggerEvent trigger={trigger} />
              </DataCell>
              <DataCell>
                <TriggerTarget trigger={trigger} />
              </DataCell>
              <DataCell>
                {trigger.lastTriggered === null ? (
                  <span className="text-muted-foreground">Never</span>
                ) : (
                  <TwoLine
                    primary={<RelativeTime value={trigger.lastTriggered.receivedAt} />}
                    secondary={statusLabel(trigger.lastTriggered.status)}
                  />
                )}
              </DataCell>
              <DataCell>
                <StatusPill tone={trigger.enabled ? "success" : "neutral"}>
                  {trigger.enabled ? "Enabled" : "Disabled"}
                </StatusPill>
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      </div>
    </>
  );
}

function TriggerGlyph({ trigger }: { trigger: BrowserTrigger }) {
  const sources = [...new Set(trigger.code?.manifest.on.map(({ source }) => source))];
  const configuredSource = sources.length === 1 ? sources[0] : "Workflow";
  const source = trigger.code === null ? trigger.provider : configuredSource;
  const known =
    source === "github" ||
    source === "slack" ||
    source === "discord" ||
    source === "linear" ||
    source === "schedule" ||
    source === "manual";
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-foreground"
      role="img"
      aria-label={`${source} provider`}
    >
      {known ? (
        <ProviderGlyph provider={source} />
      ) : (
        <Braces aria-hidden="true" className="size-4.5" />
      )}
    </span>
  );
}

function TriggerEvent({ trigger }: { trigger: BrowserTrigger }) {
  if (trigger.code !== null)
    return <TwoLine {...subscriptionListSummary(trigger.code.manifest.on)} />;
  const { kind, detail } = describeTriggerEvent(trigger.draft, trigger.event);
  return <TwoLine primary={kind} {...(detail === undefined ? {} : { secondary: detail })} />;
}

function TriggerTarget({ trigger }: { trigger: BrowserTrigger }) {
  if (trigger.code !== null) return <TwoLine {...triggerTargetSummary(trigger.code.manifest)} />;
  if (trigger.draft !== null)
    return <TwoLine path primary={trigger.draft.daemon} secondary={trigger.draft.cwd} />;
  return <span className="text-muted-foreground">Advanced configuration</span>;
}
