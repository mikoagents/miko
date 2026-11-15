import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it, vi } from "vitest";
import { buildTrigger } from "./build.js";
import { TriggerTemplateReferenceSchema } from "./contract.js";
import { triggerStarter } from "./starter.js";
import { runTriggerCommand } from "./cli.js";
import { compareTemplateVersions } from "./template-version.js";
import { findTriggerTemplate, triggerTemplateStatus, triggerTemplateSource } from "./templates.js";
import {
  applyTemplateUpgrade,
  initializeTemplateProject,
  prepareTemplateUpgrade,
  templateProjectStatus,
  TEMPLATE_LOCK_FILE,
} from "./template-project.js";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

async function project(prompt?: string, installedVersion = "0.9.0") {
  const directory = await mkdtemp(join(tmpdir(), "miko-template-upgrade-"));
  directories.push(directory);
  const latest = findTriggerTemplate("add-test-coverage")!;
  const old = { ...latest, version: installedVersion, prompt: prompt ?? latest.prompt };
  await initializeTemplateProject(directory, old, "my-coverage");
  return {
    directory,
    latest,
    old,
    entry: join(directory, "trigger.ts"),
    lock: join(directory, TEMPLATE_LOCK_FILE),
  };
}

describe("versioned Trigger template projects", () => {
  it("detects and applies the catalog expansion upgrade from 1.0.0 to 1.1.0", async () => {
    const fixture = await project(undefined, "1.0.0");
    assert.equal(fixture.latest.version, "1.1.0");
    const before = await templateProjectStatus(fixture.entry);
    assert.equal(before.status, "update_available");
    const preview = await prepareTemplateUpgrade(fixture.entry);
    assert.ok(preview.preview);
    await applyTemplateUpgrade(fixture.entry, preview.preview);
    assert.equal((await templateProjectStatus(fixture.entry)).status, "current");
    assert.deepEqual((await buildTrigger(fixture.entry)).manifest.template, {
      id: fixture.latest.id,
      version: fixture.latest.version,
    });
  });

  it("upgrades an older template even when it lacks fields required by the latest execution schema", async () => {
    const fixture = await project();
    const legacy = `import { defineTrigger } from "@mikoagents/hub/triggers";
export default defineTrigger({ name: "my-coverage", template: { id: "add-test-coverage", version: "0.9.0" }, diagram: "flowchart LR\\n A --> B", runner: "local", on: [{ source: "manual", event: "run" }], grants: {}, limits: { maxRuntime: "1m" }, async run(ctx) { return ctx.event.payload; } });\n`;
    await writeFile(fixture.entry, legacy);
    await writeFile(
      fixture.lock,
      JSON.stringify({
        format: "miko-trigger-template-v1",
        template: { id: fixture.old.id, version: fixture.old.version },
        name: "my-coverage",
        entrypoint: "trigger.ts",
        base: legacy,
        baseDigest: createHash("sha256").update(legacy).digest("hex"),
      }),
    );
    assert.equal((await templateProjectStatus(fixture.entry)).status, "update_available");
    const preview = await prepareTemplateUpgrade(fixture.entry);
    assert.ok(preview.preview);
    await applyTemplateUpgrade(fixture.entry, preview.preview);
    const artifact = await buildTrigger(fixture.entry);
    assert.equal(artifact.manifest.template?.version, fixture.latest.version);
    assert.ok(artifact.manifest.pipeline.nodes.length > 2);
  });

  it("checks, previews and applies upgrades through the CLI without Hub credentials", async () => {
    const fixture = await project();
    const original = await readFile(fixture.entry, "utf8");
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      await runTriggerCommand(["template-status", fixture.entry]);
      assert.ok(String(output.mock.calls.at(-1)?.[0]).includes('"status": "update_available"'));
      await runTriggerCommand(["upgrade", fixture.entry]);
      assert.equal(await readFile(fixture.entry, "utf8"), original);
      const preview = join(fixture.directory, "trigger.upgrade-" + fixture.latest.version + ".ts");
      await runTriggerCommand(["upgrade", fixture.entry, "--apply", preview]);
      assert.ok(String(output.mock.calls.at(-1)?.[0]).includes('"applied": true'));
      assert.equal((await templateProjectStatus(fixture.entry)).status, "current");
    } finally {
      output.mockRestore();
    }
  });

  it("compares numeric versions and distinguishes outdated, current, newer and unknown templates", () => {
    assert.equal(compareTemplateVersions("1.10.0", "1.2.9"), 1);
    assert.equal(compareTemplateVersions("2.0.0", "10.0.0"), -1);
    assert.equal(compareTemplateVersions("1.0.0", "1.0.0"), 0);
    for (const version of ["1", "1.0", "v1.0.0", "01.0.0", "1.0.0-beta"])
      assert.equal(
        TriggerTemplateReferenceSchema.safeParse({ id: "daily-digest", version }).success,
        false,
      );
    assert.equal(
      triggerTemplateStatus({ id: "daily-digest", version: "0.9.0" }).status,
      "update_available",
    );
    assert.equal(
      triggerTemplateStatus({
        id: "daily-digest",
        version: findTriggerTemplate("daily-digest")!.version,
      }).status,
      "current",
    );
    assert.equal(
      triggerTemplateStatus({ id: "daily-digest", version: "1.0.0" }).status,
      "update_available",
    );
    assert.equal(triggerTemplateStatus({ id: "daily-digest", version: "2.0.0" }).status, "newer");
    assert.equal(triggerTemplateStatus({ id: "retired", version: "1.0.0" }).status, "unknown");
  });

  it("previews a three-way upgrade, preserves custom settings and logic, then applies the reviewed candidate", async () => {
    const fixture = await project();
    const original = await readFile(fixture.entry, "utf8");
    const customized =
      original.replace('cwd: "/path/to/repository"', 'cwd: "/workspace/custom"') +
      "\n// Custom workflow logic stays here.\n";
    await writeFile(fixture.entry, customized);
    const beforeLock = await readFile(fixture.lock, "utf8");
    const status = await templateProjectStatus(fixture.entry);
    assert.equal(status.status, "update_available");
    assert.ok("modified" in status && status.modified && status.canUpgrade);
    const result = await prepareTemplateUpgrade(fixture.entry);
    assert.ok(result.preview);
    assert.equal("conflicts" in result && result.conflicts, false);
    assert.equal(await readFile(fixture.entry, "utf8"), customized);
    assert.equal(await readFile(fixture.lock, "utf8"), beforeLock);
    const candidate = await readFile(result.preview, "utf8");
    assert.ok(candidate.includes('cwd: "/workspace/custom"'));
    assert.ok(candidate.includes("Custom workflow logic stays here"));
    await assert.rejects(prepareTemplateUpgrade(fixture.entry), /EEXIST/u);
    assert.equal((await applyTemplateUpgrade(fixture.entry, result.preview)).status, "current");
    assert.equal(await readFile(fixture.entry, "utf8"), candidate);
    const deployed = await buildTrigger(fixture.entry);
    assert.deepEqual(deployed.manifest.template, {
      id: fixture.latest.id,
      version: fixture.latest.version,
    });
    const baseline = deployed.sources.find((file) => file.path === TEMPLATE_LOCK_FILE);
    assert.ok(baseline?.content.includes('"version": "' + fixture.latest.version + '"'));
    const after = await templateProjectStatus(fixture.directory);
    assert.equal(after.status, "current");
    assert.ok("modified" in after && after.modified);
    assert.equal((await prepareTemplateUpgrade(fixture.entry)).preview, null);
  });

  it("exposes conflicting prompt edits without overwriting source, and accepts a manually resolved preview", async () => {
    const fixture = await project("Original old prompt.\n");
    const customized = (await readFile(fixture.entry, "utf8")).replace(
      "Original old prompt.",
      "Locally customized prompt.",
    );
    await writeFile(fixture.entry, customized);
    const result = await prepareTemplateUpgrade(fixture.entry);
    assert.ok(result.preview);
    assert.equal("conflicts" in result && result.conflicts, true);
    await assert.rejects(
      applyTemplateUpgrade(fixture.entry, result.preview),
      /Resolve all merge conflicts/u,
    );
    assert.equal(await readFile(fixture.entry, "utf8"), customized);
    const resolved =
      triggerTemplateSource(fixture.latest, "my-coverage") + "\n// Manually reviewed resolution.\n";
    await writeFile(result.preview, resolved);
    assert.equal((await applyTemplateUpgrade(fixture.entry, result.preview)).applied, true);
    assert.equal(await readFile(fixture.entry, "utf8"), resolved);
  });

  it("rejects tampered baselines, mismatched versions, and candidates from another template", async () => {
    const fixture = await project();
    const source = await readFile(fixture.entry, "utf8");
    const baseline = await readFile(fixture.lock, "utf8");
    const wrong = join(fixture.directory, "wrong.ts");
    const proposal = await prepareTemplateUpgrade(fixture.entry);
    assert.ok(proposal.preview);
    await writeFile(wrong, triggerTemplateSource(findTriggerTemplate("find-bugs")!, "my-coverage"));
    await writeFile(
      wrong + ".miko-upgrade.json",
      await readFile(proposal.preview + ".miko-upgrade.json"),
    );
    await assert.rejects(applyTemplateUpgrade(fixture.entry, wrong), /same template/u);
    assert.equal(await readFile(fixture.entry, "utf8"), source);
    await writeFile(fixture.entry, source.replace('"version":"0.9.0"', '"version":"1.0.0"'));
    await assert.rejects(templateProjectStatus(fixture.entry), /baseline version disagree/u);
    await writeFile(fixture.entry, source);
    await writeFile(
      fixture.lock,
      baseline.replace(/"baseDigest": "[a-f0-9]{64}"/u, `"baseDigest": "${"0".repeat(64)}"`),
    );
    await assert.rejects(templateProjectStatus(fixture.entry), /baseline digest does not match/u);
    assert.equal(await readFile(fixture.entry, "utf8"), source);
  });

  it("reports a missing baseline and refuses untracked upgrades and downgrades", async () => {
    const fixture = await project();
    await rm(fixture.lock);
    const status = await templateProjectStatus(fixture.entry);
    assert.equal(status.status, "update_available");
    assert.ok("canUpgrade" in status && !status.canUpgrade && !status.hasBaseline);
    await assert.rejects(prepareTemplateUpgrade(fixture.entry), /baseline is missing/u);
    await writeFile(fixture.entry, triggerStarter("plain"));
    assert.equal((await templateProjectStatus(fixture.entry)).status, "untracked");
    await assert.rejects(prepareTemplateUpgrade(fixture.entry), /not associated/u);
    await writeFile(fixture.entry, triggerTemplateSource({ ...fixture.latest, version: "2.0.0" }));
    await assert.rejects(prepareTemplateUpgrade(fixture.entry), /newer template/u);
  });

  it("refuses a stale preview when the author changed the Trigger after generating it", async () => {
    const fixture = await project();
    const proposal = await prepareTemplateUpgrade(fixture.entry);
    assert.ok(proposal.preview);
    const edited = (await readFile(fixture.entry, "utf8")) + "\n// New local edit after preview.\n";
    await writeFile(fixture.entry, edited);
    await assert.rejects(
      applyTemplateUpgrade(fixture.entry, proposal.preview),
      /changed since this preview/u,
    );
    assert.equal(await readFile(fixture.entry, "utf8"), edited);
    const refreshed = await prepareTemplateUpgrade(
      fixture.entry,
      join(fixture.directory, "reviewed.ts"),
    );
    assert.ok(refreshed.preview);
    await applyTemplateUpgrade(fixture.entry, refreshed.preview);
    assert.ok((await readFile(fixture.entry, "utf8")).includes("New local edit after preview"));
  });
});
