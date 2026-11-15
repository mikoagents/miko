import type {
  TriggerConfigurationChange,
  TriggerConfigurationField,
} from "./configuration-types.js";

export function configurationInput(field: TriggerConfigurationField) {
  if (field.kind === "list" && Array.isArray(field.value))
    return field.value.map((value) => (typeof value === "string" ? value : "")).join("\n");
  return typeof field.value === "object"
    ? JSON.stringify(field.value, null, 2)
    : String(field.value);
}

export function configurationChanges(
  fields: TriggerConfigurationField[],
  values: Record<string, string>,
) {
  const changes: TriggerConfigurationChange[] = [];
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const input = values[field.id] ?? configurationInput(field);
    if (input === configurationInput(field)) continue;
    try {
      let value: TriggerConfigurationChange["value"] = input;
      if (field.kind === "list")
        value = input
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
      if (field.kind === "number") {
        if (input.trim() === "" || !Number.isFinite(Number(input)))
          throw new Error("Enter a number.");
        value = Number(input);
      }
      if (field.kind === "boolean") value = input === "true";
      if (field.kind === "json" || field.kind === "agent" || field.kind === "events") {
        const parsed: unknown = JSON.parse(input);
        if (
          parsed === null ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) !== Array.isArray(field.value)
        )
          throw new Error("Keep the same object or list structure.");
        // JSON.parse supplies JSON values, with no executable syntax.
        if (!isConfigurationValue(parsed)) throw new Error("Enter valid JSON values.");
        value = parsed;
      }
      if (JSON.stringify(value) !== JSON.stringify(field.value))
        changes.push({ id: field.id, value });
    } catch (error) {
      errors[field.id] = error instanceof Error ? error.message : "Enter valid JSON.";
    }
  }
  return { changes, errors };
}

/** Exact replacements are also used for the live preview; compilation stays server-side. */
export function configurationSourcePreview(
  sources: { path: string; content: string }[],
  fields: TriggerConfigurationField[],
  changes: TriggerConfigurationChange[],
) {
  return sources.flatMap((source) => {
    const replacements = changes
      .flatMap((change) => {
        const field = fields.find((candidate) => candidate.id === change.id);
        return field?.path === source.path ? [{ field, value: change.value }] : [];
      })
      .sort((a, b) => b.field.start - a.field.start);
    if (replacements.length === 0) return [];
    let content = source.content;
    for (const { field, value } of replacements)
      content =
        content.slice(0, field.start) +
        JSON.stringify(value, null, typeof value === "object" ? 2 : undefined) +
        content.slice(field.end);
    return [{ path: source.path, before: source.content, content }];
  });
}

export function isConfigurationValue(value: unknown): value is TriggerConfigurationChange["value"] {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isConfigurationValue);
  return typeof value === "object" && Object.values(value).every(isConfigurationValue);
}
