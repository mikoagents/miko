import type { TimelineSpan, TimelineTone } from "../../lib/timeline.js";
import { formatDuration } from "../../lib/duration.js";
import { subscriptionSummary } from "./presentation.js";

/** How Hub gave an agent call its session: a new agent, the live one, or an archived one. */
export type SessionAction = "created" | "continued" | "restored";

/** What a run's read model says about one `ctx.agent.run` call. */
export interface RunAgent {
  provider: string | null;
  model: string | null;
  title: string | null;
  prompt: string;
  continuationKey: string | null;
  sessionId: string | null;
  sessionAction: SessionAction | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** One durable operation of a Trigger run, as the run detail reads it. */
export interface RunOperation {
  id: string;
  kind: string;
  status: string;
  input: unknown;
  error: string | null;
  createdAt: string;
  /** When Hub recorded the outcome; null while open, and on journals that predate it. */
  completedAt: string | null;
  executionId: string | null;
  daemons: readonly string[];
  agent: RunAgent | null;
}

export type CallState =
  | "waiting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "skipped";

export interface AgentCall {
  id: string;
  agent: RunAgent;
  executionId: string | null;
  state: CallState;
  daemons: readonly string[];
  /** The session this call ran in, numbered by first use in this run; null until it has one. */
  session: number | null;
}

/**
 * Where a session came from. `earlier` continued a session an earlier run left. `renewed` replaced
 * the session of this run numbered `replaces`, which held the same key: a finished session that
 * held Hub-issued credentials is never continued.
 */
export type SessionOrigin =
  | { kind: "new" }
  | { kind: "earlier" }
  | { kind: "renewed"; replaces: number };

export interface RunSession {
  id: string;
  number: number;
  /** The calls this run made in it, in order: each one after the first is another round. */
  calls: AgentCall[];
  /** Null when no call recorded how Hub gave it the session, as when its agent never started. */
  origin: SessionOrigin | null;
  state: CallState;
  /** The execution whose history is read; every call in a session reads the same history. */
  executionId: string;
}

type SessionCalls = Omit<RunSession, "origin">;

/**
 * The run's agent calls in the order the code made them, and the sessions they ran in.
 * `parentStatus` is the durable run status. Cancel, timeout, failure and skip stop the child
 * without rewriting a waiting journal entry, so a terminal parent is part of the projection.
 */
export function agentSessions(
  operations: readonly RunOperation[],
  parentStatus?: string,
): {
  calls: AgentCall[];
  sessions: RunSession[];
} {
  const calls: AgentCall[] = [];
  const sessions = new Map<string, SessionCalls>();
  for (const operation of operations) {
    const agent = operation.agent;
    if (agent === null) continue;
    const executionId = operation.executionId;
    const sessionId = executionId === null ? null : agent.sessionId;
    const session = sessionId === null ? undefined : sessions.get(sessionId);
    const call: AgentCall = {
      id: operation.id,
      agent,
      executionId,
      state: operationState(operation, parentStatus),
      daemons: operation.daemons,
      session: sessionId === null ? null : (session?.number ?? sessions.size + 1),
    };
    if (sessionId !== null && executionId !== null) {
      if (session === undefined)
        sessions.set(sessionId, {
          id: sessionId,
          number: sessions.size + 1,
          calls: [call],
          state: call.state,
          executionId,
        });
      else {
        session.calls.push(call);
        session.state = dominantState(session.state, call.state);
        session.executionId = executionId;
      }
    }
    calls.push(call);
  }
  const ordered = [...sessions.values()];
  return {
    calls,
    sessions: ordered.map((session, index) =>
      Object.assign(session, { origin: sessionOrigin(session, ordered.slice(0, index)) }),
    ),
  };
}

/** A parent that has ended. Cleanup cancels children and leaves their journal entries waiting. */
const PARENT_END: Record<string, CallState> = {
  cancelled: "cancelled",
  timed_out: "timed_out",
  failed: "failed",
  skipped: "skipped",
};

/**
 * How a step or agent call reads. A started agent is running only while its parent run is still
 * live; an execution id left behind by cancel, timeout, failure or skip is not liveness.
 */
export function operationState(
  operation: { status: string; executionId: string | null; kind?: string },
  parentStatus?: string,
): CallState {
  if (operation.status === "completed") return "completed";
  if (operation.status === "failed") return "failed";
  const ended = parentStatus === undefined ? undefined : PARENT_END[parentStatus];
  if (ended !== undefined && (operation.status === "waiting" || operation.status === "running"))
    return ended;
  if (operation.status === "running") return "running";
  const started =
    operation.executionId !== null && (operation.kind === undefined || operation.kind === "agent");
  return operation.status === "waiting" && started ? "running" : "waiting";
}

/** A session stays running until every call in it has finished. */
const STATE_RANK: readonly CallState[] = [
  "completed",
  "skipped",
  "cancelled",
  "timed_out",
  "failed",
  "waiting",
  "running",
];

function dominantState(current: CallState, next: CallState): CallState {
  return STATE_RANK.indexOf(current) >= STATE_RANK.indexOf(next) ? current : next;
}

/**
 * Calls made at once can reach Hub in another order than the code made them, so the session's
 * origin is the call that created it, wherever it sits, and not whichever call came first.
 */
function sessionOrigin(
  session: SessionCalls,
  before: readonly SessionCalls[],
): SessionOrigin | null {
  const creator = session.calls.find((call) => call.agent.sessionAction === "created");
  if (creator === undefined)
    return session.calls.some((call) => call.agent.sessionAction !== null)
      ? { kind: "earlier" }
      : null;
  const key = creator.agent.continuationKey;
  const replaced =
    key === null
      ? undefined
      : before.findLast((other) => other.calls.some((call) => call.agent.continuationKey === key));
  return replaced === undefined ? { kind: "new" } : { kind: "renewed", replaces: replaced.number };
}

/** The session a reader starts on: the one still working, otherwise the latest. */
export function initialSession(sessions: readonly RunSession[]): RunSession | undefined {
  return sessions.findLast((session) => session.state === "running") ?? sessions.at(-1);
}

/** What kind of operation a step is, and the one line that tells it apart from its siblings. */
export function describeOperation(operation: RunOperation): { kind: string; summary: string } {
  const input = record(operation.input);
  const key = text(input["key"]);
  switch (operation.kind) {
    case "agent":
      return {
        kind: "Agent call",
        summary: operation.agent?.title ?? firstLine(operation.agent?.prompt ?? ""),
      };
    case "github":
      return {
        kind: "GitHub request",
        summary: [text(input["method"]), text(input["path"])].filter(Boolean).join(" "),
      };
    case "step":
      // A step's value is whatever the code handed it; Diagnostics shows it whole.
      return { kind: "Code step", summary: "" };
    case "sleep":
      return { kind: "Timer", summary: formatDuration(Number(input["milliseconds"])) };
    case "event": {
      const events = Array.isArray(input["event"]) ? input["event"] : [input["event"]];
      return {
        kind: "Event wait",
        summary: [text(input["source"]), events.map(text).filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" · "),
      };
    }
    case "claim":
      return { kind: "Claim", summary: key };
    case "lock":
      return { kind: "Lock", summary: key };
    case "unlock":
      return { kind: "Unlock", summary: key };
    case "state.get":
      return { kind: "State read", summary: key };
    case "state.set":
      return { kind: "State write", summary: key };
    case "state.delete":
      return { kind: "State delete", summary: key };
    default:
      return { kind: operation.kind, summary: "" };
  }
}

/**
 * An operation as a run's shape reads it: when it opened, whether and when it settled, and how.
 * The history list builds these from the journal alone; a run's detail also knows its agents.
 */
export interface JournalEntry {
  id: string;
  kind: string;
  state: CallState;
  createdAt: string;
  /** When it settled; null while open, and on journals that predate finish times. */
  completedAt: string | null;
  /** The `ctx.waitForEvent` an event operation belongs to; its retries share it. */
  group: string | null;
}

/** An agent call, a wait, or a failure: the points a run's shape is drawn through. */
export interface Milestone {
  /** What the code called it. An event wait's retries share the id the code gave the wait. */
  id: string;
  /** The operation a reader opens: for an event wait, its latest retry. */
  operationId: string;
  kind: string;
  state: CallState;
  /** It held up the run without doing work: an event, a timer, or another run's lock. */
  wait: boolean;
  startedAt: string;
  completedAt: string | null;
}

export interface RunStage {
  /** Operations since the stage before that are not milestones: reads, requests, code steps. */
  steps: number;
  /** Milestones that were open at the same time. Calls made together share a stage. */
  milestones: Milestone[];
}

/** The order a run went through its agent calls and waits, and the steps between them. */
export interface RunShape {
  stages: RunStage[];
  /** Steps after the last stage. */
  trailing: number;
}

const MILESTONE_KINDS = new Set(["agent", "event", "sleep"]);
const WAIT_KINDS = new Set(["event", "sleep", "lock"]);
/** A lock taken at once is a step; one the run had to wait for is a wait like any other. */
const LOCK_WAIT = 1000;

/**
 * Stages in the order they opened. A milestone that opened while the stage before it was still
 * open joins that stage, so calls a run made together read as one stage rather than a sequence.
 */
export function runShape(entries: readonly JournalEntry[], now: number): RunShape {
  const stages: (RunStage & { start: number; end: number })[] = [];
  const milestones = milestonesOf(entries, now).toSorted(
    (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
  );
  for (const milestone of milestones) {
    const start = Date.parse(milestone.startedAt);
    const end = settledEnd(milestone, now) ?? start;
    const last = stages.at(-1);
    if (last !== undefined && start < last.end) {
      last.milestones.push(milestone);
      last.end = Math.max(last.end, end);
    } else stages.push({ steps: 0, milestones: [milestone], start, end });
  }
  let trailing = 0;
  for (const entry of entries) {
    if (isMilestone(entry, now)) continue;
    const opened = Date.parse(entry.createdAt);
    const next = stages.find((stage) => stage.start > opened);
    if (next === undefined) trailing += 1;
    else next.steps += 1;
  }
  return {
    stages: stages.map((stage) => ({ steps: stage.steps, milestones: stage.milestones })),
    trailing,
  };
}

function milestonesOf(entries: readonly JournalEntry[], now: number): Milestone[] {
  const milestones: Milestone[] = [];
  const waits = new Map<string, Milestone>();
  for (const entry of entries) {
    if (!isMilestone(entry, now)) continue;
    const group = entry.kind === "event" ? entry.group : null;
    const retried = group === null ? undefined : waits.get(group);
    if (retried !== undefined) {
      // The code saw an event it was not waiting for and waited again: one wait, which ends
      // how its latest retry ends.
      retried.operationId = entry.id;
      retried.state = entry.state;
      retried.completedAt = entry.completedAt;
      continue;
    }
    const milestone: Milestone = {
      id: group ?? entry.id,
      operationId: entry.id,
      kind: entry.kind,
      state: entry.state,
      wait: WAIT_KINDS.has(entry.kind),
      startedAt: entry.createdAt,
      completedAt: entry.completedAt,
    };
    milestones.push(milestone);
    if (group !== null) waits.set(group, milestone);
  }
  return milestones;
}

function isMilestone(entry: JournalEntry, now: number): boolean {
  if (MILESTONE_KINDS.has(entry.kind) || entry.state === "failed") return true;
  if (entry.kind !== "lock") return false;
  const end = settledEnd(entry, now);
  return end !== null && end - Date.parse(entry.createdAt) >= LOCK_WAIT;
}

/** When something open runs until now; something settled at a time a journal did not record, null. */
function settledEnd(
  value: { state: CallState; completedAt: string | null },
  now: number,
): number | null {
  if (value.state === "running" || value.state === "waiting") return now;
  return value.completedAt === null ? null : Date.parse(value.completedAt);
}

/**
 * A milestone drawn as a timeline draws the same stretch. A parent that has ended is not still
 * running or waiting, even when the journal entry it stopped was a wait.
 */
export function milestoneTone(milestone: Milestone): TimelineTone {
  if (milestone.state === "failed" || milestone.state === "timed_out") return "failed";
  if (milestone.state === "cancelled" || milestone.state === "skipped") return "complete";
  if (milestone.wait) return "waiting";
  return milestone.state === "completed" ? "complete" : "running";
}

/** How a milestone went and how long it took, or has taken so far. */
export function milestoneDetail(milestone: Milestone, now: number): string {
  if (milestone.state === "cancelled") return "Cancelled";
  if (milestone.state === "skipped") return "Skipped";
  if (milestone.state === "timed_out") return "Timed out";
  const end = settledEnd(milestone, now);
  const took = end === null ? "" : formatDuration(end - Date.parse(milestone.startedAt));
  if (milestone.state === "failed") return took === "" ? "Failed" : `Failed after ${took}`;
  if (milestone.state === "running") return `Running ${took}`;
  // An agent call waits for a daemon to give it a session; anything else waits on the world.
  if (milestone.state === "waiting") return `${milestone.wait ? "Waiting" : "Queued"} ${took}`;
  if (milestone.wait) return took === "" ? "Waited" : `Waited ${took}`;
  return took === "" ? "Completed" : took;
}

/** A run's shape as one sentence, for whoever cannot see it drawn. */
export function shapeSummary(shape: RunShape, now: number): string {
  if (shape.stages.length === 0) return stepCount(shape.trailing);
  return shape.stages
    .map((stage) =>
      stage.milestones
        .map((milestone) => `${milestone.id}: ${milestoneDetail(milestone, now)}`)
        .join(" and "),
    )
    .join(", then ");
}

/** Steps as a count a reader says aloud: "1 step", "3 steps", "No steps". */
export function stepCount(count: number): string {
  if (count === 0) return "No steps";
  return `${String(count)} ${count === 1 ? "step" : "steps"}`;
}

/** An operation of a run's detail as its shape reads it. */
export function journalEntry(operation: RunOperation, parentStatus?: string): JournalEntry {
  return {
    id: operation.id,
    kind: operation.kind,
    state: operationState(operation, parentStatus),
    createdAt: operation.createdAt,
    completedAt: settledAt(operation),
    group: operation.kind === "event" ? text(record(operation.input)["group"]) || null : null,
  };
}

/** An agent call ended when its agent did; Hub records the outcome on its next pass. */
function settledAt(operation: RunOperation): string | null {
  return operation.agent?.completedAt ?? operation.completedAt;
}

/**
 * How long an operation took, or has taken so far; null when it settled at a time the journal
 * did not record.
 */
export function operationDuration(
  operation: RunOperation,
  now: number,
  parentStatus?: string,
): number | null {
  const end = settledEnd(
    { state: operationState(operation, parentStatus), completedAt: settledAt(operation) },
    now,
  );
  return end === null ? null : Math.max(0, end - Date.parse(operation.createdAt));
}

/**
 * The stretches an operation drew on a run's clock. An agent call waited for a daemon before it
 * worked, so its time before the agent started is a wait.
 */
export function operationSpans(
  operation: RunOperation,
  now: number,
  parentStatus?: string,
): TimelineSpan[] {
  const state = operationState(operation, parentStatus);
  const from = Date.parse(operation.createdAt);
  const to = settledEnd({ state, completedAt: settledAt(operation) }, now);
  if (to === null) return [];
  const tone = spanTone(operation.kind, state);
  const started = operation.agent?.startedAt == null ? null : Date.parse(operation.agent.startedAt);
  if (started === null || started <= from || started >= to) return [{ from, to, tone }];
  return [
    { from, to: started, tone: "waiting" },
    { from: started, to, tone },
  ];
}

function spanTone(kind: string, state: CallState): TimelineTone {
  if (state === "failed" || state === "timed_out") return "failed";
  if (WAIT_KINDS.has(kind) || state === "waiting") return "waiting";
  return state === "running" ? "running" : "complete";
}

/** The event that started a run, worded as the Trigger's configuration words its events. */
export function runEventSummary(event: { source: string; type: string }): string {
  if (event.source === "schedule") return "Schedule";
  return subscriptionSummary({ source: event.source, event: event.type });
}

/** The time between two instants, or until now while the second has not happened yet. */
export function elapsed(from: string, to: string | null, now = Date.now()): number {
  return (to === null ? now : Date.parse(to)) - Date.parse(from);
}

const EMPTY: Record<string, unknown> = {};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : EMPTY;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A prompt's first line: enough to tell two calls apart, and the whole prompt is a click away. */
function firstLine(value: string): string {
  const line = value.trim().split("\n", 1)[0] ?? "";
  return line.length > 160 ? line.slice(0, 159) + "…" : line;
}
