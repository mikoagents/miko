/**
 * Where an instant falls along a timeline. One clock for every row, so bars that overlap ran at
 * the same time; and a long stretch in which nothing worked — a CI run, a timer, a queue — is
 * folded down to a band of its own, so the seconds of work on either side of it stay readable.
 */

/** How a stretch of time is drawn: work that ended well or badly, work still going, or a wait. */
export type TimelineTone = "complete" | "failed" | "running" | "waiting";

/** A stretch of time, in epoch milliseconds. */
export interface TimelineSpan {
  from: number;
  to: number;
  tone: TimelineTone;
}

/** A stretch in which only waits were open, drawn narrower than its length. */
export interface TimelineFold {
  from: number;
  to: number;
  /** Where the fold starts along the track, from 0 to 1. */
  offset: number;
  /** How much of the track the fold takes. */
  width: number;
}

/** A mark on the axis, at a round time since the start. */
export interface TimelineTick {
  elapsed: number;
  offset: number;
}

export interface TimelineScale {
  start: number;
  end: number;
  /** Track per millisecond outside the folds. */
  rate: number;
  folds: readonly TimelineFold[];
  ticks: readonly TimelineTick[];
}

const FOLD_WIDTH = 0.08;
const MAX_FOLDS = 3;
/** A gap folds only when it is long in itself and long against the whole run. */
const MIN_FOLD = 60_000;
const MIN_FOLD_SHARE = 0.2;
/** What a fold leaves of its gap on each side, so the bars around it keep their ends. */
const FOLD_MARGIN_SHARE = 0.01;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TICK_STEPS = [
  SECOND,
  2 * SECOND,
  5 * SECOND,
  10 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
];
const MAX_TICKS = 5;
/** How close two labels on the axis may sit, as a share of the track. */
const TICK_CLEARANCE = 0.08;
/** The last label stays this far from the end, where it would be cut. */
const TICK_END = 0.94;

/** A scale for these spans between these instants, widened to cover every span. */
export function timelineScale(
  start: number,
  end: number,
  spans: readonly TimelineSpan[],
): TimelineScale {
  const from = Math.min(start, ...spans.map((span) => span.from));
  const to = Math.max(end, from, ...spans.map((span) => span.to));
  const gaps = foldedGaps(from, to, spans);
  const linear = to - from - gaps.reduce((total, gap) => total + gap.to - gap.from, 0);
  const rate = linear > 0 ? (1 - FOLD_WIDTH * gaps.length) / linear : 0;
  const scale: TimelineScale = { start: from, end: to, rate, folds: [], ticks: [] };
  const folds: TimelineFold[] = [];
  for (const gap of gaps) {
    folds.push({
      ...gap,
      offset: timelinePosition({ ...scale, folds }, gap.from),
      width: FOLD_WIDTH,
    });
  }
  const placed = { ...scale, folds };
  return { ...placed, ticks: ticks(placed, linear) };
}

/** Where an instant falls along the track, from 0 at the start to 1 at the end. */
export function timelinePosition(scale: TimelineScale, time: number): number {
  let offset = 0;
  let cursor = scale.start;
  for (const fold of scale.folds) {
    if (time <= fold.from) return clamp(offset + (time - cursor) * scale.rate);
    offset += (fold.from - cursor) * scale.rate;
    if (time < fold.to)
      return clamp(offset + ((time - fold.from) / (fold.to - fold.from)) * fold.width);
    offset += fold.width;
    cursor = fold.to;
  }
  return clamp(offset + (time - cursor) * scale.rate);
}

/**
 * The longest stretches in which nothing but waits were open. A run with no work at all is one
 * long wait, and folding all of it would leave nothing to read, so it keeps its own length.
 */
function foldedGaps(start: number, end: number, spans: readonly TimelineSpan[]) {
  const total = end - start;
  const work = spans
    .filter((span) => span.tone !== "waiting" && span.to > span.from)
    .toSorted((left, right) => left.from - right.from);
  if (work.length === 0) return [];
  const gaps: { from: number; to: number }[] = [];
  let cursor = start;
  for (const span of work) {
    if (span.from > cursor) gaps.push({ from: cursor, to: span.from });
    cursor = Math.max(cursor, span.to);
  }
  if (end > cursor) gaps.push({ from: cursor, to: end });
  const margin = total * FOLD_MARGIN_SHARE;
  const minimum = Math.max(MIN_FOLD, total * MIN_FOLD_SHARE);
  return gaps
    .filter((gap) => gap.to - gap.from >= minimum)
    .toSorted((left, right) => right.to - right.from - (left.to - left.from))
    .slice(0, MAX_FOLDS)
    .map((gap) => ({ from: gap.from + margin, to: gap.to - margin }))
    .toSorted((left, right) => left.from - right.from);
}

/**
 * Round times since the start, as many as fit the unfolded length. Only unfolded stretches carry
 * ticks, and one close enough to a fold or another tick that their labels would touch is left out.
 */
function ticks(scale: TimelineScale, linear: number): TimelineTick[] {
  const step = tickStep(linear);
  const kept: TimelineTick[] = [];
  let previous = 0;
  for (const [from, to] of unfolded(scale)) {
    const first = Math.max(step, Math.ceil((from - scale.start) / step) * step);
    for (let elapsed = first; scale.start + elapsed <= to; elapsed += step) {
      const offset = timelinePosition(scale, scale.start + elapsed);
      if (offset > TICK_END || offset - previous < TICK_CLEARANCE) continue;
      if (scale.folds.some((fold) => nearFold(fold, offset))) continue;
      kept.push({ elapsed, offset });
      previous = offset;
    }
  }
  return kept;
}

/** The stretches between folds, which keep their length. */
function unfolded(scale: TimelineScale): [number, number][] {
  const stretches: [number, number][] = [];
  let cursor = scale.start;
  for (const fold of scale.folds) {
    stretches.push([cursor, fold.from]);
    cursor = fold.to;
  }
  stretches.push([cursor, scale.end]);
  return stretches;
}

function tickStep(linear: number): number {
  const step = TICK_STEPS.find((candidate) => linear / candidate <= MAX_TICKS);
  return step ?? Math.ceil(linear / MAX_TICKS / DAY) * DAY;
}

/** A fold's label can be wider than the fold, so a tick keeps a full clearance from either edge. */
function nearFold(fold: TimelineFold, offset: number): boolean {
  return (
    offset > fold.offset - TICK_CLEARANCE && offset < fold.offset + fold.width + TICK_CLEARANCE
  );
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
