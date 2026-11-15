/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop -- shared transcript surfaces accept composed facts */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TimelineRow } from "../../session-timelines/store.js";
import type { JsonValue } from "../../config/compiler.js";
import { projectSessionRows } from "../../session-timelines/project.js";
import { Button } from "../ui/button.js";
import { cn } from "../../lib/utils.js";
import { CodeBlock, CopyButton } from "./copy-field.js";
import { Disclosure } from "./disclosure.js";
import { RelativeTime } from "./relative-time.js";
import { StatusPill } from "./status-pill.js";
import { Section } from "./section.js";
import { ContentSkeleton } from "./loading.js";

// The real transcript renderer owns message spacing, typography, and wrapping on a phone.
const SAMPLE_MESSAGES: readonly TimelineRow[] = [
  {
    seq: 1,
    timestamp: "2026-01-01T00:00:00Z",
    item: { type: "user_message", text: "Review the changes and summarize the result." },
  },
  {
    seq: 2,
    timestamp: "2026-01-01T00:00:01Z",
    item: {
      type: "assistant_message",
      text: "I will inspect the changed files, check the relevant behavior, and report the result with the supporting details.\nThe review includes the workflow and its execution steps.",
    },
  },
];

export function SessionTranscriptSkeleton() {
  return (
    <ContentSkeleton loading label="Loading session messages">
      <SessionTranscript rows={SAMPLE_MESSAGES} />
    </ContentSkeleton>
  );
}

/** A prompt Hub submitted, and the name the transcript gives it instead of "User". */
export interface TranscriptPrompt {
  messageId: string;
  text: string;
  label: string;
  /** When set, identical text from before this call started keeps its own name. */
  startedAt?: string;
}

const NO_PROMPTS: readonly TranscriptPrompt[] = [];

export function SessionTranscript({
  rows,
  prompts = NO_PROMPTS,
}: {
  rows: readonly TimelineRow[];
  /** Names the user messages that are these prompts, so each round says where it came from. */
  prompts?: readonly TranscriptPrompt[];
}) {
  return (
    <ol className="grid min-w-0 gap-4" aria-label="Session messages">
      {projectSessionRows(rows).map((row) => (
        <li key={row.seq} className="min-w-0">
          <TranscriptEntry row={row} prompts={prompts} at={row.timestamp} />
        </li>
      ))}
    </ol>
  );
}

/**
 * The prompt a user message delivered. Hub submits each prompt with its own message id, which the
 * daemon keeps; the text is the fallback for a daemon that recorded the message under another id.
 * A message that already happened before the call started is a different round, even when the
 * trigger sent the same words again.
 */
function promptLabel(
  item: TimelineRow["item"],
  prompts: readonly TranscriptPrompt[],
  at: string | undefined,
) {
  if (item["type"] !== "user_message" || prompts.length === 0) return undefined;
  const byId = prompts.find((prompt) => prompt.messageId === item["messageId"]);
  if (byId !== undefined) return byId.label;
  const text = typeof item["text"] === "string" ? item["text"].trim() : null;
  if (text === null || text === "") return undefined;
  const same = prompts.filter((prompt) => prompt.text.trim() === text);
  const eligible = same.filter(
    (prompt) => prompt.startedAt === undefined || at === undefined || at >= prompt.startedAt,
  );
  if (eligible.length === 0) return undefined;
  return eligible.reduce((best, prompt) =>
    (prompt.startedAt ?? "") >= (best.startedAt ?? "") ? prompt : best,
  ).label;
}

function string(value: JsonValue | undefined, fallback: string) {
  return typeof value === "string" ? value : fallback;
}
function content(value: JsonValue) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
function statusTone(status: string) {
  if (status === "failed") return "danger";
  if (status === "completed") return "success";
  return "neutral";
}
function TranscriptEntry({
  row,
  prompts,
  at,
}: {
  row: TimelineRow;
  prompts: readonly TranscriptPrompt[];
  at: string | undefined;
}) {
  if (row.item["type"] === "tool_call") return <ToolEntry row={row} />;
  if (row.item["type"] === "reasoning") return <ReasoningEntry row={row} />;
  return <MessageEntry row={row} label={promptLabel(row.item, prompts, at)} />;
}
function ReasoningEntry({ row }: { row: TimelineRow }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <Disclosure id={id} title="Reasoning" open={open} onOpenChange={setOpen}>
      <MessageText>{string(row.item["text"], JSON.stringify(row.item, null, 2))}</MessageText>
    </Disclosure>
  );
}
function ToolEntry({ row }: { row: TimelineRow }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const status = string(row.item["status"], "unknown");
  return (
    <Disclosure
      id={id}
      title={string(row.item["name"], "Tool call")}
      open={open}
      onOpenChange={setOpen}
      status={<StatusPill tone={statusTone(status)}>{status}</StatusPill>}
    >
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <RelativeTime value={row.timestamp} />
          <CopyButton label="tool entry" value={JSON.stringify(row.item, null, 2)} />
        </div>
        <ToolDetails item={row.item} />
      </div>
    </Disclosure>
  );
}
function ToolDetails({ item }: { item: TimelineRow["item"] }) {
  const detail =
    typeof item["detail"] === "object" && item["detail"] !== null && !Array.isArray(item["detail"])
      ? item["detail"]
      : {};
  const input = item["input"] ?? item["arguments"] ?? detail["input"] ?? detail["command"];
  const output = item["output"] ?? item["result"] ?? detail["output"] ?? detail["text"];
  return (
    <>
      {input === undefined ? null : (
        <Section title={detail["type"] === "shell" ? "Command" : "Input"}>
          <CodeBlock label="Tool input">{content(input)}</CodeBlock>
        </Section>
      )}
      {output === undefined ? null : (
        <Section title="Output">
          <CodeBlock label="Tool output">{content(output)}</CodeBlock>
        </Section>
      )}
      {item["error"] == null ? null : (
        <Section title="Error">
          <CodeBlock label="Tool error">{content(item["error"])}</CodeBlock>
        </Section>
      )}
      {input === undefined && output === undefined && item["error"] == null ? (
        <CodeBlock label="Tool details">{JSON.stringify(item, null, 2)}</CodeBlock>
      ) : null}
    </>
  );
}
function MessageEntry({ row, label }: { row: TimelineRow; label: string | undefined }) {
  const type = string(row.item["type"], "event");
  const titles: Record<string, string> = { user_message: "User", assistant_message: "Assistant" };
  const text = typeof row.item["text"] === "string" ? row.item["text"] : null;
  const raw = JSON.stringify(row.item, null, 2);
  return (
    <article className="grid min-w-0 gap-2 border-b pb-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>{label ?? titles[type] ?? type.replaceAll("_", " ")}</span>
          <span className="text-muted-foreground">
            <RelativeTime value={row.timestamp} />
          </span>
        </div>
        <CopyButton label="message" value={text ?? raw} />
      </div>
      {text === null ? (
        <CodeBlock label="Session event">{raw}</CodeBlock>
      ) : (
        <MessageText>{text}</MessageText>
      )}
    </article>
  );
}

/** Long prompts and replies preview in place; expanding keeps one reading scroll in the dialog. */
function MessageText({ children }: { children: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const text = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const toggle = useCallback(() => setExpanded((current) => !current), []);
  useEffect(() => {
    const node = text.current;
    if (node === null) return undefined;
    const measure = () =>
      setOverflows(
        node.scrollHeight > Number.parseFloat(getComputedStyle(node).lineHeight) * 12 + 1,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [children]);
  return (
    <div className="grid min-w-0 justify-items-start gap-2">
      <p
        ref={text}
        id={id}
        className={cn(
          "w-full text-sm break-words whitespace-pre-wrap",
          expanded ? undefined : "line-clamp-12",
        )}
      >
        {children}
      </p>
      {overflows ? (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={toggle}
        >
          {expanded ? "Show less" : "Show full message"}
        </Button>
      ) : null}
    </div>
  );
}
