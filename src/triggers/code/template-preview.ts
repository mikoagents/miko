import { TriggerManifestSchema } from "./contract.js";
import { inspectTriggerSources } from "./inspection.js";
import {
  triggerTemplateManifest,
  triggerTemplateSource,
  type TriggerTemplate,
} from "./templates.js";
import { templateConfigurationPreview } from "./template-configuration.js";

/** Inspect trusted built-in source as syntax; never execute a template or operator code in Hub. */
export function templatePreview(template: TriggerTemplate) {
  const source = triggerTemplateSource(template);
  return {
    manifest: TriggerManifestSchema.parse(triggerTemplateManifest(template)),
    inspection: inspectTriggerSources([{ path: "trigger.ts", content: source }], "trigger.ts"),
    project: templateConfigurationPreview(template),
  };
}

export type TemplatePreview = ReturnType<typeof templatePreview>;
