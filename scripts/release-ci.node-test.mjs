import assert from "node:assert/strict";
import test from "node:test";
import { releaseCI } from "./release-ci.mjs";

const sha = "a".repeat(40);
const successful = {
  id: 1,
  head_sha: sha,
  event: "push",
  head_branch: "main",
  head_repository: { full_name: "mikoagents/miko" },
  path: ".github/workflows/ci.yml",
  status: "completed",
  conclusion: "success",
  html_url: "https://github.com/mikoagents/miko/actions/runs/1",
};

function fixture(responses, options = {}) {
  let elapsed = 0;
  let calls = 0;
  return {
    repository: "mikoagents/miko",
    sha,
    token: "test-token",
    now: () => elapsed,
    sleep: async (ms) => {
      elapsed += ms;
    },
    log: () => {},
    timeoutMs: 100,
    discoveryMs: 20,
    pollMs: 10,
    fetchImpl: async (url, init) => {
      assert.equal(url.pathname, "/repos/mikoagents/miko/actions/workflows/ci.yml/runs");
      assert.equal(url.searchParams.get("head_sha"), sha);
      assert.equal(url.searchParams.get("event"), "push");
      assert.equal(url.searchParams.get("branch"), "main");
      assert.equal(init.headers.Authorization, "Bearer test-token");
      return Response.json({ workflow_runs: responses[Math.min(calls++, responses.length - 1)] });
    },
    ...options,
  };
}

test("reuses only CI for the exact main commit in this repository", async () => {
  assert.deepEqual(await releaseCI(fixture([[successful]])), {
    runChecks: false,
    url: successful.html_url,
  });
  for (const changes of [
    { head_sha: "b".repeat(40) },
    { event: "pull_request" },
    { head_branch: "feature" },
    { head_repository: { full_name: "someone/miko" } },
    { path: ".github/workflows/release.yml" },
  ]) {
    assert.deepEqual(await releaseCI(fixture([[{ ...successful, ...changes }]])), {
      runChecks: true,
    });
  }
});

test("a newer failed run blocks release even when an older run passed", async () => {
  for (const conclusion of ["failure", "timed_out", "action_required", "neutral"]) {
    await assert.rejects(
      releaseCI(fixture([[successful, { ...successful, id: 2, conclusion }]])),
      new RegExp(`Main CI ${conclusion}`),
    );
  }
});

test("cancelled or skipped main checks require the complete release suite", async () => {
  for (const conclusion of ["cancelled", "skipped"]) {
    assert.deepEqual(await releaseCI(fixture([[{ ...successful, conclusion }]])), {
      runChecks: true,
    });
  }
});

test("waits for main CI to be registered, queued and completed", async () => {
  assert.equal(
    (
      await releaseCI(
        fixture([
          [],
          [{ ...successful, status: "queued", conclusion: null }],
          [{ ...successful, status: "in_progress", conclusion: null }],
          [successful],
        ]),
      )
    ).runChecks,
    false,
  );
});

test("missing CI falls back after discovery, but active CI times out without approval", async () => {
  assert.deepEqual(await releaseCI(fixture([[]])), { runChecks: true });
  await assert.rejects(
    releaseCI(fixture([[{ ...successful, status: "in_progress", conclusion: null }]])),
    /Timed out waiting/,
  );
});

test("API errors and malformed responses cannot bypass the gate", async () => {
  await assert.rejects(
    releaseCI(fixture([], { fetchImpl: async () => new Response(null, { status: 403 }) })),
    /GitHub returned 403/,
  );
  await assert.rejects(
    releaseCI(fixture([], { fetchImpl: async () => Response.json({}) })),
    /Invalid GitHub workflow runs response/,
  );
});
