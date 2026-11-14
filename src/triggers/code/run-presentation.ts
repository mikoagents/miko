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
  executionId: string | null;
  daemons: readonly string[];
  agent: RunAgent | null;
}

export type CallState = "waiting" | "running" | "completed" | "failed";

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

/** The run's agent calls in the order the code made them, and the sessions they ran in. */
export function agentSessions(operations: readonly RunOperation[]): {
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
      state: callState(operation),
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
        session.state = call.state;
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

function callState(operation: RunOperation): CallState {
  if (operation.status === "completed") return "completed";
  if (operation.status === "failed") return "failed";
  return operation.executionId === null ? "waiting" : "running";
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

/** The event that started a run, worded as the Trigger's configuration words its events. */
export function runEventSummary(event: { source: string; type: string }): string {
  if (event.source === "schedule") return "Schedule";
  return subscriptionSummary({ source: event.source, event: event.type });
}

/** How long something took, to the precision a reader compares runs by. */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 1) return "under 1s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return pair(minutes, "m", seconds % 60, "s");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return pair(hours, "h", minutes % 60, "m");
  return pair(Math.floor(hours / 24), "d", hours % 24, "h");
}

/** The time between two instants, or until now while the second has not happened yet. */
export function elapsed(from: string, to: string | null, now = Date.now()): number {
  return (to === null ? now : Date.parse(to)) - Date.parse(from);
}

function pair(major: number, majorUnit: string, minor: number, minorUnit: string): string {
  return minor === 0 ? `${major}${majorUnit}` : `${major}${majorUnit} ${minor}${minorUnit}`;
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
