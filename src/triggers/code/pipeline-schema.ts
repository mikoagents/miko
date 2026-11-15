import { z } from "zod";

const id = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/u)
  .max(100);
const text = z.string().trim().min(1);
const operationSelector = text
  .max(200)
  .regex(/^[^*]+\*?$/u, "Use an exact operation ID or a literal prefix followed by *");

/** Validate authored topology at build/deploy time, before either UI can render it. */
export const TriggerPipelineSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            id,
            kind: z.enum([
              "event",
              "step",
              "agent",
              "wait",
              "decision",
              "parallel",
              "join",
              "outcome",
            ]),
            label: text.max(120),
            description: text.max(1000),
            operations: z.array(operationSelector).min(1).max(100).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(100),
    edges: z
      .array(
        z
          .object({
            from: id,
            to: id,
            label: text.max(120).optional(),
            loop: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(300),
    supportOperations: z.array(operationSelector).max(100).optional(),
  })
  .strict()
  .superRefine((graph, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const patterns = new Set<string>();
    const bind = (pattern: string, path: (string | number)[]) => {
      if (
        [...patterns].some(
          (other) =>
            other === pattern ||
            (other.endsWith("*") && pattern.startsWith(other.slice(0, -1))) ||
            (pattern.endsWith("*") && other.startsWith(pattern.slice(0, -1))),
        )
      )
        issue(path, "Operation selectors must not overlap; every operation needs one binding");
      patterns.add(pattern);
    };
    graph.supportOperations?.forEach((pattern, index) =>
      bind(pattern, ["supportOperations", index]),
    );
    graph.nodes.forEach((node, index) => {
      if (graph.nodes.findIndex((other) => other.id === node.id) !== index)
        issue(["nodes", index, "id"], "Pipeline node IDs must be unique");
      if (["step", "agent", "wait"].includes(node.kind) && node.operations === undefined)
        issue(
          ["nodes", index, "operations"],
          "Executable nodes must bind their durable operation IDs",
        );
      for (const pattern of node.operations ?? []) bind(pattern, ["nodes", index, "operations"]);
    });
    graph.nodes.forEach((node, index) => {
      const exits = graph.edges.filter((edge) => edge.from === node.id);
      if (node.kind === "outcome" && exits.length > 0)
        issue(["nodes", index], "An outcome cannot have outgoing edges");
      if (node.kind !== "outcome" && exits.length === 0)
        issue(["nodes", index], "Every path must lead to an explicit outcome");
      if (node.kind === "decision" && exits.length < 2)
        issue(["nodes", index], "A decision must describe at least two branches");
      if (node.kind === "parallel" && exits.length < 2)
        issue(["nodes", index], "A parallel fork must describe at least two lanes");
      if (
        node.kind === "join" &&
        graph.edges.filter((edge) => edge.to === node.id && !edge.loop).length < 2
      )
        issue(["nodes", index], "A join must have at least two incoming lanes");
      if (
        exits.length > 1 &&
        (exits.some((edge) => edge.label === undefined) ||
          new Set(exits.map((edge) => edge.label)).size !== exits.length)
      )
        issue(
          ["nodes", index],
          "Every outgoing branch needs a distinct condition or parallel lane label",
        );
    });
    const events = graph.nodes.filter((node) => node.kind === "event");
    if (events.length !== 1) issue(["nodes"], "A pipeline must have exactly one event entry node");
    if (!graph.nodes.some((node) => node.kind === "outcome"))
      issue(["nodes"], "A pipeline must have an outcome");
    const pairs = new Set<string>();
    graph.edges.forEach((edge, index) => {
      if (!nodes.has(edge.from) || !nodes.has(edge.to))
        issue(["edges", index], "Pipeline edges must reference existing nodes");
      if (nodes.get(edge.to)?.kind === "event")
        issue(["edges", index, "to"], "The event entry cannot have incoming edges");
      const pair = `${edge.from}:${edge.to}`;
      if (pairs.has(pair)) issue(["edges", index], "Duplicate pipeline edge");
      pairs.add(pair);
      if (edge.loop && edge.label === undefined)
        issue(["edges", index, "label"], "A loop must explain when it repeats");
    });
    const reachable = (start: string, reverse = false, forwardOnly = false) => {
      const seen = new Set<string>();
      const visit = (current: string) => {
        if (seen.has(current)) return;
        seen.add(current);
        for (const edge of graph.edges) {
          if (forwardOnly && edge.loop) continue;
          if ((reverse ? edge.to : edge.from) === current) visit(reverse ? edge.from : edge.to);
        }
      };
      visit(start);
      return seen;
    };
    const entry = events[0];
    if (entry) {
      const connected = reachable(entry.id, false, true);
      graph.nodes.forEach((node, index) => {
        if (!connected.has(node.id))
          issue(
            ["nodes", index],
            "Every node must be reachable from the event without taking a loop",
          );
      });
    }
    const canEnd = new Set<string>();
    for (const node of graph.nodes.filter((item) => item.kind === "outcome")) {
      for (const ancestor of reachable(node.id, true)) canEnd.add(ancestor);
    }
    graph.nodes.forEach((node, index) => {
      if (!canEnd.has(node.id))
        issue(["nodes", index], "Every node must have a path to an outcome");
    });
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (current: string): boolean => {
      if (visiting.has(current)) return false;
      if (visited.has(current)) return true;
      visiting.add(current);
      for (const edge of graph.edges.filter(
        (candidate) => candidate.from === current && !candidate.loop,
      )) {
        if (!visit(edge.to)) return false;
      }
      visiting.delete(current);
      visited.add(current);
      return true;
    };
    if (!graph.nodes.every((node) => visit(node.id)))
      issue(["edges"], "Cycles must mark their return edge with loop: true");
    graph.edges.forEach((edge, index) => {
      if (edge.loop && !reachable(edge.to, false, true).has(edge.from))
        issue(["edges", index], "A loop must return to an ancestor on a forward path");
    });
  });
