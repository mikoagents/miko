import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { buildTrigger } from "./build.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

async function documentedTrigger(relativePath: string): Promise<string> {
  const text = await readFile(join(root, relativePath), "utf8");
  const source = /```ts\n([\s\S]*?)```/u.exec(text)?.[1];
  if (source === undefined) throw new Error(`Missing TypeScript example in ${relativePath}`);
  return source;
}

it("builds the documented hello and scheduled Trigger examples", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hub-trigger-docs-"));
  try {
    const hello = join(directory, "hello.ts");
    await writeFile(hello, await documentedTrigger("README.md"));
    const helloArtifact = await buildTrigger(hello);
    assert.equal(helloArtifact.manifest.name, "hello");
    assert.deepEqual(
      helloArtifact.manifest.pipeline.nodes.find((node) => node.id === "handle")?.operations,
      ["handle-input"],
    );

    const scan = join(directory, "daily-scan.ts");
    await writeFile(scan, await documentedTrigger("docs/scheduled-triggers.md"));
    const scanArtifact = await buildTrigger(scan);
    assert.equal(scanArtifact.manifest.name, "daily-scan");
    assert.deepEqual(scanArtifact.manifest.pipeline.supportOperations, ["scan:*"]);
    assert.equal(
      scanArtifact.manifest.on.some((item) => item.source === "schedule"),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
