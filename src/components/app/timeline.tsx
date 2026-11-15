import { useMemo, type ReactNode } from "react";

import { formatDuration } from "../../lib/duration.js";
import {
  timelinePosition,
  type TimelineFold,
  type TimelineScale,
  type TimelineSpan,
  type TimelineTone,
} from "../../lib/timeline.js";
import { cn } from "../../lib/utils.js";

/*
 * A waterfall on one clock: the axis sits in a table column's header and each row draws its own
 * track under it, so the bars line up with the ticks and with each other. Solid bars worked,
 * dashed bars waited, striped bars are still going, and a hatched band is a long stretch of
 * waiting drawn narrower than its length.
 */

const TONE_STYLES: Record<TimelineTone, string> = {
  complete: "bg-success/70",
  failed: "bg-danger",
  running: "timeline-running",
  waiting: "border border-dashed border-muted-foreground",
};

const TONE_LABELS: Record<TimelineTone, string> = {
  complete: "Completed",
  running: "Running",
  waiting: "Waiting",
  failed: "Failed",
};

const LEGEND_ORDER: readonly TimelineTone[] = ["complete", "running", "waiting", "failed"];

/** The time axis over a timeline column: time since the start, and how long each fold is. */
export function TimelineAxis({ scale }: { scale: TimelineScale }) {
  return (
    <span aria-hidden="true" className="relative block h-9 min-w-48 text-extra-muted-foreground">
      {scale.folds.map((fold) => (
        <Fold key={fold.from} fold={fold} labelled />
      ))}
      <Placed offset={0} className="absolute top-1/2 -translate-y-1/2">
        0
      </Placed>
      {scale.ticks.map((tick) => (
        <Placed
          key={tick.elapsed}
          offset={tick.offset}
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
        >
          {formatDuration(tick.elapsed)}
        </Placed>
      ))}
    </span>
  );
}

/**
 * One row's bars under a `TimelineAxis`. `compact` is the thin line a phone draws under a
 * record when there is no room for the column: no grid, the same clock.
 */
export function TimelineTrack({
  scale,
  spans,
  compact = false,
}: {
  scale: TimelineScale;
  spans: readonly TimelineSpan[];
  compact?: boolean;
}) {
  return (
    <span aria-hidden="true" className={cn("relative block", compact ? "h-1" : "h-11 min-w-48")}>
      {compact
        ? null
        : scale.ticks.map((tick) => (
            <Placed
              key={tick.elapsed}
              offset={tick.offset}
              className="absolute inset-y-0 w-px bg-border"
            />
          ))}
      {scale.folds.map((fold) => (
        <Fold key={fold.from} fold={fold} />
      ))}
      {spans.map((span) => (
        <Bar
          key={`${String(span.from)}:${span.tone}`}
          scale={scale}
          span={span}
          compact={compact}
        />
      ))}
    </span>
  );
}

/** What each kind of bar means, for the kinds a timeline draws, and whether it folded time. */
export function TimelineLegend({
  tones,
  folded,
}: {
  tones: readonly TimelineTone[];
  folded: boolean;
}) {
  return (
    <ul
      aria-label="Timeline legend"
      className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
    >
      {LEGEND_ORDER.filter((tone) => tones.includes(tone)).map((tone) => (
        <li key={tone} className="inline-flex items-center gap-1.5">
          <TimelineMark tone={tone} />
          {TONE_LABELS[tone]}
        </li>
      ))}
      {folded ? (
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="timeline-fold block h-1.5 w-4 rounded-sm border" />
          Waiting time folded
        </li>
      ) : null}
    </ul>
  );
}

/**
 * One tone's mark, the size of a legend swatch: what the legend explains, and what a pipeline
 * strip in a table cell is drawn from. A titled mark names what it stands for on hover.
 */
export function TimelineMark({ tone, title }: { tone: TimelineTone; title?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block h-1.5 w-4 shrink-0 rounded-sm", TONE_STYLES[tone])}
      title={title}
    />
  );
}

function Bar({
  scale,
  span,
  compact,
}: {
  scale: TimelineScale;
  span: TimelineSpan;
  compact: boolean;
}) {
  const offset = timelinePosition(scale, span.from);
  return (
    <Placed
      offset={offset}
      width={timelinePosition(scale, span.to) - offset}
      className={cn(
        "absolute top-1/2 min-w-0.5 -translate-y-1/2 rounded-sm",
        compact ? "h-1" : "h-2",
        TONE_STYLES[span.tone],
      )}
    />
  );
}

function Fold({ fold, labelled = false }: { fold: TimelineFold; labelled?: boolean }) {
  const length = formatDuration(fold.to - fold.from);
  return (
    <Placed
      offset={fold.offset}
      width={fold.width}
      className="timeline-fold absolute inset-y-0 flex items-center justify-center"
      {...(labelled ? { title: `${length} folded: only waits were open` } : {})}
    >
      {labelled ? <span className="bg-card px-0.5 whitespace-nowrap">{length}</span> : null}
    </Placed>
  );
}

/** Something drawn at a place along the track, and as wide as a share of it. */
function Placed({
  offset,
  width,
  className,
  title,
  children,
}: {
  offset: number;
  width?: number;
  className: string;
  title?: string;
  children?: ReactNode;
}) {
  const style = useMemo(
    () => ({
      left: percent(offset),
      ...(width === undefined ? {} : { width: percent(width) }),
    }),
    [offset, width],
  );
  return (
    <span className={className} style={style} title={title}>
      {children}
    </span>
  );
}

function percent(share: number): string {
  return `${(share * 100).toFixed(3)}%`;
}
