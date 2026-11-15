/* oxlint-disable oxc/no-map-spread -- invalid fixtures copy the original graph without mutating it */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { TriggerManifestSchema } from "./contract.js";
import { TriggerPipelineSchema } from "./pipeline-schema.js";
import { pipelineRunStates } from "./pipeline.js";
import { layoutPipeline } from "../../lib/pipeline.js";
import { testPipeline } from "../../test-utils/pipeline.js";
import type { TriggerPipeline } from "./sdk.js";

export const REVIEW_PIPELINE: TriggerPipeline = {
  nodes: [
    { id: "event", kind: "event", label: "Incoming event", description: "Receive a PR event." },
    {
      id: "review",
      kind: "agent",
      label: "Review",
      description: "Independently review the current head.",
      operations: ["review:*"],
    },
    {
      id: "ready",
      kind: "decision",
      label: "Ready?",
      description: "Check the formal Review findings.",
    },
    {
      id: "repair",
      kind: "agent",
      label: "Repair",
      description: "Repair findings and push a new head.",
      operations: ["repair:*"],
    },
    {
      id: "done",
      kind: "outcome",
      label: "Publish result",
      description: "Return the verified Review receipt.",
    },
  ],
  edges: [
    { from: "event", to: "review" },
    { from: "review", to: "ready" },
    { from: "ready", to: "repair", label: "Findings remain" },
    { from: "ready", to: "done", label: "No findings" },
    { from: "repair", to: "review", label: "New head", loop: true },
  ],
};

function rejects(graph: TriggerPipeline, pattern: RegExp) {
  const result = TriggerPipelineSchema.safeParse(graph);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.message, pattern);
}

describe("authored pipeline contract", () => {
  it("requires a pipeline and rejects the removed diagram contract", () => {
    const manifest = {
      name: "test",
      runner: "local",
      on: [{ source: "manual", event: "run" }],
      grants: {},
      limits: { maxRuntime: "1h" },
    };
    assert.equal(TriggerManifestSchema.safeParse(manifest).success, false);
    assert.equal(
      TriggerManifestSchema.safeParse({ ...manifest, pipeline: testPipeline(), diagram: "old" })
        .success,
      false,
    );
    assert.equal(
      TriggerManifestSchema.safeParse({ ...manifest, pipeline: REVIEW_PIPELINE }).success,
      true,
    );
  });

  it("accepts labelled decisions, explicit loops, parallel forks and joins", async () => {
    assert.deepEqual(TriggerPipelineSchema.parse(REVIEW_PIPELINE), REVIEW_PIPELINE);
    const parallel = testPipeline("api", "web");
    parallel.nodes.push(
      {
        id: "fork",
        kind: "parallel",
        label: "Check services",
        description: "Start both health checks together.",
      },
      {
        id: "join",
        kind: "join",
        label: "Collect results",
        description: "Wait for both checks before returning.",
      },
    );
    parallel.edges = [
      { from: "event", to: "fork" },
      { from: "fork", to: "step-0", label: "API" },
      { from: "fork", to: "step-1", label: "Web" },
      { from: "step-0", to: "join" },
      { from: "step-1", to: "join" },
      { from: "join", to: "done" },
    ];
    assert.equal(TriggerPipelineSchema.safeParse(parallel).success, true);
    rejects(
      {
        ...parallel,
        edges: parallel.edges.filter((edge) => edge.from !== "fork" || edge.to !== "step-1"),
      },
      /parallel fork/u,
    );
    rejects(
      {
        ...parallel,
        edges: parallel.edges.filter((edge) => edge.to !== "join" || edge.from !== "step-1"),
      },
      /incoming lanes/u,
    );
    const layout = await layoutPipeline(parallel);
    assert.equal(layout.positions.get("step-0")?.x, layout.positions.get("step-1")?.x);
    assert.notEqual(layout.positions.get("step-0")?.y, layout.positions.get("step-1")?.y);
  });

  it("rejects dangling edges, duplicate identities, disconnected nodes and missing outcomes", () => {
    rejects(
      { ...REVIEW_PIPELINE, edges: [...REVIEW_PIPELINE.edges, { from: "missing", to: "done" }] },
      /existing nodes/u,
    );
    rejects(
      { ...REVIEW_PIPELINE, nodes: [...REVIEW_PIPELINE.nodes, REVIEW_PIPELINE.nodes[1]!] },
      /unique/u,
    );
    rejects(
      {
        ...REVIEW_PIPELINE,
        nodes: [
          ...REVIEW_PIPELINE.nodes,
          { id: "island", kind: "outcome", label: "Island", description: "Disconnected." },
        ],
      },
      /reachable/u,
    );
    rejects(
      {
        ...REVIEW_PIPELINE,
        nodes: REVIEW_PIPELINE.nodes.filter((node) => node.kind !== "outcome"),
      },
      /outcome/u,
    );
    rejects(
      { ...REVIEW_PIPELINE, edges: REVIEW_PIPELINE.edges.filter((edge) => edge.from !== "review") },
      /explicit outcome/u,
    );
  });

  it("rejects incomplete decisions, implicit cycles and invalid return edges", () => {
    rejects(
      {
        ...REVIEW_PIPELINE,
        edges: REVIEW_PIPELINE.edges.map((edge) =>
          edge.from === "ready" ? { from: edge.from, to: edge.to } : edge,
        ),
      },
      /distinct condition/u,
    );
    rejects(
      {
        ...REVIEW_PIPELINE,
        edges: REVIEW_PIPELINE.edges.map((edge) => (edge.loop ? { ...edge, loop: false } : edge)),
      },
      /Cycles/u,
    );
    rejects(
      {
        ...REVIEW_PIPELINE,
        edges: REVIEW_PIPELINE.edges.map((edge) => (edge.loop ? { ...edge, to: "done" } : edge)),
      },
      /ancestor/u,
    );
  });

  it("requires executable bindings and rejects overlapping or catch-all selectors", () => {
    rejects(
      {
        ...REVIEW_PIPELINE,
        nodes: REVIEW_PIPELINE.nodes.map((node) =>
          node.id === "repair" ? { ...node, operations: undefined } : node,
        ),
      },
      /bind/u,
    );
    rejects(
      {
        ...REVIEW_PIPELINE,
        nodes: REVIEW_PIPELINE.nodes.map((node) =>
          node.id === "repair" ? { ...node, operations: ["review:1"] } : node,
        ),
      },
      /overlap/u,
    );
    rejects(
      {
        ...REVIEW_PIPELINE,
        nodes: REVIEW_PIPELINE.nodes.map((node) =>
          node.id === "repair" ? { ...node, operations: ["*"] } : node,
        ),
      },
      /literal prefix/u,
    );
  });

  it("allows admission and final business actions to own progress while keeping support work explicit", () => {
    const definition = testPipeline("work");
    definition.nodes[0]!.operations = ["admit:*"];
    definition.nodes.at(-1)!.operations = ["publish"];
    definition.supportOperations = ["lock:*", "cleanup"];
    assert.equal(TriggerPipelineSchema.safeParse(definition).success, true);
    rejects({ ...definition, supportOperations: ["work"] }, /overlap/u);
    rejects({ ...definition, supportOperations: ["lock:*", "lock:1"] }, /overlap/u);
    rejects({ ...definition, supportOperations: ["*"] }, /literal prefix/u);
  });
});

const operation = (id: string, status: string) => ({
  id,
  kind: "agent",
  status,
  executionId: status === "waiting" ? "execution" : null,
});

describe("pipeline execution overlay", () => {
  it("tracks admission and final actions without promoting cleanup into business progress", () => {
    const definition = testPipeline("work");
    definition.nodes[0]!.operations = ["admit:*"];
    definition.nodes.at(-1)!.operations = ["publish"];
    definition.supportOperations = ["cleanup"];
    const cleanup = operation("cleanup", "completed");
    const supportOnly = pipelineRunStates(definition, [cleanup], "running");
    assert.deepEqual(supportOnly.unmapped, []);
    assert.equal(supportOnly.states.get("event")?.state, "unreached");
    assert.equal(supportOnly.states.get("done")?.state, "unreached");
    const pending = pipelineRunStates(
      definition,
      [
        cleanup,
        operation("admit:1", "completed"),
        operation("work", "completed"),
        operation("publish", "waiting"),
      ],
      "running",
    );
    assert.equal(pending.states.get("event")?.state, "complete");
    assert.equal(pending.states.get("done")?.state, "active");
    assert.equal(pending.states.get("done")?.operationId, "publish");
    const finished = pipelineRunStates(
      definition,
      [cleanup, operation("publish", "completed")],
      "succeeded",
    );
    assert.equal(finished.states.get("done")?.state, "complete");
    const ambiguous = pipelineRunStates(
      { ...definition, supportOperations: ["publish"] },
      [operation("publish", "completed")],
      "succeeded",
    );
    assert.deepEqual(ambiguous.unmapped, ["publish"]);
  });

  it("allows one core phase to own many low-level operations", () => {
    const definition = testPipeline("phase");
    const ids = Array.from({ length: 40 }, (_, index) => `check:${String(index)}`);
    definition.nodes[1]!.operations = ids;
    assert.equal(TriggerPipelineSchema.safeParse(definition).success, true);
    const progress = pipelineRunStates(
      definition,
      ids.map((id) => operation(id, "completed")),
      "succeeded",
    );
    assert.deepEqual(progress.unmapped, []);
    assert.equal(progress.states.get("step-0")?.detail, "Completed · 40 steps");
  });

  it("shows a core phase's progress across different bound operations", () => {
    const definition = structuredClone(REVIEW_PIPELINE);
    definition.nodes.find((node) => node.id === "review")!.operations = ["prepare", "review:*"];
    const prepare = { ...operation("prepare", "completed"), kind: "step" };
    const running = pipelineRunStates(
      definition,
      [prepare, operation("review:1", "waiting")],
      "running",
    );
    assert.equal(running.states.get("review")?.state, "active");
    assert.equal(running.states.get("review")?.operationId, "review:1");
    const completed = pipelineRunStates(
      definition,
      [prepare, operation("review:1", "completed")],
      "succeeded",
    );
    assert.equal(completed.states.get("review")?.state, "complete");
    assert.equal(completed.states.get("review")?.detail, "Completed · 2 steps");
    const failed = pipelineRunStates(
      definition,
      [prepare, operation("review:1", "failed")],
      "failed",
    );
    assert.equal(failed.states.get("review")?.state, "failed");
    assert.equal(failed.states.get("review")?.operationId, "review:1");
    assert.deepEqual(failed.unmapped, []);
  });

  it("preserves all declared nodes and edges, aggregates repeated calls and leaves untaken branches neutral", async () => {
    const definition = structuredClone(REVIEW_PIPELINE);
    const progress = pipelineRunStates(
      definition,
      [operation("review:1", "completed"), operation("review:2", "waiting")],
      "running",
    );
    assert.deepEqual(definition, REVIEW_PIPELINE);
    assert.deepEqual(progress.states.get("review"), {
      state: "active",
      detail: "Running · 2 steps",
      operationId: "review:2",
    });
    assert.deepEqual(progress.states.get("repair"), {
      state: "unreached",
      detail: "No recorded step",
    });
    assert.equal(progress.states.has("ready"), false);
    assert.equal(progress.states.has("done"), false);
    assert.deepEqual(await layoutPipeline(definition), await layoutPipeline(REVIEW_PIPELINE));
  });

  it("retains failure, cancellation and waiting facts and reports unbound operations", () => {
    const failed = pipelineRunStates(
      REVIEW_PIPELINE,
      [operation("review:1", "failed"), operation("unmapped", "completed")],
      "failed",
    );
    assert.equal(failed.states.get("review")?.state, "failed");
    assert.deepEqual(failed.unmapped, ["unmapped"]);
    const cancelled = pipelineRunStates(
      REVIEW_PIPELINE,
      [operation("review:1", "waiting")],
      "cancelled",
    );
    assert.equal(cancelled.states.get("review")?.detail, "Interrupted");
    const waiting = pipelineRunStates(
      REVIEW_PIPELINE,
      [{ ...operation("review:1", "waiting"), executionId: null }],
      "waiting",
    );
    assert.equal(waiting.states.get("review")?.state, "waiting");
  });

  it("does not assign an operation to either node if an invalid stored definition binds it twice", () => {
    const ambiguous = {
      ...REVIEW_PIPELINE,
      nodes: REVIEW_PIPELINE.nodes.map((node) =>
        node.id === "repair" ? { ...node, operations: ["review:*"] } : node,
      ),
    };
    const progress = pipelineRunStates(
      ambiguous,
      [operation("review:1", "completed")],
      "succeeded",
    );
    assert.deepEqual(progress.unmapped, ["review:1"]);
    assert.equal(progress.states.get("review")?.state, "unreached");
  });
});

describe("compact pipeline layout", () => {
  it("routes every workflow horizontally without reversing forward steps", async () => {
    const graph = testPipeline(
      ...Array.from({ length: 20 }, (_, index) => `operation:${String(index)}`),
    );
    graph.nodes.push({
      id: "failed",
      kind: "outcome",
      label: "Failed",
      description: "Preserve the failure reason.",
    });
    graph.edges = graph.edges.map((edge) => ({ ...edge, label: "Continue" }));
    for (let index = 0; index < 20; index++) {
      graph.edges.push({ from: `step-${String(index)}`, to: "failed", label: "Failed" });
      if (index > 0)
        graph.edges.push({
          from: `step-${String(index)}`,
          to: "step-0",
          label: "Retry",
          loop: true,
        });
    }
    assert.equal(TriggerPipelineSchema.safeParse(graph).success, true);
    const layout = await layoutPipeline(graph);
    assert.equal(layout.nodeHeight, 44);
    assert.equal(layout.direction, "RIGHT");
    for (const edge of graph.edges.filter((candidate) => !candidate.loop)) {
      assert.ok(layout.positions.get(edge.to)!.x > layout.positions.get(edge.from)!.x);
    }
    assert.equal(layout.edges.length, graph.edges.length);
    assert.deepEqual(await layoutPipeline(structuredClone(graph)), layout);
  });
});
