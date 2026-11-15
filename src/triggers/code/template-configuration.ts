import { createHash } from "node:crypto";
import { artifactDigest } from "./contract.js";
import {
  triggerTemplateManifest,
  triggerTemplateSource,
  type TriggerTemplate,
} from "./templates.js";
import { buildStoredTrigger, editTriggerSources, triggerConfiguration } from "./editable-source.js";
import { SourceValues } from "./source-values.js";
import type { TriggerConfigurationChange } from "./configuration-types.js";

/** The original project baseline is retained so web-created Triggers can use CLI upgrades. */
function baseline(template: TriggerTemplate, name: string) {
  const base = triggerTemplateSource(template, name);
  return (
    JSON.stringify(
      {
        format: "miko-trigger-template-v1",
        template: { id: template.id, version: template.version },
        name,
        entrypoint: "trigger.ts",
        base,
        baseDigest: createHash("sha256").update(base).digest("hex"),
      },
      null,
      2,
    ) + "\n"
  );
}

export function templateConfigurationProject(template: TriggerTemplate) {
  const body = {
    format: "trigger-code-v1" as const,
    manifest: triggerTemplateManifest(template),
    code: "template-preview",
    entrypoint: "trigger.ts",
    sources: [
      { path: "trigger.ts", content: triggerTemplateSource(template) },
      { path: ".miko-template.json", content: baseline(template, template.id) },
    ],
  };
  const artifact = { ...body, digest: artifactDigest(body) };
  return { artifact, configuration: triggerConfiguration(artifact) };
}

export function templateConfigurationPreview(template: TriggerTemplate) {
  const { artifact, configuration } = templateConfigurationProject(template);
  const reader = new SourceValues(artifact.sources);
  const definition = reader.definition(artifact.entrypoint);
  if (!reader.object(definition)) throw new Error("Template definition unavailable");
  const node = definition.value.get("name")!.node;
  const nameField = {
    id: "template-name",
    label: "Name",
    group: "Workflow",
    kind: "text" as const,
    value: template.id,
    path: "trigger.ts",
    line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1,
    start: node.getStart(),
    end: node.getEnd(),
  };
  return {
    id: "new",
    revisionId: "new",
    version: 0,
    artifact: {
      manifest: artifact.manifest,
      sources: artifact.sources,
      entrypoint: artifact.entrypoint,
      digest: artifact.digest,
    },
    configuration: { ...configuration, fields: [nameField, ...configuration.fields] },
  };
}

export async function configureTemplate(
  template: TriggerTemplate,
  name: string,
  changes: TriggerConfigurationChange[],
) {
  const { artifact } = templateConfigurationProject(template);
  let sources = editTriggerSources(artifact, changes);
  const reader = new SourceValues(sources);
  const definition = reader.definition("trigger.ts");
  if (!reader.object(definition)) throw new Error("Template definition unavailable");
  const nameNode = definition.value.get("name")!.node;
  sources = sources.map((file) => {
    if (file.path === "trigger.ts")
      return {
        ...file,
        content:
          file.content.slice(0, nameNode.getStart()) +
          JSON.stringify(name) +
          file.content.slice(nameNode.getEnd()),
      };
    if (file.path === ".miko-template.json") return { ...file, content: baseline(template, name) };
    return file;
  });
  return buildStoredTrigger(sources, "trigger.ts");
}
