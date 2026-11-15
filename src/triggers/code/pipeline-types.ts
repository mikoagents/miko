/** Authored documentation of control flow. Execution is always controlled by run(ctx). */
export interface TriggerPipeline {
  nodes: TriggerPipelineNode[];
  edges: TriggerPipelineEdge[];
  /** Explicit housekeeping IDs, retained in diagnostics without adding nodes or driving phase progress. */
  supportOperations?: string[] | undefined;
}

export interface TriggerPipelineNode {
  /** Stable identity, independent of display text and operation IDs. */
  id: string;
  kind: "event" | "step" | "agent" | "wait" | "decision" | "parallel" | "join" | "outcome";
  label: string;
  description: string;
  /** Explicit durable operation IDs. A trailing * matches an operation prefix; use it for loop iterations. */
  operations?: string[] | undefined;
}

export interface TriggerPipelineEdge {
  from: string;
  to: string;
  /** Required on every branch leaving a node with multiple exits. */
  label?: string | undefined;
  /** Explicit return to an earlier node. Removing these edges must leave an acyclic graph. */
  loop?: boolean | undefined;
}
