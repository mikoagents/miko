import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  agentSessions,
  describeOperation,
  elapsed,
  initialSession,
  operationState,
  journalEntry,
  milestoneDetail,
  milestoneTone,
  operationDuration,
  operationSpans,
  runEventSummary,
  runShape,
  shapeSummary,
  stepCount,
  type CallState,
  type JournalEntry,
  type RunAgent,
  type RunOperation,
  type RunShape,
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
    completedAt: null,
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
    completedAt: null,
    executionId: null,
    daemons: [],
    agent: null,
  };
}

const START = Date.parse("2026-11-14T00:00:00.000Z");

/** The instant this many seconds into a run. */
function at(seconds: number): string {
  return new Date(START + seconds * 1000).toISOString();
}

function journal(
  id: string,
  kind: string,
  from: number,
  to: number | null,
  state: CallState = "completed",
  group: string | null = null,
): JournalEntry {
  return {
    id,
    kind,
    state,
    createdAt: at(from),
    completedAt: to === null ? null : at(to),
    group,
  };
}

function ids(records: readonly { id: string }[]): string[] {
  return records.map((entry) => entry.id);
}

function stageIds(shape: RunShape): string[][] {
  return shape.stages.map((stage) => ids(stage.milestones));
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

  it("measures the time between two instants, or until now", () => {
    assert.equal(elapsed("2026-11-14T00:00:00.000Z", "2026-11-14T00:00:05.000Z"), 5000);
    assert.equal(
      elapsed("2026-11-14T00:00:00.000Z", null, Date.parse("2026-11-14T00:01:00.000Z")),
      60_000,
    );
  });

  it("draws calls made together as one stage and counts the steps between stages", () => {
    const shape = runShape(
      [
        journal("handled", "state.get", 0, 0.1),
        journal("audit:api", "agent", 1, 1120),
        journal("audit:web", "agent", 1, 665),
        journal("audit:infra", "agent", 1, 870, "failed"),
        journal("fix:api", "agent", 1121, 2380),
        journal("ci:api:0", "event", 2381, 3000, "completed", "ci:api"),
        journal("ci:api:7", "event", 3000, 5570, "completed", "ci:api"),
        journal("pr:api", "github", 5571, 5572),
        journal("report", "agent", 5573, null, "running"),
        journal("seen", "state.set", 5574, 5574),
      ],
      START + 5702_000,
    );
    assert.deepEqual(stageIds(shape), [
      ["audit:api", "audit:web", "audit:infra"],
      ["fix:api"],
      ["ci:api"],
      ["report"],
    ]);
    assert.deepEqual(
      shape.stages.map((stage) => stage.steps),
      [1, 0, 0, 1],
    );
    assert.equal(shape.trailing, 1);
    // An event wait the code retried is one wait, opened by its first try and ended by its last.
    assert.deepEqual(shape.stages[2]?.milestones[0], {
      id: "ci:api",
      operationId: "ci:api:7",
      kind: "event",
      state: "completed",
      wait: true,
      startedAt: at(2381),
      completedAt: at(5570),
    });
  });

  it("keeps stages apart when the journal never said when they ended", () => {
    const shape = runShape(
      [journal("plan", "agent", 0, null), journal("check", "agent", 0, null)],
      START + 60_000,
    );
    assert.deepEqual(stageIds(shape), [["plan"], ["check"]]);
  });

  it("draws a lock only once the run had to wait for it", () => {
    const shape = runShape(
      [
        journal("deploy:acquire", "lock", 0, 0.2),
        journal("release:acquire", "lock", 1, 31),
        journal("ship:acquire", "lock", 40, null, "waiting"),
      ],
      START + 60_000,
    );
    assert.deepEqual(
      shape.stages.map((stage) => ({ steps: stage.steps, id: stage.milestones[0]?.id })),
      [
        { steps: 1, id: "release:acquire" },
        { steps: 0, id: "ship:acquire" },
      ],
    );
    assert.equal(shape.stages[0]?.milestones[0]?.wait, true);
  });

  it("says how each milestone went and how long it took", () => {
    const now = START + 600_000;
    const [stage] = runShape([journal("review", "agent", 0, 125)], now).stages;
    const review = stage?.milestones[0];
    assert.ok(review);
    assert.equal(milestoneDetail(review, now), "2m 5s");
    assert.equal(milestoneTone(review), "complete");
    assert.equal(milestoneDetail({ ...review, state: "failed" }, now), "Failed after 2m 5s");
    assert.equal(milestoneTone({ ...review, state: "failed", wait: true }), "failed");
    assert.equal(milestoneDetail({ ...review, state: "running" }, now), "Running 10m");
    assert.equal(milestoneTone({ ...review, state: "running" }), "running");
    assert.equal(milestoneDetail({ ...review, state: "waiting" }, now), "Queued 10m");
    assert.equal(milestoneDetail({ ...review, state: "waiting", wait: true }, now), "Waiting 10m");
    assert.equal(milestoneTone({ ...review, state: "waiting", wait: true }), "waiting");
    assert.equal(milestoneDetail({ ...review, wait: true }, now), "Waited 2m 5s");
    assert.equal(milestoneDetail({ ...review, completedAt: null }, now), "Completed");
    assert.equal(milestoneDetail({ ...review, completedAt: null, wait: true }, now), "Waited");
  });

  it("reads a run's shape aloud", () => {
    const now = START + 600_000;
    assert.equal(
      shapeSummary(
        runShape(
          [
            journal("ci:0", "event", 0, 60, "completed", "ci"),
            journal("review", "agent", 61, 181),
            journal("lint", "agent", 61, null, "running"),
          ],
          now,
        ),
        now,
      ),
      "ci: Waited 1m, then review: 2m and lint: Running 8m 59s",
    );
    assert.equal(shapeSummary(runShape([journal("load", "step", 0, 1)], now), now), "1 step");
    assert.equal(stepCount(0), "No steps");
    assert.equal(stepCount(3), "3 steps");
  });

  it("reads an operation's state and wait group from the run detail", () => {
    assert.deepEqual(
      journalEntry({
        ...step("ci:3", "event", { source: "github", group: "ci" }),
        status: "waiting",
      }),
      {
        id: "ci:3",
        kind: "event",
        state: "waiting",
        createdAt: "2026-11-14T00:00:00.000Z",
        completedAt: null,
        group: "ci",
      },
    );
    assert.equal(journalEntry({ ...step("load", "step", {}), status: "running" }).state, "running");
    assert.equal(
      journalEntry(agentOperation("plan", {}, { status: "waiting", executionId: null })).state,
      "waiting",
    );
    // An agent call ended when its agent did, before Hub's next pass recorded it.
    assert.equal(
      journalEntry(agentOperation("plan", { completedAt: at(30) }, { completedAt: at(32) }))
        .completedAt,
      at(30),
    );
  });

  it("draws an agent call's wait for a daemon apart from its work", () => {
    const now = START + 600_000;
    const call = agentOperation(
      "review",
      { startedAt: at(20), completedAt: at(140) },
      { createdAt: at(0) },
    );
    assert.deepEqual(operationSpans(call, now), [
      { from: START, to: START + 20_000, tone: "waiting" },
      { from: START + 20_000, to: START + 140_000, tone: "complete" },
    ]);
    assert.equal(operationDuration(call, now), 140_000);
    assert.deepEqual(operationSpans({ ...call, status: "failed" }, now).at(-1)?.tone, "failed");
    assert.deepEqual(operationSpans({ ...step("ci:0", "event", {}), completedAt: at(90) }, now), [
      { from: START, to: START + 90_000, tone: "waiting" },
    ]);
    const running = { ...step("load", "step", {}), status: "running" };
    assert.deepEqual(operationSpans(running, now), [{ from: START, to: now, tone: "running" }]);
    assert.equal(operationDuration(running, now), 600_000);
    // A step the journal finished without saying when draws nothing rather than a guess.
    assert.deepEqual(operationSpans(step("load", "step", {}), now), []);
    assert.equal(operationDuration(step("load", "step", {}), now), null);
  });

  it("keeps ended runs from animating a journal entry as live work", () => {
    const call = agentOperation("review", {}, { status: "waiting" });
    const now = START + 600_000;
    const entry = journalEntry(call, "cancelled");
    assert.equal(entry.state, "cancelled");
    assert.deepEqual(operationSpans(call, now, "cancelled"), []);
    assert.equal(operationDuration(call, now, "cancelled"), null);
    const shape = runShape([entry], now);
    const milestone = shape.stages[0]?.milestones[0];
    assert.ok(milestone);
    assert.equal(milestoneDetail(milestone, now), "Cancelled");
    assert.equal(milestoneTone(milestone), "complete");
    assert.equal(milestoneTone({ ...milestone, state: "skipped" }), "complete");
    assert.equal(milestoneTone({ ...milestone, state: "timed_out" }), "failed");
    assert.equal(milestoneDetail({ ...milestone, state: "timed_out" }, now), "Timed out");
  });
});
