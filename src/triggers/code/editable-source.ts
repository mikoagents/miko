import ts from "typescript";
import { parseDurationMs } from "../../config/compiler.js";
import { TriggerAgentSchema } from "../configuration/schema.js";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { posix } from "node:path";
import {
  artifactDigest,
  CodeAgentOptionsSchema,
  jsonValue,
  ownGrant,
  stableJson,
  TriggerManifestSchema,
  validateArtifact,
  type TriggerArtifact,
} from "./contract.js";
import { SourceValues, unwrap, type SourceValue } from "./source-values.js";
import type {
  TriggerConfiguration,
  TriggerConfigurationChange,
  TriggerConfigurationField,
} from "./configuration-types.js";
import type { TriggerManifest } from "./sdk.js";

/** Forms and source share literal origins, so a setting used in several places is edited once. */
export function triggerConfiguration(artifact: TriggerArtifact): TriggerConfiguration {
  try {
    return { fields: project(artifact).fields, unavailable: null };
  } catch (error) {
    return {
      fields: [],
      unavailable: error instanceof Error ? error.message : "Edit and deploy this project locally.",
    };
  }
}

/* oxlint-disable complexity, max-depth -- source discovery follows nested declarations and call options; edits are bounded by SourceValues */
function project(artifact: TriggerArtifact) {
  const reader = new SourceValues(artifact.sources);
  reader.assertDeclarative();
  const root = reader.definition(artifact.entrypoint);
  const manifest = manifestValue(reader, root);
  if (stableJson(manifest) !== stableJson(artifact.manifest))
    throw new Error(
      "This project's configuration is computed during deployment. Edit and deploy it locally.",
    );
  const nodes = new Map<string, ts.Expression>();
  const fields: TriggerConfigurationField[] = [];
  function add(
    value: SourceValue,
    label: string,
    group: string,
    mode?: TriggerConfigurationField["kind"],
  ) {
    const node = unwrap(value.node);
    if (
      (ts.isArrayLiteralExpression(node) || ts.isObjectLiteralExpression(node)) &&
      !literalData(node)
    )
      return;
    if (
      !reader.complete(value) ||
      !(
        ts.isStringLiteralLike(node) ||
        ts.isNumericLiteral(node) ||
        node.kind === ts.SyntaxKind.TrueKeyword ||
        node.kind === ts.SyntaxKind.FalseKeyword ||
        ts.isArrayLiteralExpression(node) ||
        ts.isObjectLiteralExpression(node)
      )
    )
      return;
    const id = `${reader.path(node)}:${node.getStart()}:${node.getEnd()}`;
    if (nodes.has(id)) return;
    // Do not expose overlapping edits (a shared object may also be used by individual fields).
    for (const previous of nodes.values())
      if (
        previous.getSourceFile() === node.getSourceFile() &&
        previous.getStart() <= node.getStart() &&
        previous.getEnd() >= node.getEnd()
      )
        return;
    const plain = jsonValue(reader.json(value));
    const kind = mode ?? fieldKind(plain, label);
    nodes.set(id, node);
    fields.push({
      id,
      label,
      group,
      kind,
      value: plain,
      path: reader.path(node),
      line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1,
      start: node.getStart(),
      end: node.getEnd(),
    });
  }
  function walk(value: SourceValue, label: string, group: string) {
    if (value.value instanceof Map)
      for (const [key, item] of value.value)
        walk(item, label ? `${label} · ${labelFor(key)}` : labelFor(key), group);
    else if (Array.isArray(value.value) && value.value.some((item) => item.value instanceof Map))
      value.value.forEach((item, index) => walk(item, `${label} ${index + 1}`, group));
    else add(value, label, group);
  }
  // Templates declare their shared settings explicitly. Editing these keeps event scope,
  // credential grants and runtime context in sync, instead of replacing derived expressions.
  for (const file of reader.files)
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (declaration.name.text === "settings") {
          const settings = reader.read(declaration.initializer);
          if (!reader.object(settings)) continue;
          for (const [key, value] of settings.value) {
            const group = settingsGroup(key);
            if (key === "inputs") walk(value, "", group);
            else add(value, labelFor(key), group, key === "agentOptions" ? "agent" : undefined);
          }
        }
        if (declaration.name.text === "originalPrompt")
          add(reader.read(declaration.initializer), "Prompt", "Agent", "multiline");
      }
    }
  for (const file of reader.files) {
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "run" &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === "agent" &&
        node.arguments[1]
      ) {
        const options = reader.read(node.arguments[1]);
        const id = node.arguments[0] && reader.read(node.arguments[0]);
        const group = `Agent · ${typeof id?.value === "string" ? id.value : reader.path(node) + ":" + (file.getLineAndCharacterOfPosition(node.getStart()).line + 1)}`;
        if (reader.object(options))
          for (const key of [
            "agent",
            "prompt",
            "target",
            "maxRuntime",
            "idleTimeout",
            "startupTimeout",
          ])
            if (options.value.has(key)) {
              const option = options.value.get(key)!;
              if (key === "agent" && literalData(unwrap(option.node)) && reader.complete(option))
                add(option, "Provider options", group, "agent");
              else walk(option, key === "agent" ? "" : labelFor(key), group);
            }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  if (reader.object(root))
    for (const [key, value] of root.value) {
      if (key === "description") walk(value, "Description", "Workflow");
      if (key === "runner") walk(value, "Runner", "Execution");
      if (key === "on") {
        if (literalData(unwrap(value.node))) add(value, "Events", "Events", "events");
        else walk(value, "Event", "Events");
      }
      if (key === "limits") walk(value, "", "Limits");
      if (key === "grants" && reader.object(value))
        for (const [type, grant] of value.value)
          walk(
            grant,
            type === "targets" ? "Target" : labelFor(type),
            type === "targets" ? "Execution" : "Access",
          );
    }
  return { reader, fields, nodes };
}

function manifestValue(reader: SourceValues, root: SourceValue) {
  if (!reader.object(root)) throw new Error("The Trigger definition is unavailable.");
  return TriggerManifestSchema.parse(
    Object.fromEntries(
      Array.from(root.value.entries())
        .filter(([key]) => key !== "run")
        .map(([key, value]) => [key, reader.json(value)]),
    ),
  );
}

export function editTriggerSources(
  artifact: TriggerArtifact,
  changes: TriggerConfigurationChange[],
) {
  const { fields, nodes } = project(artifact);
  const edits = new Map<string, { start: number; end: number; content: string }[]>();
  const seen = new Set<string>();
  for (const change of changes) {
    const node = nodes.get(change.id);
    const field = fields.find((candidate) => candidate.id === change.id);
    if (!node || !field || seen.has(change.id))
      throw new Error("Configuration changed. Reload the Trigger before saving.");
    seen.add(change.id);
    const value = jsonValue(change.value);
    if (
      typeof value !== typeof field.value ||
      Array.isArray(value) !== Array.isArray(field.value) ||
      value === null
    )
      throw new Error(`Invalid value for ${field.label}.`);
    if (
      field.kind === "list" &&
      (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    )
      throw new Error(`${field.label} must be a list of strings.`);
    const path = field.path;
    const fileEdits = edits.get(path) ?? [];
    fileEdits.push({
      start: node.getStart(),
      end: node.getEnd(),
      content: JSON.stringify(value, null, typeof value === "object" ? 2 : undefined),
    });
    edits.set(path, fileEdits);
  }
  for (const fileEdits of edits.values()) {
    fileEdits.sort((a, b) => b.start - a.start);
    for (let i = 1; i < fileEdits.length; i++)
      if (fileEdits[i]!.end > fileEdits[i - 1]!.start)
        throw new Error("These settings share source code. Save them separately.");
  }
  return artifact.sources.map((file) => {
    let content = file.content;
    for (const edit of edits.get(file.path) ?? [])
      content = content.slice(0, edit.start) + edit.content + content.slice(edit.end);
    return { ...file, content };
  });
}

/** Rebundle stored files only. No authored code runs, including module-level code. */
export async function configureTriggerArtifact(
  artifact: TriggerArtifact,
  changes: TriggerConfigurationChange[],
) {
  const updated = await buildStoredTrigger(
    editTriggerSources(artifact, changes),
    artifact.entrypoint,
  );
  if (updated.manifest.name !== artifact.manifest.name)
    throw new Error("The Trigger name cannot be changed here.");
  return updated;
}

export async function buildStoredTrigger(
  sources: TriggerArtifact["sources"],
  entrypoint: string | undefined,
) {
  const reader = new SourceValues(sources);
  reader.assertDeclarative();
  const manifest = manifestValue(reader, reader.definition(entrypoint));
  validateAgents(reader, manifest);
  const files = new Map(sources.map((file) => [file.path, file.content]));
  if (!entrypoint || !files.has(entrypoint))
    throw new Error("The project entrypoint is missing. Deploy it with the current CLI first.");
  const localSdk = ["./sdk.js", "./sdk.ts"]
    .map((path) => new URL(path, import.meta.url))
    .find((url) => existsSync(fileURLToPath(url)));
  const sdkUrl = localSdk ?? new URL(import.meta.resolve("@mikoagents/hub/triggers"));
  const sdkExtension = sdkUrl.pathname.endsWith(".ts") ? "ts" : "js";
  const sdkFiles = new Set(["sdk", "sdk-json", "sdk-errors", "sdk-github"]);
  const result = await build({
    entryPoints: [entrypoint],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: "inline",
    banner: {
      js: 'import { createRequire as __hubCreateRequire } from "node:module"; const require = __hubCreateRequire(import.meta.url);',
    },
    plugins: [
      {
        name: "stored-trigger-sources",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === "@mikoagents/hub/triggers")
              return { path: "sdk", namespace: "hub-sdk" };
            if (args.path.startsWith("node:")) return { path: args.path, external: true };
            if (args.namespace === "hub-sdk") {
              const name = posix.basename(args.path).replace(/\.[jt]s$/u, "");
              if (!sdkFiles.has(name)) throw new Error("Unsupported SDK import");
              return { path: name, namespace: "hub-sdk" };
            }
            const base =
              args.kind === "entry-point"
                ? args.path
                : posix.normalize(posix.join(posix.dirname(args.importer), args.path));
            const stem = base.replace(/\.[cm]?jsx?$/u, "");
            const path = [
              base,
              ...[".ts", ".tsx", ".js", ".mts", ".cts", "/index.ts", "/index.js"].map(
                (ext) => stem + ext,
              ),
            ].find((candidate) => files.has(candidate));
            if (!path || (args.kind !== "entry-point" && !args.path.startsWith(".")))
              throw new Error(
                `The stored project does not include ${args.path}. Deploy dependencies locally.`,
              );
            return { path, namespace: "trigger-project" };
          });
          builder.onLoad({ filter: /.*/, namespace: "hub-sdk" }, async (args) => ({
            contents: await readFile(new URL(`./${args.path}.${sdkExtension}`, sdkUrl), "utf8"),
            loader: "ts",
          }));
          builder.onLoad({ filter: /.*/, namespace: "trigger-project" }, (args) => ({
            contents: files.get(args.path)!,
            loader: sourceLoader(args.path),
          }));
        },
      },
    ],
  });
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error("The updated project could not be compiled.");
  const body = { format: "trigger-code-v1" as const, entrypoint, sources, manifest, code };
  return validateArtifact({ ...body, digest: artifactDigest(body) });
}

const LABELS: Record<string, string> = {
  runner: "Runner",
  daemon: "Daemon",
  cwd: "Working directory",
  provider: "Provider",
  agentOptions: "Provider options",
  repository: "Repository",
  repositories: "Repositories",
  connection: "GitHub connection",
  linearConnection: "Linear connection",
  slackChannel: "Slack channel",
  ignoreBotMessages: "Ignore bot messages",
  branch: "Branch",
  event: "Event types",
  source: "Source",
  resource: "Repository or resource",
  recurrence: "Schedule",
  timezone: "Timezone",
  start: "Start",
  rule: "Recurrence rule",
  maxRuntime: "Time limit",
  maxAgentRuns: "Agent call limit",
  idleTimeout: "Idle timeout",
  startupTimeout: "Startup timeout",
  thinkingOptionId: "Thinking",
  model: "Model",
  mode: "Permission mode",
  prompt: "Prompt",
  secrets: "Runner secret names",
};
function labelFor(key: string) {
  return (
    LABELS[key] ??
    key
      .replace(/([a-z])([A-Z])/gu, "$1 $2")
      .replaceAll("_", " ")
      .replace(/^./u, (letter) => letter.toUpperCase())
  );
}

function fieldKind(value: unknown, label: string): TriggerConfigurationField["kind"] {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string")
    return /prompt/iu.test(label) || value.includes("\n") ? "multiline" : "text";
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return "list";
  return "json";
}
function settingsGroup(key: string) {
  if (["runner", "daemon", "cwd", "repositories"].includes(key)) return "Execution";
  if (["provider", "agentOptions"].includes(key)) return "Agent";
  return "Template inputs";
}
function sourceLoader(path: string) {
  if (path.endsWith(".json")) return "json" as const;
  return path.endsWith(".tsx") ? ("tsx" as const) : ("ts" as const);
}
function literalData(node: ts.Expression): boolean {
  if (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
      node.kind,
    )
  )
    return true;
  if (ts.isArrayLiteralExpression(node))
    return node.elements.every((element) => literalData(unwrap(element)));
  return (
    ts.isObjectLiteralExpression(node) &&
    node.properties.every(
      (property) => ts.isPropertyAssignment(property) && literalData(unwrap(property.initializer)),
    )
  );
}

function validateAgents(reader: SourceValues, manifest: TriggerManifest) {
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "run" &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === "agent" &&
      node.arguments[1]
    )
      validateCall(reader, reader.read(node.arguments[1]), manifest);
    ts.forEachChild(node, visit);
  }
  for (const file of reader.files) visit(file);
}

/** Resolved call fields use the same schema, duration and grant rules as a real agent operation. */
function validateCall(reader: SourceValues, options: SourceValue, manifest: TriggerManifest) {
  if (!reader.object(options)) return;
  const known: Record<string, unknown> = {};
  for (const [key, item] of options.value)
    if (reader.complete(item)) known[key] = reader.json(item);
  const parsed = CodeAgentOptionsSchema.partial().parse(known);
  for (const field of ["maxRuntime", "idleTimeout", "startupTimeout"] as const) {
    const value = parsed[field];
    if (value !== undefined) parseDurationMs(value, `agent.${field}`);
  }
  const target =
    parsed.target === undefined ? undefined : ownGrant(manifest.grants.targets, parsed.target);
  if (parsed.target !== undefined && target === undefined)
    throw new Error("Agent target or provider is not granted");
  const provider = resolvedProvider(reader, options, parsed.agent?.provider);
  if (target !== undefined && provider !== undefined && !target.providers.includes(provider))
    throw new Error("Agent target or provider is not granted");
  if (parsed.github !== undefined && ownGrant(manifest.grants.github, parsed.github) === undefined)
    throw new Error("GitHub authority is not granted");
  if (parsed.env !== undefined && target !== undefined)
    for (const [key, value] of Object.entries(parsed.env))
      if (!Object.hasOwn(target.env ?? {}, key) || target.env?.[key] !== value)
        throw new Error("Agent environment must be declared in the target grant");
}

function resolvedProvider(
  reader: SourceValues,
  options: SourceValue,
  complete: string | undefined,
) {
  if (complete !== undefined || !reader.object(options)) return complete;
  const agent = options.value.get("agent");
  if (!agent || !reader.object(agent) || reader.complete(agent)) return complete;
  const known: Record<string, unknown> = {};
  for (const [key, item] of agent.value) if (reader.complete(item)) known[key] = reader.json(item);
  return TriggerAgentSchema.partial().parse(known).provider;
}
