import { Pipeline } from "../../components/app/pipeline.js";
import type { TriggerManifest } from "./sdk.js";

export function TriggerPipelineView({ manifest }: { manifest: TriggerManifest }) {
  return <Pipeline definition={manifest.pipeline} label={`Pipeline for ${manifest.name}`} />;
}
