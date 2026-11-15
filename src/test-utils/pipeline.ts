import type { TriggerPipeline } from "../triggers/code/pipeline-types.js";

/** A complete linear graph for test programs; flow-specific tests supply their own branches. */
export function testPipeline(...operations: string[]): TriggerPipeline {
  return {
    nodes: [
      {
        id: "event",
        kind: "event",
        label: "Incoming event",
        description: "Receive the test invocation.",
      },
      ...operations.map((operation, index) => ({
        id: `step-${String(index)}`,
        kind: "step" as const,
        label: operation,
        description: `Execute ${operation}.`,
        operations: [operation],
      })),
      {
        id: "done",
        kind: "outcome",
        label: "Result saved",
        description: "Return the test result.",
      },
    ],
    edges:
      operations.length === 0
        ? [{ from: "event", to: "done" }]
        : [
            { from: "event", to: "step-0" },
            ...operations.map((_, index) => ({
              from: `step-${String(index)}`,
              to: index === operations.length - 1 ? "done" : `step-${String(index + 1)}`,
            })),
          ],
  };
}
