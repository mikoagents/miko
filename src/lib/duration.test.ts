import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { formatDuration } from "./duration.js";

describe("durations", () => {
  it("formats durations to the precision runs are compared by", () => {
    assert.equal(formatDuration(400), "under 1s");
    assert.equal(formatDuration(42_000), "42s");
    assert.equal(formatDuration(120_000), "2m");
    assert.equal(formatDuration(3_725_000), "1h 2m");
    assert.equal(formatDuration(93_600_000), "1d 2h");
    assert.equal(formatDuration(Number.NaN), "");
    assert.equal(formatDuration(-1), "");
  });
});
