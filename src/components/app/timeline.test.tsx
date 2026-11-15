import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { timelineScale, type TimelineSpan } from "../../lib/timeline.js";
import { TimelineAxis, TimelineLegend, TimelineTrack } from "./timeline.js";

const MINUTE = 60_000;
const SPANS: readonly TimelineSpan[] = [
  { from: 0, to: 10 * MINUTE, tone: "complete" },
  { from: 10 * MINUTE, to: 90 * MINUTE, tone: "waiting" },
  { from: 90 * MINUTE, to: 100 * MINUTE, tone: "running" },
];
const SCALE = timelineScale(0, 100 * MINUTE, SPANS);
const DRAWN = ["waiting", "complete"] as const;

describe("timeline", () => {
  it("labels the start, round times, and how long a fold hides", () => {
    const markup = renderToStaticMarkup(<TimelineAxis scale={SCALE} />);
    assert.match(markup, /aria-hidden="true"/u);
    assert.match(markup, />0<\/span>/u);
    assert.match(markup, />5m<\/span>/u);
    assert.match(markup, /title="1h 18m folded: only waits were open"/u);
  });

  it("draws each span where the axis puts it, and a phone's line without the grid", () => {
    const track = renderToStaticMarkup(<TimelineTrack scale={SCALE} spans={SPANS} />);
    assert.equal(track.match(/rounded-sm/gu)?.length, 3);
    assert.match(track, /bg-success\/70[^"]*" style="left:0\.000%;width:41\.818%"/u);
    assert.match(track, /timeline-running/u);
    assert.match(track, /w-px bg-border/u);
    const compact = renderToStaticMarkup(<TimelineTrack scale={SCALE} spans={SPANS} compact />);
    assert.doesNotMatch(compact, /w-px bg-border/u);
    assert.match(compact, /timeline-fold/u);
  });

  it("explains only the kinds of bar it drew", () => {
    const markup = renderToStaticMarkup(<TimelineLegend tones={DRAWN} folded />);
    assert.deepEqual(
      [...markup.matchAll(/<li[^>]*>(?:<span[^>]*><\/span>)?([^<]+)<\/li>/gu)].map(
        (match) => match[1],
      ),
      ["Completed", "Waiting", "Waiting time folded"],
    );
  });
});
