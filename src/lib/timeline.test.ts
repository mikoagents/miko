import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { timelinePosition, timelineScale, type TimelineSpan } from "./timeline.js";

const MINUTE = 60_000;

function span(from: number, to: number, tone: TimelineSpan["tone"] = "complete"): TimelineSpan {
  return { from: from * MINUTE, to: to * MINUTE, tone };
}

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${String(actual)} is not ${String(expected)}`);
}

describe("timeline scale", () => {
  it("places instants along one clock and ticks it at round times", () => {
    const scale = timelineScale(0, 40 * MINUTE, [span(0, 10), span(5, 40)]);
    assert.deepEqual(scale.folds, []);
    close(timelinePosition(scale, 0), 0);
    close(timelinePosition(scale, 10 * MINUTE), 0.25);
    close(timelinePosition(scale, 40 * MINUTE), 1);
    assert.deepEqual(
      scale.ticks.map((tick) => tick.elapsed / MINUTE),
      [10, 20, 30],
    );
  });

  it("folds a long stretch in which only a wait was open", () => {
    const scale = timelineScale(0, 100 * MINUTE, [
      span(0, 10),
      span(10, 90, "waiting"),
      span(90, 100),
    ]);
    assert.equal(scale.folds.length, 1);
    const [fold] = scale.folds;
    assert.ok(fold);
    // The fold keeps a sliver of the wait on each side, so the bars around it keep their ends.
    assert.deepEqual([fold.from / MINUTE, fold.to / MINUTE], [11, 89]);
    close(fold.width, 0.08);
    // What is left keeps its length: 22 minutes over the 92% of the track the fold leaves.
    close(timelinePosition(scale, 11 * MINUTE), (11 / 22) * 0.92);
    close(timelinePosition(scale, 50 * MINUTE), fold.offset + 0.04);
    close(timelinePosition(scale, 100 * MINUTE), 1);
    assert.ok(
      scale.ticks.every((tick) => tick.elapsed <= 11 * MINUTE || tick.elapsed >= 89 * MINUTE),
    );
  });

  it("keeps a run that only waited at its own length", () => {
    const scale = timelineScale(0, 30 * MINUTE, [span(0, 30, "waiting")]);
    assert.deepEqual(scale.folds, []);
    close(timelinePosition(scale, 15 * MINUTE), 0.5);
  });

  it("leaves short gaps alone, however long they are against the run", () => {
    const scale = timelineScale(0, MINUTE, [span(0, 0.05), span(0.95, 1)]);
    assert.deepEqual(scale.folds, []);
  });

  it("widens to cover a span outside the run and draws an empty run at its start", () => {
    const scale = timelineScale(5 * MINUTE, 5 * MINUTE, [span(2, 8)]);
    assert.deepEqual([scale.start, scale.end], [2 * MINUTE, 8 * MINUTE]);
    const empty = timelineScale(0, 0, []);
    close(timelinePosition(empty, 0), 0);
    assert.deepEqual(empty.ticks, []);
  });
});
