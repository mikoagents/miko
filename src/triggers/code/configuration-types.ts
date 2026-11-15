import type { TriggerValue } from "./sdk.js";

export interface TriggerConfigurationField {
  id: string;
  label: string;
  group: string;
  kind: "text" | "multiline" | "number" | "boolean" | "list" | "json" | "agent" | "events";
  value: TriggerValue;
  path: string;
  line: number;
  start: number;
  end: number;
}
export interface TriggerConfiguration {
  fields: TriggerConfigurationField[];
  unavailable: string | null;
}
export interface TriggerConfigurationChange {
  id: string;
  value: TriggerValue;
}
