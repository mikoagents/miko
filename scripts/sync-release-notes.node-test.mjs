import assert from "node:assert/strict";
import test from "node:test";
import { preserveContainerReference, syncReleaseNotes } from "./sync-release-notes.mjs";

const repository = "mikoagents/miko";
const reference = `Container: ghcr.io/${repository}@sha256:${"a".repeat(64)}`;

test("changelog corrections retain the published image digest", () => {
  assert.equal(
    preserveContainerReference("New notes\n", `Old notes\n\n${reference}\n`, repository),
    `New notes\n\n${reference}\n`,
  );
  assert.equal(preserveContainerReference("New notes\n", "Old notes", repository), "New notes\n");
  assert.equal(
    preserveContainerReference(
      "New notes\n",
      reference.replace(repository, "another/repo"),
      repository,
    ),
    "New notes\n",
  );
  assert.throws(
    () => preserveContainerReference("New notes", `${reference}\n${reference}`, repository),
    /multiple container digests/,
  );
});

test("sync updates only the body of an existing release", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json(calls.length === 1 ? { id: 42, body: `Old notes\n\n${reference}` } : {});
  };
  assert.equal(
    await syncReleaseNotes({
      repository,
      tag: "v0.12.2",
      notes: "New notes",
      token: "test",
      fetchImpl,
    }),
    true,
  );
  assert.equal(calls[0].url, "https://api.github.com/repos/mikoagents/miko/releases/tags/v0.12.2");
  assert.equal(calls[1].url, "https://api.github.com/repos/mikoagents/miko/releases/42");
  assert.equal(calls[1].init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[1].init.body), { body: `New notes\n\n${reference}\n` });
});

test("only a missing release is skipped; API failures are surfaced", async () => {
  const options = { repository, tag: "v0.12.2", notes: "New notes", token: "test" };
  assert.equal(
    await syncReleaseNotes({
      ...options,
      fetchImpl: async () => new Response(null, { status: 404 }),
    }),
    false,
  );
  await assert.rejects(
    syncReleaseNotes({ ...options, fetchImpl: async () => new Response(null, { status: 403 }) }),
    /Cannot read release/,
  );
  let calls = 0;
  await assert.rejects(
    syncReleaseNotes({
      ...options,
      fetchImpl: async () =>
        ++calls === 1
          ? Response.json({ id: 42, body: "Old" })
          : new Response(null, { status: 500 }),
    }),
    /Cannot update release/,
  );
});
