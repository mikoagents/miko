import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../ui/tooltip.js";
import { describe, it } from "vitest";
import { PipelineDrawing, PipelineStrip, type PipelineNodeRun } from "./pipeline.js";

import { testPipeline } from "../../test-utils/pipeline.js";
import type { TriggerPipeline } from "../../triggers/code/sdk.js";
import { layoutPipeline } from "../../lib/pipeline.js";

const graph: TriggerPipeline = testPipeline("review", "ci");
const waitNode = graph.nodes[2];
assert.ok(waitNode);
waitNode.kind = "wait";
graph.edges.push({ from: "step-1", to: "step-0", label: "Retry", loop: true });
const states = new Map<string, PipelineNodeRun>([
  ["step-0", { state: "complete", detail: "Completed", operationId: "review" }],
]);
function select() {}

describe("pipeline", () => {
  it("reserves space for complete condition labels without overlapping nodes", async () => {
    const branching = testPipeline("review", "ci");
    branching.edges.push({ from: "event", to: "done", label: "Skip this candidate" });
    const layout = await layoutPipeline(branching);
    for (const edge of layout.edges.filter((candidate) => candidate.label !== undefined)) {
      const box = edge.labelBox!;
      assert.ok(box.x >= 0 && box.y >= 0);
      assert.ok(box.x + box.width <= layout.width);
      assert.ok(box.y + box.height <= layout.height);
      for (const point of layout.positions.values()) {
        assert.ok(
          box.x + box.width <= point.x ||
            box.x >= point.x + point.width ||
            box.y + box.height <= point.y ||
            box.y >= point.y + layout.nodeHeight,
          "a condition must not obscure a node",
        );
      }
    }
  });

  it("uses identical authored topology with and without execution progress", async () => {
    const layout = await layoutPipeline(graph);
    const trigger = renderToStaticMarkup(
      <TooltipProvider>
        <PipelineDrawing layout={layout} definition={graph} />
      </TooltipProvider>,
    );
    const activity = renderToStaticMarkup(
      <TooltipProvider>
        <PipelineDrawing layout={layout} definition={graph} states={states} onSelect={select} />
      </TooltipProvider>,
    );
    for (const markup of [trigger, activity]) {
      assert.equal(markup.match(/data-pipeline-node=/gu)?.length, 4);
      assert.equal(markup.match(/data-pipeline-edge=/gu)?.length, 4);
      assert.match(markup, /review → ci/u);
      assert.match(markup, /ci → review: Retry \(loop\)/u);
      assert.match(markup, /border-dashed/u);
    }
    assert.match(activity, /Completed/u);
    assert.doesNotMatch(trigger, /Completed/u);
    // Only a recorded node opens diagnostics.
    assert.equal(activity.match(/<button/gu)?.length, 1);
    assert.equal(trigger.match(/<button/gu)?.length ?? 0, 0);
  });

  it("escapes authored text instead of interpreting markup or external resources", async () => {
    const malicious = testPipeline();
    const eventNode = malicious.nodes[0];
    assert.ok(eventNode);
    eventNode.label = "<img src=x onerror=alert(1)>";
    const layout = await layoutPipeline(malicious);
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <PipelineDrawing layout={layout} definition={malicious} />
      </TooltipProvider>,
    );
    assert.match(markup, /&lt;img/u);
    assert.doesNotMatch(markup, /<img|<script|foreignObject|dangerouslySetInnerHTML/u);
  });
});

describe("pipeline strip", () => {
  it("draws a mark per node, stacked by stage, and counts the stages it has no room for", () => {
    const stages = Array.from({ length: 12 }, (_, index) => ({
      key: `stage-${String(index)}`,
      marks: [
        { key: `mark-${String(index)}`, tone: "complete" as const, label: `step ${String(index)}` },
      ],
    }));
    const markup = renderToStaticMarkup(<PipelineStrip label="12 stages" stages={stages} />);
    assert.match(markup, /role="img" aria-label="12 stages"/u);
    assert.equal(markup.match(/title="step /gu)?.length, 10);
    assert.match(markup, />\+2<\/span>/u);
  });
});
