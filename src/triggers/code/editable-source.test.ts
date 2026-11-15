/* oxlint-disable max-nested-callbacks, typescript-eslint/no-unsafe-type-assertion -- scoped temporary projects exercise compiled modules through the real builder */
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "vitest";
import { buildTrigger } from "./build.js";
import { triggerStarter } from "./starter.js";
import type { TriggerArtifact } from "./contract.js";
import { configureTriggerArtifact, triggerConfiguration } from "./editable-source.js";
import { configurationSourcePreview } from "./configuration-draft.js";

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "hub-edit-source-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("Trigger source configuration", () => {
  it("updates source, manifest and executable together and preserves custom workflow code", async () =>
    fixture(async (directory) => {
      const source = triggerStarter("editable").replace(
        'runner: "local"',
        'runner: "local" /* keep this comment */',
      );
      await writeFile(join(directory, "trigger.ts"), source);
      const original = await buildTrigger(join(directory, "trigger.ts"));
      const fields = triggerConfiguration(original).fields;
      const runner = fields.find((field) => field.label === "Runner")!;
      const limit = fields.find((field) => field.label === "Time limit")!;
      const changes = [
        { id: runner.id, value: "worker" },
        { id: limit.id, value: "20m" },
      ];
      const updated = await configureTriggerArtifact(original, changes);
      assert.equal(updated.manifest.runner, "worker");
      assert.equal(updated.manifest.limits.maxRuntime, "20m");
      assert.ok(updated.sources[0]!.content.includes('"worker" /* keep this comment */'));
      assert.equal(updated.sources[0]!.content.split("async run")[1], source.split("async run")[1]);
      const preview = configurationSourcePreview(original.sources, fields, changes);
      assert.equal(preview[0]?.content, updated.sources[0]?.content);
      const built = join(directory, "configured.mjs");
      await writeFile(built, updated.code);
      const executable = (await import(pathToFileURL(built).href)) as {
        default: { runner: string; limits: { maxRuntime: string } };
      };
      assert.equal(executable.default.runner, updated.manifest.runner);
      assert.equal(executable.default.limits.maxRuntime, "20m");
      await writeFile(join(directory, "trigger.ts"), updated.sources[0]!.content);
      assert.deepEqual(
        (await buildTrigger(join(directory, "trigger.ts"))).manifest,
        updated.manifest,
      );
    }));

  it("edits imported policy files and shared native agent options without changing runtime expressions", async () =>
    fixture(async (directory) => {
      const source = triggerStarter("imports")
        .replace('runner: "local"', "runner: policy.runner")
        .replace(
          "grants: {}",
          'grants: {targets:{workspace:{daemon:"worker",cwd:"/workspace",providers:[policy.agent.provider]}}}',
        )
        .replace(
          "const result = await ctx.step",
          'await ctx.agent.run("agent", {target:"workspace",agent:policy.agent,prompt:ctx.event.payload.prompt,maxRuntime:"5m",idleTimeout:"1m"});\n    const result = await ctx.step',
        );
      await writeFile(
        join(directory, "trigger.ts"),
        'import {policy} from "./policy.js";\n' + source,
      );
      await writeFile(
        join(directory, "policy.ts"),
        'export const policy={runner:"local",agent:{provider:"codex",model:"before",mode:"read-only"}};',
      );
      const artifact = await buildTrigger(join(directory, "trigger.ts"));
      const config = triggerConfiguration(artifact);
      assert.equal(config.unavailable, null);
      const model = config.fields.find((field) => field.kind === "agent")!;
      assert.equal(model.path, "policy.ts");
      assert.ok(!config.fields.some((field) => field.label === "Prompt"));
      const updated = await configureTriggerArtifact(artifact, [
        { id: model.id, value: { provider: "codex", model: "after", mode: "read-only" } },
      ]);
      assert.equal(
        updated.sources.find((file) => file.path === "trigger.ts")?.content,
        artifact.sources.find((file) => file.path === "trigger.ts")?.content,
      );
      assert.ok(
        updated.sources
          .find((file) => file.path === "policy.ts")
          ?.content.includes('"model": "after"'),
      );
    }));

  it("refuses dynamic module setup, mismatched artifacts, unknown edits and invalid manifests", async () =>
    fixture(async (directory) => {
      await writeFile(join(directory, "trigger.ts"), triggerStarter("reject"));
      const artifact = await buildTrigger(join(directory, "trigger.ts"));
      const dynamic: TriggerArtifact = {
        ...artifact,
        sources: [
          {
            path: "trigger.ts",
            content: "globalThis.__sourceEditorExecuted = true;\n" + artifact.sources[0]!.content,
          },
        ],
      };
      assert.match(triggerConfiguration(dynamic).unavailable!, /executable module-level/u);
      assert.equal(Reflect.get(globalThis, "__sourceEditorExecuted"), undefined);
      assert.ok(
        triggerConfiguration({
          ...artifact,
          manifest: { ...artifact.manifest, runner: "different" },
        }).unavailable,
      );
      await assert.rejects(configureTriggerArtifact(artifact, [{ id: "forged", value: "bad" }]));
      const limit = triggerConfiguration(artifact).fields.find(
        (field) => field.label === "Time limit",
      )!;
      await assert.rejects(
        configureTriggerArtifact(artifact, [{ id: limit.id, value: "invalid-duration" }]),
      );
    }));
});
