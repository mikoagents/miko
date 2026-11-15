import type { ELK, ElkNode, ElkPoint } from "elkjs/lib/elk-api.js";
import type { TriggerPipeline, TriggerPipelineEdge } from "../triggers/code/pipeline-types.js";

export type PipelineState = "complete" | "failed" | "active" | "waiting" | "unreached";
export interface PipelineNodeRun {
  state: PipelineState;
  detail: string;
  /** Only recorded operations can open step diagnostics. */
  operationId?: string;
}

export interface PipelineLabel {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}
export interface PipelineLayout {
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
  direction: "RIGHT";
  positions: Map<string, ElkPoint & { width: number; height: number }>;
  edges: (TriggerPipelineEdge & { path: string; points: ElkPoint[]; labelBox?: PipelineLabel })[];
}

const NODE_WIDTH = 176;
const NODE_HEIGHT = 44;
const cache = new Map<string, Promise<PipelineLayout>>();
let engine: Promise<ELK> | undefined;

/** Topology alone determines placement, ports, routes and reserved label space. */
export function layoutPipeline(graph: TriggerPipeline): Promise<PipelineLayout> {
  const key = JSON.stringify({
    nodes: graph.nodes.map(({ id, kind, label }) => ({ id, kind, label })),
    edges: graph.edges,
  });
  const existing = cache.get(key);
  if (existing) return existing;
  const result = arrange(graph).catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, result);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return result;
}

async function arrange(graph: TriggerPipeline): Promise<PipelineLayout> {
  engine ??= import("elkjs/lib/elk.bundled.js")
    .then((module) => {
      const candidate: unknown = module.default;
      if (isElkConstructor(candidate)) return new candidate();
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        "default" in candidate &&
        isElkConstructor(candidate.default)
      )
        return new candidate.default();
      throw new Error("Pipeline layout engine is unavailable");
    })
    .catch((error: unknown) => {
      engine = undefined;
      throw error;
    });
  const elk = await engine;
  const direction = "RIGHT";
  const labels = graph.edges.map((edge) =>
    edge.label === undefined ? undefined : wrapLabel(edge.label),
  );
  const input: ElkNode = {
    id: "pipeline",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
      "elk.spacing.nodeNode": "16",
      "elk.spacing.edgeNode": "8",
      "elk.spacing.edgeEdge": "6",
      "elk.layered.spacing.nodeNodeBetweenLayers": "20",
      "elk.layered.spacing.edgeNodeBetweenLayers": "8",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
      "elk.layered.feedbackEdges": "true",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.favorStraightEdges": "true",
      "elk.randomSeed": "1",
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: Math.min(NODE_WIDTH, Math.max(104, Math.ceil((textWidth(node.label) + 40) / 4) * 4)),
      height: NODE_HEIGHT,
      ...(node.kind === "event"
        ? { layoutOptions: { "elk.layered.layering.layerConstraint": "FIRST" } }
        : {}),
    })),
    edges: graph.edges.map((edge, index) => ({
      id: String(index),
      sources: [edge.from],
      targets: [edge.to],
      // Only authored loop returns may run against the flow direction.
      layoutOptions: { "elk.layered.priority.direction": edge.loop ? "0" : "100" },
      labels: labels[index] ? [labels[index]] : [],
    })),
  };
  const result = await elk.layout(input);
  const positions = new Map(
    result.children?.map((node) => [
      node.id,
      {
        x: node.x ?? 0,
        y: node.y ?? 0,
        width: node.width ?? NODE_WIDTH,
        height: NODE_HEIGHT,
      },
    ]),
  );
  const edges = graph.edges.map((edge, index) => {
    const routed = result.edges?.find((entry) => entry.id === String(index));
    const section = routed?.sections?.[0];
    if (!section) throw new Error("Pipeline edge has no route");
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    const label = routed.labels?.[0];
    const measured = labels[index];
    return {
      ...edge,
      path: roundedPath(points),
      points,
      ...(label && measured
        ? {
            labelBox: {
              x: label.x ?? 0,
              y: label.y ?? 0,
              width: measured.width,
              height: measured.height,
              text: measured.text,
            },
          }
        : {}),
    };
  });
  return {
    width: result.width ?? NODE_WIDTH,
    height: result.height ?? NODE_HEIGHT,
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
    direction,
    positions,
    edges,
  };
}

function isElkConstructor(value: unknown): value is new () => ELK {
  if (typeof value !== "function") return false;
  const prototype: unknown = Reflect.get(value, "prototype");
  return (
    typeof prototype === "object" &&
    prototype !== null &&
    "layout" in prototype &&
    typeof prototype.layout === "function"
  );
}

/** Reserve every line before routing; condition text never shares a node's space. */
function wrapLabel(text: string) {
  const lines: string[] = [];
  let line = "";
  let width = 0;
  let widest = 0;
  for (const character of text) {
    const advance = textWidth(character);
    if (character === "\n" || (width + advance > 120 && line.length > 0)) {
      lines.push(line.trim());
      widest = Math.max(widest, width);
      line = "";
      width = 0;
    }
    if (character === "\n") continue;
    line += character;
    width += advance;
  }
  lines.push(line.trim());
  return {
    text: lines.join("\n"),
    width: Math.ceil(Math.max(widest, width)) + 12,
    height: lines.length * 16 + 8,
  };
}

function textWidth(text: string) {
  let width = 0;
  for (const character of text) width += character.codePointAt(0)! > 255 ? 12 : 7.5;
  return width;
}

/** Preserve orthogonal routes while softening corners, without drawing through nodes. */
function roundedPath(points: ElkPoint[]) {
  const first = points[0]!;
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    const next = points[index + 1]!;
    const before = Math.hypot(point.x - previous.x, point.y - previous.y);
    const after = Math.hypot(next.x - point.x, next.y - point.y);
    const radius = Math.min(6, before / 2, after / 2);
    if (before === 0 || after === 0) continue;
    const x1 = point.x + ((previous.x - point.x) * radius) / before;
    const y1 = point.y + ((previous.y - point.y) * radius) / before;
    const x2 = point.x + ((next.x - point.x) * radius) / after;
    const y2 = point.y + ((next.y - point.y) * radius) / after;
    path += ` L ${x1} ${y1} Q ${point.x} ${point.y} ${x2} ${y2}`;
  }
  const last = points.at(-1)!;
  return `${path} L ${last.x} ${last.y}`;
}
