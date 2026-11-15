/* oxlint-disable eslint-plugin-jsx-a11y/no-noninteractive-tabindex -- each graph is an independent scroll region reachable by keyboard */
/* oxlint-disable eslint-plugin-react-perf/jsx-no-new-object-as-prop, eslint-plugin-react-perf/jsx-no-jsx-as-prop -- topology determines canvas coordinates and the shared expansion dialog */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type FocusEvent as ReactFocusEvent,
} from "react";
import { Maximize2, Minus, Plus, Scan } from "lucide-react";
import type { TriggerPipeline, TriggerPipelineNode } from "../../triggers/code/pipeline-types.js";
import {
  layoutPipeline,
  type PipelineLayout,
  type PipelineNodeRun,
  type PipelineState,
} from "../../lib/pipeline.js";
export type { PipelineNodeRun, PipelineState } from "../../lib/pipeline.js";
import type { TimelineTone } from "../../lib/timeline.js";
import { cn } from "../../lib/utils.js";
import { Skeleton } from "../ui/skeleton.js";
import { Button } from "../ui/button.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.js";
import { DetailDialog, DetailDialogTrigger } from "./detail-dialog.js";
import { Card } from "./card.js";
import { FailureAlert } from "./failure-alert.js";
import { TimelineMark } from "./timeline.js";

const DOTS: Record<PipelineState, string> = {
  complete: "bg-success",
  failed: "bg-danger",
  active: "bg-foreground motion-safe:animate-pulse",
  waiting: "border border-muted-foreground",
  unreached: "bg-muted-foreground",
};
const KINDS: Record<TriggerPipelineNode["kind"], string> = {
  event: "Event",
  step: "Step",
  agent: "Agent",
  wait: "Wait",
  decision: "Decision",
  parallel: "Parallel",
  join: "Join",
  outcome: "Outcome",
};
interface PipelineProps {
  label: string;
  definition: TriggerPipeline;
  states?: ReadonlyMap<string, PipelineNodeRun> | undefined;
  onSelect?: ((operationId: string) => void) | undefined;
}

/** The same authored topology and cached layout serve Trigger and Activity. */
export function Pipeline(props: PipelineProps) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    definition: TriggerPipeline;
    layout?: PipelineLayout;
    failed?: boolean;
  }>();
  const { definition, onSelect } = props;
  useEffect(() => {
    let active = true;
    void layoutPipeline(definition).then(
      (layout) => {
        if (active) setResult({ definition, layout });
        return undefined;
      },
      () => {
        if (active) setResult({ definition, failed: true });
        return undefined;
      },
    );
    return () => {
      active = false;
    };
  }, [definition, attempt]);
  const retry = useCallback(() => {
    setResult(undefined);
    setAttempt((value) => value + 1);
  }, []);
  const select = useCallback(
    (operationId: string) => {
      setOpen(false);
      onSelect?.(operationId);
    },
    [onSelect],
  );
  const layout = result?.definition === definition ? result.layout : undefined;
  const failed = result?.definition === definition && result.failed;
  return (
    <TooltipProvider delayDuration={200}>
      <Card density="compact">
        {failed ? (
          <FailureAlert
            title="Could not display the pipeline"
            error={null}
            fallback="The graph could not be arranged. Try loading it again."
            onRetry={retry}
          />
        ) : (
          <PipelineCanvas
            {...props}
            layout={layout}
            action={
              <DetailDialog
                size="fullscreen"
                title="Pipeline"
                description={props.label}
                open={open}
                onOpenChange={setOpen}
                trigger={
                  <DetailDialogTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      aria-label="Expand pipeline"
                      title="Expand pipeline"
                      disabled={!layout}
                    >
                      <Maximize2 aria-hidden="true" />
                    </Button>
                  </DetailDialogTrigger>
                }
              >
                {open ? (
                  <PipelineCanvas
                    {...props}
                    layout={layout}
                    onSelect={onSelect === undefined ? undefined : select}
                    expanded
                  />
                ) : null}
              </DetailDialog>
            }
          />
        )}
      </Card>
    </TooltipProvider>
  );
}

function PipelineCanvas({
  label,
  definition,
  states,
  onSelect,
  layout,
  action,
  expanded = false,
}: PipelineProps & {
  layout: PipelineLayout | undefined;
  action?: ReactNode;
  expanded?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState<number | null>(1);
  const zoom =
    scale ?? (layout ? Math.min(1, size.width / layout.width, size.height / layout.height) : 1);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = viewport.current;
    const entry = layout?.positions.get(
      definition.nodes.find((node) => node.kind === "event")?.id ?? "",
    );
    if (element && entry && layout) {
      element.scrollLeft = Math.max(0, entry.x + entry.width / 2 - element.clientWidth / 2);
      element.scrollTop = Math.max(0, entry.y + layout.nodeHeight / 2 - element.clientHeight / 2);
    }
  }, [layout, definition]);
  const zoomOut = useCallback(
    () => setScale(Math.max(0.25, Math.round((zoom - 0.1) * 100) / 100)),
    [zoom],
  );
  const zoomIn = useCallback(
    () => setScale(Math.min(1.5, Math.round((zoom + 0.1) * 100) / 100)),
    [zoom],
  );
  const reset = useCallback(() => setScale(1), []);
  const fit = useCallback(() => {
    setScale(null);
    viewport.current?.scrollTo({ left: 0, top: 0 });
  }, []);
  const pointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      !(event.target instanceof Element) ||
      event.target.closest("[data-pipeline-node], button")
    )
      return;
    const element = event.currentTarget;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
    };
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);
  const pointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX;
    event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY;
  }, []);
  const pointerEnd = useCallback(() => {
    drag.current = null;
  }, []);
  return (
    <div className={cn("min-w-0", expanded ? "flex min-h-0 flex-1 flex-col gap-3" : "relative")}>
      <div
        ref={viewport}
        role="region"
        aria-label={label}
        aria-busy={!layout}
        tabIndex={0}
        className={cn(
          "min-w-0 cursor-grab active:cursor-grabbing focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring",
          expanded
            ? "min-h-0 flex-1 overflow-auto overscroll-contain"
            : "overflow-x-auto overflow-y-hidden overscroll-x-contain",
        )}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
      >
        {layout ? (
          <div
            className="relative"
            style={{
              width: expanded ? Math.max(size.width, layout.width * zoom) : layout.width * zoom,
              height: expanded ? Math.max(size.height, layout.height * zoom) : layout.height * zoom,
            }}
          >
            <div
              className="absolute origin-top-left"
              style={{
                width: layout.width,
                height: layout.height,
                left: expanded ? Math.max(0, (size.width - layout.width * zoom) / 2) : 0,
                top: expanded ? Math.max(0, (size.height - layout.height * zoom) / 2) : 0,
                transform: `scale(${zoom})`,
              }}
            >
              <PipelineDrawing
                definition={definition}
                layout={layout}
                states={states}
                onSelect={onSelect}
              />
            </div>
          </div>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </div>
      {expanded ? (
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Pipeline zoom">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={zoomOut}
            disabled={!layout || zoom <= 0.25}
          >
            <Minus aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Reset zoom"
            title="Actual size"
            onClick={reset}
            disabled={!layout}
          >
            {Math.round(zoom * 100)}%
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={zoomIn}
            disabled={!layout || zoom >= 1.5}
          >
            <Plus aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Fit pipeline"
            title="Fit whole pipeline"
            onClick={fit}
            disabled={!layout}
          >
            <Scan aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      {action === undefined ? null : <div className="absolute top-0 right-0 z-10">{action}</div>}
    </div>
  );
}

/** Presentational graph; routing is shared and independent of recorded run state. */
export function PipelineDrawing({
  definition,
  layout,
  states,
  onSelect,
}: Omit<PipelineProps, "label"> & { layout: PipelineLayout }) {
  const id = useId();
  const arrow = `pipeline-arrow-${id.replaceAll(":", "")}`;
  const [inspected, setInspected] = useState<string | null>(null);
  const labels = new Map(definition.nodes.map((node) => [node.id, node.label]));
  const inspect = useCallback(
    (event: ReactPointerEvent<HTMLOListElement> | ReactFocusEvent<HTMLOListElement>) => {
      if (event.target instanceof Element)
        setInspected(
          event.target.closest("[data-pipeline-node]")?.getAttribute("data-pipeline-node") ?? null,
        );
    },
    [],
  );
  const clear = useCallback(() => setInspected(null), []);
  return (
    <div className="relative size-full" onPointerLeave={clear}>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        <defs>
          <marker id={arrow} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M 0 0 L 7 3.5 L 0 7" fill="context-stroke" />
          </marker>
        </defs>
        {layout.edges.map((edge) => (
          <path
            key={`${edge.from}:${edge.to}`}
            data-pipeline-edge={`${edge.from}:${edge.to}`}
            d={edge.path}
            className={
              inspected && (edge.from === inspected || edge.to === inspected)
                ? "text-foreground"
                : "text-muted-foreground"
            }
            opacity={inspected && edge.from !== inspected && edge.to !== inspected ? 0.15 : 0.7}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray={edge.loop ? "4 4" : undefined}
            markerEnd={`url(#${arrow})`}
          />
        ))}
      </svg>
      {layout.edges.map((edge) =>
        edge.labelBox ? (
          <span
            key={`${edge.from}:${edge.to}`}
            aria-hidden="true"
            title={edge.label}
            data-pipeline-label={`${edge.from}:${edge.to}`}
            className="absolute flex items-center justify-center rounded bg-card px-1.5 py-1 text-center text-xs whitespace-pre text-muted-foreground"
            style={{
              left: edge.labelBox.x,
              top: edge.labelBox.y,
              width: edge.labelBox.width,
              height: edge.labelBox.height,
            }}
          >
            {edge.labelBox.text}
          </span>
        ) : null,
      )}
      <ol
        aria-label="Pipeline nodes"
        onPointerOver={inspect}
        onFocusCapture={inspect}
        onBlurCapture={clear}
      >
        {definition.nodes.map((node) => {
          const position = layout.positions.get(node.id);
          return (
            <li
              key={node.id}
              data-pipeline-node={node.id}
              className="absolute"
              style={{
                left: position?.x,
                top: position?.y,
                width: position?.width,
                height: layout.nodeHeight,
              }}
            >
              <Node node={node} run={states?.get(node.id)} onSelect={onSelect} />
            </li>
          );
        })}
      </ol>
      <ol className="sr-only" aria-label="Pipeline connections">
        {definition.edges.map((edge) => (
          <li key={`${edge.from}:${edge.to}`}>
            {labels.get(edge.from)} → {labels.get(edge.to)}
            {edge.label === undefined ? "" : `: ${edge.label}`}
            {edge.loop ? " (loop)" : ""}
          </li>
        ))}
      </ol>
    </div>
  );
}
function Node({
  node,
  run,
  onSelect,
}: {
  node: TriggerPipelineNode;
  run: PipelineNodeRun | undefined;
  onSelect: ((operationId: string) => void) | undefined;
}) {
  const select = useCallback(() => {
    if (run?.operationId !== undefined) onSelect?.(run.operationId);
  }, [run?.operationId, onSelect]);
  const className = cn(
    "flex h-11 w-full min-w-0 items-center gap-2 rounded-md border bg-card px-2.5 text-left focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring",
    node.kind === "wait" && "border-dashed",
  );
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", DOTS[run?.state ?? "unreached"])}
      />
      <span className="grid min-w-0">
        <span className="truncate text-xs text-foreground">{node.label}</span>
        {run === undefined ||
        (run.state === "unreached" && run.operationId === undefined) ? null : (
          <span
            className={cn(
              "truncate text-xs",
              run.state === "failed" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {run.detail.split(" · ")[0]}
          </span>
        )}
      </span>
    </>
  );
  const recorded = run?.operationId !== undefined && onSelect !== undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {recorded ? (
          <button
            type="button"
            className={cn(className, "cursor-pointer hover:bg-accent")}
            onClick={select}
          >
            {content}
          </button>
        ) : (
          <div tabIndex={0} className={className}>
            {content}
          </div>
        )}
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-xs break-words">
        <div className="grid gap-1">
          <span>
            {node.label} · {KINDS[node.kind]}
          </span>
          <p>{node.description}</p>
          {run === undefined ? null : <p>{run.detail}</p>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function PipelineSkeleton() {
  return (
    <Card density="compact">
      <div aria-hidden="true" className="relative min-w-0">
        <div className="flex h-40 items-center gap-6 overflow-hidden px-6 py-2">
          <Skeleton className="h-11 w-44 shrink-0" />
          <Skeleton className="h-11 w-44 shrink-0" />
          <Skeleton className="h-11 w-44 shrink-0" />
        </div>
        <div className="absolute top-0 right-0">
          <Skeleton className="size-7" />
        </div>
      </div>
    </Card>
  );
}

export interface PipelineStripStage {
  key: string;
  marks: readonly { key: string; tone: TimelineTone; label: string }[];
}

const STRIP_STAGES = 10;
const STRIP_PARALLEL = 3;

/**
 * A pipeline small enough for a table cell: a mark per node, stacked when they shared a stage,
 * drawn as a timeline draws the same stretch. `label` is what a screen reader hears instead.
 */
export function PipelineStrip({
  label,
  stages,
}: {
  label: string;
  stages: readonly PipelineStripStage[];
}) {
  const hidden = stages.length - STRIP_STAGES;
  return (
    <span role="img" aria-label={label} className="flex items-center gap-0.5">
      {stages.slice(0, STRIP_STAGES).map((stage) => (
        <span key={stage.key} className="flex flex-col gap-0.5">
          {stage.marks.slice(0, STRIP_PARALLEL).map((mark) => (
            <TimelineMark key={mark.key} tone={mark.tone} title={mark.label} />
          ))}
        </span>
      ))}
      {hidden > 0 ? (
        <span className="ml-1 text-xs text-muted-foreground">+{String(hidden)}</span>
      ) : null}
    </span>
  );
}
