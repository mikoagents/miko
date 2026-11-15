import type { PipelineNodeRun } from "../../lib/pipeline.js";
import type { TriggerPipeline } from "./pipeline-types.js";
import { operationState, type RunOperation } from "./run-presentation.js";

/** Overlay facts on authored nodes. Never infer a decision or a taken edge from timestamps. */
export function pipelineRunStates(
  definition: TriggerPipeline,
  operations: readonly Pick<RunOperation, "id" | "kind" | "status" | "executionId">[],
  parentStatus: string,
) {
  const states = new Map<string, PipelineNodeRun>();
  const bindings = new Map<
    string,
    Pick<RunOperation, "id" | "kind" | "status" | "executionId">[]
  >();
  const unmapped: string[] = [];
  for (const operation of operations) {
    const owners = definition.nodes.filter((node) =>
      node.operations?.some((pattern) => matches(operation.id, pattern)),
    );
    const support = definition.supportOperations?.some((pattern) => matches(operation.id, pattern));
    if (support && owners.length === 0) continue;
    const owner = owners.length === 1 && !support ? owners[0] : undefined;
    if (!owner) {
      unmapped.push(operation.id);
      continue;
    }
    const group = bindings.get(owner.id) ?? [];
    group.push(operation);
    bindings.set(owner.id, group);
  }
  for (const node of definition.nodes) {
    if (node.kind === "event" && node.operations === undefined) {
      states.set(node.id, { state: "complete", detail: "Received" });
      continue;
    }
    if (node.operations === undefined) continue;
    states.set(node.id, boundState(bindings.get(node.id) ?? [], parentStatus));
  }
  return { states, unmapped };
}

function matches(operationId: string, pattern: string) {
  return pattern.endsWith("*")
    ? operationId.startsWith(pattern.slice(0, -1))
    : operationId === pattern;
}

type Operation = Pick<RunOperation, "id" | "kind" | "status" | "executionId">;

function boundState(bound: readonly Operation[], parentStatus: string): PipelineNodeRun {
  if (bound.length === 0) return { state: "unreached", detail: "No recorded step" };
  const priorities = [
    { matches: ["running"], state: "active", label: "Running" },
    { matches: ["waiting"], state: "waiting", label: "Waiting" },
    { matches: ["failed", "timed_out"], state: "failed", label: "Failed" },
    { matches: ["cancelled", "skipped"], state: "unreached", label: "Interrupted" },
    { matches: ["completed"], state: "complete", label: "Completed" },
  ] as const;
  for (const priority of priorities) {
    const operation = bound.findLast((entry) =>
      priority.matches.some((match) => match === operationState(entry, parentStatus)),
    );
    if (operation)
      return {
        state: priority.state,
        detail:
          bound.length === 1 ? priority.label : `${priority.label} · ${String(bound.length)} steps`,
        operationId: operation.id,
      };
  }
  return { state: "unreached", detail: "Unknown status" };
}
