import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { buildTrigger } from "./build.js";
import { TriggerTemplateReferenceSchema } from "./contract.js";
import { readTemplateIdentity } from "./template-source.js";
import {
  findTriggerTemplate,
  triggerTemplateSource,
  triggerTemplateStatus,
  type TriggerTemplate,
} from "./templates.js";

const execute = promisify(execFile);
export const TEMPLATE_LOCK_FILE = ".miko-template.json";
const LockSchema = z
  .object({
    format: z.literal("miko-trigger-template-v1"),
    template: TriggerTemplateReferenceSchema,
    name: z.string().regex(/^[a-z][a-z0-9_-]*$/u),
    entrypoint: z.literal("trigger.ts"),
    base: z
      .string()
      .min(1)
      .max(1024 * 1024),
    baseDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
type TemplateLock = z.infer<typeof LockSchema>;
const UpgradeSchema = z
  .object({
    format: z.literal("miko-template-upgrade-v1"),
    from: TriggerTemplateReferenceSchema,
    to: TriggerTemplateReferenceSchema,
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    baselineDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

function sourceDigest(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

function templateLock(template: TriggerTemplate, name: string): TemplateLock {
  const base = triggerTemplateSource(template, name);
  return {
    format: "miko-trigger-template-v1",
    template: { id: template.id, version: template.version },
    name,
    entrypoint: "trigger.ts",
    base,
    baseDigest: sourceDigest(base),
  };
}

function serialize(lock: TemplateLock) {
  return JSON.stringify(lock, null, 2) + "\n";
}

/** Reserve both files before initializing; never overwrite an existing project or baseline. */
export async function initializeTemplateProject(
  directory: string,
  template: TriggerTemplate,
  name: string,
) {
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, TEMPLATE_LOCK_FILE);
  const entry = join(directory, "trigger.ts");
  const lock = templateLock(template, name);
  const handle = await open(lockPath, "wx", 0o600);
  let createdSource = false;
  try {
    await writeFile(entry, lock.base, { flag: "wx" });
    createdSource = true;
    await handle.writeFile(serialize(lock));
  } catch (error) {
    if (createdSource) await rm(entry, { force: true });
    await rm(lockPath, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
}

async function optionalLock(directory: string) {
  let content: string;
  try {
    content = await readFile(join(directory, TEMPLATE_LOCK_FILE), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  const lock = LockSchema.parse(JSON.parse(content));
  if (sourceDigest(lock.base) !== lock.baseDigest)
    throw new Error(
      "Template baseline digest does not match; restore " +
        TEMPLATE_LOCK_FILE +
        " from version control.",
    );
  return { lock, content };
}

async function readProject(input: string) {
  const path = resolve(input);
  const entry = await realpath((await stat(path)).isDirectory() ? join(path, "trigger.ts") : path);
  const directory = dirname(entry);
  const source = await readFile(entry, "utf8");
  const identity = readTemplateIdentity(source, entry);
  const reference = identity.template;
  const baseline = await optionalLock(directory);
  if (baseline !== null) {
    if (basename(entry) !== baseline.lock.entrypoint)
      throw new Error("Template entrypoint does not match " + TEMPLATE_LOCK_FILE);
    if (
      reference?.id !== baseline.lock.template.id ||
      reference.version !== baseline.lock.template.version
    )
      throw new Error(
        "Trigger template reference and baseline version disagree. Restore the matching source and baseline before upgrading.",
      );
  }
  return { entry, directory, identity, reference, baseline, source };
}

export async function templateProjectStatus(input: string) {
  const project = await readProject(input);
  if (project.reference === undefined)
    return { status: "untracked" as const, entry: project.entry };
  return {
    ...triggerTemplateStatus(project.reference),
    entry: project.entry,
    canUpgrade:
      project.baseline !== null &&
      triggerTemplateStatus(project.reference).status === "update_available",
    hasBaseline: project.baseline !== null,
    modified: project.baseline === null ? null : project.source !== project.baseline.lock.base,
  };
}

function upgradeTarget(project: Awaited<ReturnType<typeof readProject>>) {
  if (project.reference === undefined)
    throw new Error("This Trigger is not associated with a template.");
  const latest = findTriggerTemplate(project.reference.id);
  if (latest === undefined)
    throw new Error("This template is not available in the installed Hub CLI.");
  const status = triggerTemplateStatus(project.reference);
  if (status.status === "newer")
    throw new Error("This Trigger uses a newer template. Update the Hub CLI before upgrading.");
  if (project.baseline === null)
    throw new Error(
      "The template baseline is missing. Restore " +
        TEMPLATE_LOCK_FILE +
        " from the original project or deployed source bundle.",
    );
  return { latest, status, baseline: project.baseline };
}

async function mergeSource(entry: string, base: string, latest: string) {
  const temporary = await mkdtemp(join(tmpdir(), "miko-template-merge-"));
  try {
    const original = join(temporary, "installed.ts");
    const updated = join(temporary, "latest.ts");
    await writeFile(original, base);
    await writeFile(updated, latest);
    try {
      const result = await execute(
        "git",
        [
          "merge-file",
          "--stdout",
          "--diff3",
          "-L",
          "Your Trigger",
          "-L",
          "Installed template",
          "-L",
          "Latest template",
          entry,
          original,
          updated,
        ],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      return { source: result.stdout, conflicts: false };
    } catch (error) {
      // git returns the number of conflicting hunks (capped at 127), and still prints the candidate.
      if (
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "number" &&
        error.code > 0 &&
        error.code <= 127 &&
        "stdout" in error &&
        typeof error.stdout === "string" &&
        error.stdout.includes("<<<<<<< Your Trigger")
      )
        return { source: error.stdout, conflicts: true };
      throw new Error("Could not merge template changes. Template upgrades require git.", {
        cause: error,
      });
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function candidatePath(entry: string, output: string) {
  const requested = resolve(output);
  const path = join(await realpath(dirname(requested)), basename(requested));
  if (path === entry || basename(path) === TEMPLATE_LOCK_FILE || dirname(path) !== dirname(entry))
    throw new Error("Write the upgrade preview beside trigger.ts using a different filename.");
  return path;
}

/** Write a review candidate only. Applying it is a separate, explicit command. */
export async function prepareTemplateUpgrade(input: string, output?: string) {
  const project = await readProject(input);
  const { latest, status, baseline } = upgradeTarget(project);
  if (status.status === "current") return { ...status, preview: null };
  const merged = await mergeSource(
    project.entry,
    baseline.lock.base,
    triggerTemplateSource(latest, baseline.lock.name),
  );
  const preview = await candidatePath(
    project.entry,
    output ?? join(project.directory, "trigger.upgrade-" + latest.version + ".ts"),
  );
  await writeFile(preview, merged.source, { flag: "wx" });
  try {
    await writeFile(
      preview + ".miko-upgrade.json",
      JSON.stringify(
        {
          format: "miko-template-upgrade-v1",
          from: baseline.lock.template,
          to: { id: latest.id, version: latest.version },
          sourceDigest: sourceDigest(project.source),
          baselineDigest: baseline.lock.baseDigest,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    await rm(preview, { force: true });
    throw error;
  }
  return {
    ...status,
    preview,
    conflicts: merged.conflicts,
    next: "Review the preview, resolve conflicts, then run miko trigger upgrade <entry> --apply <preview>.",
  };
}

async function replaceProject(
  project: Awaited<ReturnType<typeof readProject>>,
  source: string,
  lock: TemplateLock,
) {
  const lockPath = join(project.directory, TEMPLATE_LOCK_FILE);
  const suffix = "." + randomUUID() + ".tmp";
  const nextEntry = project.entry + suffix;
  const nextLock = lockPath + suffix;
  const guard = await open(lockPath + ".upgrading", "wx", 0o600);
  let replaced = false;
  try {
    await writeFile(nextEntry, source, { flag: "wx", mode: (await stat(project.entry)).mode });
    await writeFile(nextLock, serialize(lock), { flag: "wx", mode: 0o600 });
    if (
      (await readFile(project.entry, "utf8")) !== project.source ||
      (await readFile(lockPath, "utf8")) !== project.baseline?.content
    )
      throw new Error(
        "The project changed while preparing this upgrade; check it again before applying.",
      );
    await rename(nextEntry, project.entry);
    replaced = true;
    await rename(nextLock, lockPath);
  } catch (error) {
    if (replaced) await writeFile(project.entry, project.source);
    throw error;
  } finally {
    await guard.close();
    await rm(lockPath + ".upgrading", { force: true });
    await rm(nextEntry, { force: true });
    await rm(nextLock, { force: true });
  }
}

export async function applyTemplateUpgrade(input: string, candidate: string) {
  const project = await readProject(input);
  const { latest, status, baseline } = upgradeTarget(project);
  if (status.status === "current") return { ...status, applied: false };
  const preview = await candidatePath(project.entry, candidate);
  const proposal = UpgradeSchema.parse(
    JSON.parse(await readFile(preview + ".miko-upgrade.json", "utf8")),
  );
  if (
    proposal.from.id !== baseline.lock.template.id ||
    proposal.from.version !== baseline.lock.template.version ||
    proposal.to.id !== latest.id ||
    proposal.to.version !== latest.version ||
    proposal.baselineDigest !== baseline.lock.baseDigest
  )
    throw new Error("The preview belongs to a different template version. Generate a new preview.");
  if (proposal.sourceDigest !== sourceDigest(project.source))
    throw new Error(
      "The Trigger changed since this preview. Generate a new preview to preserve recent edits.",
    );
  const source = await readFile(preview, "utf8");
  if (/^<<<<<<< Your Trigger$/mu.test(source))
    throw new Error("Resolve all merge conflicts in the preview before applying the upgrade.");
  const reviewed = await buildTrigger(preview, project.directory);
  if (
    reviewed.manifest.name !== project.identity.name ||
    reviewed.manifest.template?.id !== latest.id ||
    reviewed.manifest.template.version !== latest.version
  )
    throw new Error(
      "The reviewed upgrade must preserve the Trigger name and reference the latest version of the same template.",
    );
  await replaceProject(project, source, templateLock(latest, baseline.lock.name));
  return {
    ...triggerTemplateStatus({ id: latest.id, version: latest.version }),
    applied: true,
    entry: project.entry,
    next: "Review and deploy this project to update the Trigger in Hub.",
  };
}
