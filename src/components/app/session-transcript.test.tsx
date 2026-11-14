import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type { TimelineRow } from "../../session-timelines/store.js";
import { SessionTranscript, type TranscriptPrompt } from "./session-transcript.js";

const PROMPTS: readonly TranscriptPrompt[] = [
  { messageId: "execution-plan", text: "Plan the review.", label: "plan" },
  { messageId: "execution-revise", text: "Revise the review.", label: "revise" },
];

function row(seq: number, item: TimelineRow["item"]): TimelineRow {
  return { seq, timestamp: "2026-11-14T10:00:00.000Z", turnId: String(seq), item };
}

function headers(rows: readonly TimelineRow[], prompts?: readonly TranscriptPrompt[]) {
  const html = renderToStaticMarkup(
    <SessionTranscript rows={rows} {...(prompts === undefined ? {} : { prompts })} />,
  );
  return [...html.matchAll(/<article[^>]*><div[^>]*><div[^>]*><span>([^<]*)<\/span>/g)].map(
    (match) => match[1],
  );
}

describe("the name a transcript gives each message", () => {
  it("names a prompt by the call that submitted it", () => {
    const rows = [
      row(1, { type: "user_message", text: "Plan the review.", messageId: "execution-plan" }),
      row(2, { type: "assistant_message", text: "Reading the diff." }),
      row(3, { type: "user_message", text: "Revise the review.", messageId: "execution-revise" }),
    ];

    assert.deepEqual(headers(rows, PROMPTS), ["plan", "Assistant", "revise"]);
  });

  it("falls back to the prompt text when the daemon kept another message id", () => {
    const rows = [row(1, { type: "user_message", text: "  Revise the review.\n", messageId: "m" })];

    assert.deepEqual(headers(rows, PROMPTS), ["revise"]);
  });

  it("keeps a message no call in this run sent as the user's", () => {
    const rows = [
      row(1, { type: "user_message", text: "Plan the earlier change.", messageId: "earlier" }),
    ];

    assert.deepEqual(headers(rows, PROMPTS), ["User"]);
    assert.deepEqual(headers(rows), ["User"]);
  });

  it("never names a reply after the prompt it shares text with", () => {
    const rows = [row(1, { type: "assistant_message", text: "Plan the review." })];

    assert.deepEqual(headers(rows, PROMPTS), ["Assistant"]);
  });
});
