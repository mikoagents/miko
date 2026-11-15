import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  agentSessions,
  describeOperation,
  elapsed,
  formatDuration,
  initialSession,
  operationState,
  runEventSummary,
  type RunAgent,
  type RunOperation,
} from "./run-presentation.js";

function agentOperation(
  id: string,
  agent: Partial<RunAgent>,
  operation: Partial<RunOperation> = {},
): RunOperation {
  return {
    id,
    kind: "agent",
    status: "completed",
    input: {},
    error: null,
    createdAt: "2026-11-14T00:00:00.000Z",
    executionId: `execution-${id}`,
    daemons: ["studio"],
    agent: {
      provider: "codex",
      model: null,
      title: null,
      prompt: `Prompt for ${id}`,
      continuationKey: null,
      sessionId: `session-${id}`,
      sessionAction: "created",
      startedAt: null,
      completedAt: null,
      ...agent,
    },
    ...operation,
  };
}

function step(id: string, kind: string, input: unknown): RunOperation {
  return {
    id,
    kind,
    status: "completed",
    input,
    error: null,
    createdAt: "2026-11-14T00:00:00.000Z",
    executionId: null,
    daemons: [],
    agent: null,
  };
}

function ids(records: readonly { id: string }[]): string[] {
  return records.map((entry) => entry.id);
}

describe("Trigger run presentation", () => {
  it("groups the rounds of one session and numbers sessions by first use", () => {
    const { calls, sessions } = agentSessions([
      agentOperation("plan", { continuationKey: "review", sessionId: "a" }),
      step("load", "step", { issue: 1 }),
      agentOperation("check", { sessionId: "b" }),
      agentOperation(
        "revise",
        { continuationKey: "review", sessionId: "a", sessionAction: "restored" },
        { status: "waiting" },
      ),
    ]);
    assert.deepEqual(
      calls.map(({ id, session, state }) => ({ id, session, state })),
      [
        { id: "plan", session: 1, state: "completed" },
        { id: "check", session: 2, state: "completed" },
        { id: "revise", session: 1, state: "running" },
      ],
    );
    assert.deepEqual(
      sessions.map((session) => ({
        id: session.id,
        number: session.number,
        origin: session.origin,
        state: session.state,
        executionId: session.executionId,
        calls: ids(session.calls),
      })),
      [
        {
          id: "a",
          number: 1,
          origin: { kind: "new" },
          state: "running",
          executionId: "execution-revise",
          calls: ["plan", "revise"],
        },
        {
          id: "b",
          number: 2,
          origin: { kind: "new" },
          state: "completed",
          executionId: "execution-check",
          calls: ["check"],
        },
      ],
    );
    assert.equal(initialSession(sessions)?.id, "a");
  });

  it("tells a session from an earlier run apart from a key that had to start over", () => {
    const { calls, sessions } = agentSessions([
      agentOperation("resume", {
        continuationKey: "triage",
        sessionId: "old",
        sessionAction: "continued",
      }),
      agentOperation("again", { continuationKey: "triage", sessionId: "fresh" }),
      agentOperation(
        "queued",
        { sessionId: null, sessionAction: null },
        { executionId: null, status: "waiting" },
      ),
    ]);
    assert.deepEqual(
      calls.map(({ id, session, state }) => ({ id, session, state })),
      [
        { id: "resume", session: 1, state: "completed" },
        { id: "again", session: 2, state: "completed" },
        { id: "queued", session: null, state: "waiting" },
      ],
    );
    assert.deepEqual(
      sessions.map(({ id, origin }) => ({ id, origin })),
      [
        { id: "old", origin: { kind: "earlier" } },
        { id: "fresh", origin: { kind: "renewed", replaces: 1 } },
      ],
    );
    assert.equal(initialSession(sessions)?.id, "fresh");
    assert.equal(initialSession([]), undefined);
  });

  it("keeps a shared session running until every parallel call has finished", () => {
    const { calls, sessions } = agentSessions([
      agentOperation(
        "a",
        { continuationKey: "shared", sessionId: "shared" },
        { status: "waiting" },
      ),
      agentOperation("check", { sessionId: "other" }, { status: "completed" }),
      agentOperation(
        "b",
        { continuationKey: "shared", sessionId: "shared", sessionAction: "continued" },
        { status: "completed" },
      ),
    ]);
    assert.deepEqual(
      calls.map(({ id, state }) => ({ id, state })),
      [
        { id: "a", state: "running" },
        { id: "check", state: "completed" },
        { id: "b", state: "completed" },
      ],
    );
    assert.deepEqual(
      sessions.map(({ id, state }) => ({ id, state })),
      [
        { id: "shared", state: "running" },
        { id: "other", state: "completed" },
      ],
    );
    assert.equal(initialSession(sessions)?.id, "shared");
  });

  it("does not treat a surviving execution id as running after the parent ends", () => {
    const waiting = agentOperation("review", { sessionId: "live" }, { status: "waiting" });
    for (const parentStatus of ["cancelled", "timed_out", "failed", "skipped"] as const) {
      const { calls, sessions } = agentSessions([waiting], parentStatus);
      assert.equal(calls[0]?.state, parentStatus);
      assert.equal(sessions[0]?.state, parentStatus);
      assert.equal(operationState(waiting, parentStatus), parentStatus);
      assert.equal(
        operationState({ ...waiting, kind: "agent" }, parentStatus),
        parentStatus,
        parentStatus,
      );
    }
    const finished = agentOperation("review", { sessionId: "live" }, { status: "completed" });
    assert.equal(agentSessions([finished], "cancelled").sessions[0]?.state, "completed");
    assert.equal(operationState({ ...waiting, executionId: null }, "cancelled"), "cancelled");
    assert.equal(operationState(waiting, "running"), "running");
    assert.equal(
      operationState({ ...waiting, kind: "sleep", executionId: null }, "running"),
      "waiting",
    );
  });

  it("takes a session's origin from the call that created it and never guesses one", () => {
    const { sessions } = agentSessions([
      // Made at once, the call listed first reached Hub second and continued the new session.
      agentOperation("left", {
        continuationKey: "pair",
        sessionId: "pair",
        sessionAction: "continued",
      }),
      agentOperation("right", { continuationKey: "pair", sessionId: "pair" }),
      // A call that never reached a session leaves no session for the next call to replace.
      agentOperation(
        "lost",
        { continuationKey: "retry", sessionId: null, sessionAction: null },
        { status: "failed" },
      ),
      agentOperation("retry", { continuationKey: "retry", sessionId: "retry" }),
      // The agent never started, so Hub never recorded how the call got its session.
      agentOperation("stuck", { sessionId: "stuck", sessionAction: null }, { status: "failed" }),
    ]);
    assert.deepEqual(
      sessions.map(({ id, origin }) => ({ id, origin })),
      [
        { id: "pair", origin: { kind: "new" } },
        { id: "retry", origin: { kind: "new" } },
        { id: "stuck", origin: null },
      ],
    );
  });

  it("names each operation by what it did instead of its raw input", () => {
    assert.deepEqual(
      describeOperation(agentOperation("review", { title: "Review", prompt: "Read the diff" })),
      { kind: "Agent call", summary: "Review" },
    );
    assert.deepEqual(
      describeOperation(agentOperation("review", { prompt: "\n  Read the diff\nThen reply" })),
      { kind: "Agent call", summary: "Read the diff" },
    );
    assert.equal(
      describeOperation(agentOperation("review", { prompt: "x".repeat(400) })).summary.length,
      160,
    );
    assert.deepEqual(
      describeOperation(step("comment", "github", { method: "POST", path: "/repos/a/b/issues" })),
      { kind: "GitHub request", summary: "POST /repos/a/b/issues" },
    );
    assert.deepEqual(describeOperation(step("pause", "sleep", { milliseconds: 90_000 })), {
      kind: "Timer",
      summary: "1m 30s",
    });
    assert.deepEqual(
      describeOperation(step("reply", "event", { source: "github", event: ["a", "b"] })),
      { kind: "Event wait", summary: "github · a, b" },
    );
    assert.deepEqual(describeOperation(step("seen", "state.set", { key: "last" })), {
      kind: "State write",
      summary: "last",
    });
    assert.deepEqual(describeOperation(step("load", "step", { body: "x" })), {
      kind: "Code step",
      summary: "",
    });
  });

  it("words the starting event like the Trigger's configuration", () => {
    assert.equal(runEventSummary({ source: "manual", type: "run" }), "On demand");
    assert.equal(runEventSummary({ source: "schedule", type: "tick" }), "Schedule");
    assert.equal(
      runEventSummary({ source: "github", type: "pull_request.opened" }),
      "GitHub · Pull request opened",
    );
  });

  it("formats durations to the precision runs are compared by", () => {
    assert.equal(formatDuration(400), "under 1s");
    assert.equal(formatDuration(42_000), "42s");
    assert.equal(formatDuration(120_000), "2m");
    assert.equal(formatDuration(3_725_000), "1h 2m");
    assert.equal(formatDuration(93_600_000), "1d 2h");
    assert.equal(formatDuration(Number.NaN), "");
    assert.equal(formatDuration(-1), "");
    assert.equal(elapsed("2026-11-14T00:00:00.000Z", "2026-11-14T00:00:05.000Z"), 5000);
    assert.equal(
      elapsed("2026-11-14T00:00:00.000Z", null, Date.parse("2026-11-14T00:01:00.000Z")),
      60_000,
    );
  });
});
