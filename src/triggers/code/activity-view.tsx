/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop, eslint-plugin-react-perf/jsx-no-new-array-as-prop -- details compose shared summary and table slots */
import { useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useSnapshotQuery } from "../../queries/index.js";
import {
  AgentProviderMark,
  agentProviderLabel,
} from "../../components/app/agent-provider-logos.js";
import { CodeBlock, CopyButton } from "../../components/app/copy-field.js";
import { Combobox } from "../../components/app/combobox.js";
import { DataCell, DataRow, DataTable } from "../../components/app/data-table.js";
import { EmptyState } from "../../components/app/empty-state.js";
import { FailureAlert, NoticeAlert } from "../../components/app/failure-alert.js";
import { LoadingLine } from "../../components/app/loading.js";
import { RelativeTime } from "../../components/app/relative-time.js";
import { Section } from "../../components/app/section.js";
import { StatusPill, statusLabel } from "../../components/app/status-pill.js";
import { SummaryPanel } from "../../components/app/summary-panel.js";
import { TwoLine } from "../../components/app/two-line.js";
import { Button } from "../../components/ui/button.js";
import { codeTriggerRunDetail, type CodeTriggerRun } from "../functions.js";
import { SessionHistory } from "../session-history.js";
import {
  agentSessions,
  describeOperation,
  elapsed,
  formatDuration,
  initialSession,
  runEventSummary,
  type AgentCall,
  type RunSession,
} from "./run-presentation.js";

type Run = CodeTriggerRun["run"];
type Operation = CodeTriggerRun["operations"][number];
type Log = CodeTriggerRun["logs"][number];

interface RunScope {
  organizationSlug: string;
  triggerId: string;
  runId: string;
}

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting"]);

const SESSION_COLUMNS = [
  { header: "Session", fill: true },
  { header: "Continuation key", className: "hidden lg:table-cell" },
  { header: "Agent", className: "hidden md:table-cell" },
  { header: "Daemon", className: "hidden lg:table-cell" },
  { header: "Status" },
];
const SESSIONS_PENDING = {
  title: "No agent session yet",
  description: "Sessions appear here once a daemon starts an agent.",
};
const SESSIONS_NONE = {
  title: "No agent session",
  description: "No agent call reached a session.",
};
const STEPS_PENDING = {
  title: "No steps yet",
  description: "Steps appear as the code reaches them.",
};
const STEPS_NONE = {
  title: "No steps",
  description: "This run ended before its code took a step.",
};
const STEP_COLUMNS = [
  { header: "Step", fill: true },
  { header: "Kind", className: "hidden sm:table-cell" },
  { header: "Status" },
];

export function CodeActivityDetail({
  view,
  onViewChange,
  ...scope
}: RunScope & {
  view: string;
  /** Opening a session or a step from Run details moves to the view that shows it. */
  onViewChange: (view: string) => void;
}) {
  const load = useServerFn(codeTriggerRunDetail);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stepId, setStepId] = useState<string | null>(null);
  const openSession = useCallback(
    (id: string) => {
      setSessionId(id);
      onViewChange("conversation");
    },
    [onViewChange],
  );
  const openStep = useCallback(
    (id: string) => {
      setStepId(id);
      onViewChange("diagnostics");
    },
    [onViewChange],
  );
  const snapshot = useSnapshotQuery({
    queryKey: ["trigger-code-run", scope.organizationSlug, scope.runId],
    queryFn: () => load({ data: scope }),
    refetchInterval: 3000,
  });
  if (snapshot.status === "pending") return <LoadingLine>Loading Trigger run…</LoadingLine>;
  if (snapshot.status === "error")
    return (
      <FailureAlert
        title="Run unavailable"
        error={snapshot.error}
        fallback="Hub couldn't load this Trigger run."
        onRetry={snapshot.refetch}
      />
    );
  const { run, operations, logs } = snapshot.data;
  const { calls, sessions } = agentSessions(operations);
  const active = ACTIVE_STATUSES.has(run.status);
  const session = sessions.find((entry) => entry.id === sessionId) ?? initialSession(sessions);
  return (
    <div className="grid min-w-0 gap-5">
      <SummaryPanel
        label="Trigger run"
        rows={[
          { label: "Status", value: <RunStatus run={run} /> },
          { label: "Started", value: <RelativeTime value={run.createdAt} /> },
          { label: "Event", value: runEventSummary(run.event) },
          { label: "Daemon", value: daemonList(operations) },
        ]}
      />
      {run.error === null ? null : (
        <FailureAlert
          title={run.status === "skipped" ? "Run skipped" : "Run ended"}
          error={run.error}
          fallback="Inspect the run details."
        />
      )}
      <div className="min-w-0">
        {view === "conversation" ? (
          <Conversation
            scope={scope}
            active={active}
            calls={calls}
            sessions={sessions}
            session={session}
            onSelect={setSessionId}
          />
        ) : null}
        {view === "details" ? (
          <RunDetails
            run={run}
            operations={operations}
            calls={calls}
            sessions={sessions}
            active={active}
            onOpenSession={openSession}
            onOpenStep={openStep}
          />
        ) : null}
        {view === "diagnostics" ? (
          <Diagnostics
            scope={scope}
            run={run}
            operations={operations}
            logs={logs}
            active={active}
            stepId={stepId}
            onSelectStep={setStepId}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The run's state, and how long it took or has taken so far. */
function RunStatus({ run }: { run: Run }) {
  const duration = runDuration(run);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusPill tone={tone(run.status)}>{statusLabel(run.status)}</StatusPill>
      {duration === null ? null : <span className="text-muted-foreground">{duration}</span>}
    </span>
  );
}

function runDuration(run: Run): string | null {
  if (run.status === "running" || run.status === "waiting")
    return `for ${formatDuration(elapsed(run.createdAt, null))}`;
  if (run.completedAt === null || !["succeeded", "failed", "timed_out"].includes(run.status))
    return null;
  return `in ${formatDuration(elapsed(run.createdAt, run.completedAt))}`;
}

function Conversation({
  scope,
  active,
  calls,
  sessions,
  session,
  onSelect,
}: {
  scope: RunScope;
  active: boolean;
  calls: readonly AgentCall[];
  sessions: readonly RunSession[];
  session: RunSession | undefined;
  onSelect: (id: string) => void;
}) {
  const select = useCallback((option: { value: string }) => onSelect(option.value), [onSelect]);
  if (session === undefined) {
    if (calls.length === 0)
      return (
        <EmptyState
          title="No agent calls"
          description="This run didn't call an agent. Run details show the steps it took."
        />
      );
    return (
      <EmptyState
        title="No agent session yet"
        description={
          active
            ? `${calls[0]?.id ?? "The first call"} is waiting for an agent session.`
            : "No agent call reached a session. Run details show what happened."
        }
      />
    );
  }
  return (
    <div className="grid min-w-0 gap-5">
      {sessions.length > 1 ? (
        <Combobox
          id={`code-session-${scope.runId}`}
          label="Agent session"
          placeholder="Select a session"
          searchPlaceholder="Search sessions by call…"
          empty="No sessions match."
          value={session.id}
          options={sessions.map((entry) => ({
            value: entry.id,
            label: sessionName(entry),
            detail: facts(originLabel(entry.origin), statusLabel(entry.state)),
            keywords: entry.calls.map((call) => call.id),
            icon: <AgentProviderMark provider={entry.calls[0]?.agent.provider ?? ""} />,
          }))}
          onChange={select}
        />
      ) : null}
      {session.origin?.kind === "earlier" ? (
        <NoticeAlert tone="neutral" title="Continued from an earlier run">
          Messages before this run's first prompt came from earlier runs of this Trigger that used
          the same continuation key.
        </NoticeAlert>
      ) : null}
      {session.origin?.kind === "renewed" ? (
        <NoticeAlert tone="neutral" title="Started over">
          Session {session.origin.replaces} had this continuation key, but a finished session that
          held Hub credentials is never continued, so this one started without its messages.
        </NoticeAlert>
      ) : null}
      <SessionHistory
        key={session.id}
        {...scope}
        executionId={session.executionId}
        running={active}
        view="conversation"
        prompts={session.calls.flatMap((call) =>
          call.executionId === null
            ? []
            : [{ messageId: call.executionId, text: call.agent.prompt, label: call.id }],
        )}
      />
    </div>
  );
}

function RunDetails({
  run,
  operations,
  calls,
  sessions,
  active,
  onOpenSession,
  onOpenStep,
}: {
  run: Run;
  operations: readonly Operation[];
  calls: readonly AgentCall[];
  sessions: readonly RunSession[];
  active: boolean;
  onOpenSession: (id: string) => void;
  onOpenStep: (id: string) => void;
}) {
  const sessionOf = new Map(calls.map((call) => [call.id, call.session]));
  return (
    <>
      {calls.length === 0 ? null : (
        <Section title="Agent sessions" description={sessionsDescription(calls, sessions)}>
          <DataTable
            label="Agent sessions"
            columns={SESSION_COLUMNS}
            isEmpty={sessions.length === 0}
            empty={active ? SESSIONS_PENDING : SESSIONS_NONE}
          >
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} onOpen={onOpenSession} />
            ))}
          </DataTable>
        </Section>
      )}
      {run.output === null ? null : (
        <Section title="Result" action={<CopyButton label="result" value={json(run.output)} />}>
          <CodeBlock label="Trigger result">{json(run.output)}</CodeBlock>
        </Section>
      )}
      <Section title="Steps" description="Each durable step, in the order the code reached it.">
        <DataTable
          label="Steps"
          columns={STEP_COLUMNS}
          isEmpty={operations.length === 0}
          empty={active ? STEPS_PENDING : STEPS_NONE}
        >
          {operations.map((operation) => (
            <StepRow
              key={operation.id}
              operation={operation}
              session={sessionOf.get(operation.id) ?? null}
              onOpen={onOpenStep}
            />
          ))}
        </DataTable>
      </Section>
    </>
  );
}

function SessionRow({ session, onOpen }: { session: RunSession; onOpen: (id: string) => void }) {
  const open = useCallback(() => onOpen(session.id), [onOpen, session.id]);
  const agent = session.calls[0]?.agent;
  const key = agent?.continuationKey ?? null;
  return (
    <DataRow onSelect={open}>
      <DataCell>
        {/* A session is known by the calls that ran in it; its number ties it to the steps. */}
        <TwoLine
          primary={
            <Button variant="link" onClick={open}>
              {sessionCalls(session)}
            </Button>
          }
          secondary={facts(`Session ${String(session.number)}`, originLabel(session.origin))}
        />
      </DataCell>
      <DataCell>{key === null ? "—" : <span className="font-mono text-xs">{key}</span>}</DataCell>
      <DataCell>
        <TwoLine
          primary={agent?.provider == null ? "—" : agentProviderLabel(agent.provider)}
          secondary={agent?.model ?? "Default model"}
        />
      </DataCell>
      <DataCell>{daemonList(session.calls)}</DataCell>
      <DataCell>
        <StatusPill tone={tone(session.state)}>{statusLabel(session.state)}</StatusPill>
      </DataCell>
    </DataRow>
  );
}

function StepRow({
  operation,
  session,
  onOpen,
}: {
  operation: Operation;
  session: number | null;
  onOpen: (id: string) => void;
}) {
  const open = useCallback(() => onOpen(operation.id), [onOpen, operation.id]);
  const { kind, summary } = describeOperation(operation);
  const status = stepStatus(operation);
  return (
    <DataRow onSelect={open}>
      <DataCell>
        <TwoLine
          primary={
            <Button variant="link" onClick={open}>
              {operation.id}
            </Button>
          }
          {...(summary === "" ? {} : { secondary: summary })}
        />
      </DataCell>
      <DataCell>
        <TwoLine
          primary={kind}
          {...(session === null ? {} : { secondary: `Session ${String(session)}` })}
        />
      </DataCell>
      <DataCell>
        <StatusPill tone={tone(status)}>{statusLabel(status)}</StatusPill>
      </DataCell>
    </DataRow>
  );
}

function Diagnostics({
  scope,
  run,
  operations,
  logs,
  active,
  stepId,
  onSelectStep,
}: {
  scope: RunScope;
  run: Run;
  operations: readonly Operation[];
  logs: readonly Log[];
  active: boolean;
  stepId: string | null;
  onSelectStep: (id: string) => void;
}) {
  const select = useCallback(
    (option: { value: string }) => onSelectStep(option.value),
    [onSelectStep],
  );
  const step =
    operations.find((operation) => operation.id === stepId) ??
    operations.find((operation) => operation.status === "failed") ??
    operations.at(-1);
  const data =
    step === undefined ? "" : json({ input: step.input, output: step.output, error: step.error });
  const log = logs
    .map(
      (entry) =>
        `${entry.time} ${entry.message}${entry.data === null ? "" : ` ${JSON.stringify(entry.data)}`}`,
    )
    .join("\n");
  return (
    <>
      <Section title="Run">
        <SummaryPanel
          label="Run diagnostics"
          rows={[
            {
              label: "Run ID",
              value: <span className="font-mono text-xs break-all">{run.id}</span>,
            },
            { label: "Code revision", value: run.version === null ? "—" : String(run.version) },
            { label: "Deadline", value: <RelativeTime value={run.deadlineAt} /> },
            {
              label: "Completed",
              value: run.completedAt === null ? "—" : <RelativeTime value={run.completedAt} />,
            },
          ]}
        />
      </Section>
      <Section
        title="Step data"
        description="What a step was given and what it returned, as Hub stored them."
        {...(step === undefined
          ? {}
          : { action: <CopyButton label={`${step.id} data`} value={data} /> })}
      >
        {step === undefined ? (
          <EmptyState title="No steps yet" />
        ) : (
          <>
            <Combobox
              id={`code-step-${run.id}`}
              label="Step"
              placeholder="Select a step"
              empty="No steps match."
              value={step.id}
              options={operations.map((operation) => ({
                value: operation.id,
                label: operation.id,
                detail: `${describeOperation(operation).kind} · ${statusLabel(stepStatus(operation))}`,
              }))}
              onChange={select}
            />
            <CodeBlock label={`${step.id} data`}>{data}</CodeBlock>
          </>
        )}
      </Section>
      {step?.agent != null && step.executionId !== null ? (
        <SessionHistory
          key={step.executionId}
          {...scope}
          executionId={step.executionId}
          running={active}
          view="diagnostics"
        />
      ) : null}
      <Section
        title="Runner log"
        {...(log === "" ? {} : { action: <CopyButton label="runner log" value={log} /> })}
      >
        {log === "" ? (
          <EmptyState
            title="No log entries"
            description="Lines the Trigger code logs appear here."
          />
        ) : (
          <CodeBlock label="Runner log">{log}</CodeBlock>
        )}
      </Section>
      <Section
        title="Trigger event"
        description={`${run.event.source}.${run.event.type}`}
        action={<CopyButton label="Trigger event" value={json(run.event)} />}
      >
        <CodeBlock label="Trigger event">{json(run.event)}</CodeBlock>
      </Section>
    </>
  );
}

function sessionsDescription(calls: readonly AgentCall[], sessions: readonly RunSession[]): string {
  const count = `${plural(calls.length, "agent call")} in ${plural(sessions.length, "session")}.`;
  return sessions.some((session) => session.origin?.kind === "renewed")
    ? `${count} Calls that share a continuation key continue one session, unless it finished holding Hub credentials.`
    : `${count} Calls that share a continuation key continue one session.`;
}

function sessionName(session: RunSession): string {
  return `Session ${String(session.number)} · ${sessionCalls(session)}`;
}

function sessionCalls(session: RunSession): string {
  return session.calls.map((call) => call.id).join(" → ");
}

/** Null when Hub never recorded where the session came from, rather than a guess. */
function originLabel(origin: RunSession["origin"]): string | null {
  if (origin === null) return null;
  if (origin.kind === "earlier") return "Continued from an earlier run";
  if (origin.kind === "renewed") return `Replaced session ${String(origin.replaces)}`;
  return "Started in this run";
}

function facts(...parts: readonly (string | null)[]): string {
  return parts.filter((part) => part !== null).join(" · ");
}

/** An agent call that holds a session is working, though its operation is waiting on it. */
function stepStatus(operation: Operation): string {
  return operation.kind === "agent" &&
    operation.status === "waiting" &&
    operation.executionId !== null
    ? "running"
    : operation.status;
}

function daemonList(records: readonly { daemons: readonly string[] }[]): string {
  return [...new Set(records.flatMap((record) => record.daemons))].join(" · ") || "—";
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "";
}

function tone(status: string): "success" | "danger" | "neutral" {
  if (status === "succeeded" || status === "completed") return "success";
  if (status === "failed" || status === "timed_out") return "danger";
  return "neutral";
}
