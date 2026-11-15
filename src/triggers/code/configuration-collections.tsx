/* oxlint-disable eslint-plugin-react-perf/jsx-no-new-function-as-prop, eslint-plugin-react/no-array-index-key -- collection fields bind their row index while keeping changes in one source expression */
import { FormField } from "../../components/app/form-field.js";
import { Button } from "../../components/ui/button.js";
import type { TriggerValue } from "./sdk.js";
import { isConfigurationValue } from "./configuration-draft.js";

type Row = Record<string, TriggerValue>;
function rowsFrom(value: string): Row[] {
  try {
    const rows: unknown = JSON.parse(value);
    if (!Array.isArray(rows)) return [];
    return rows.filter(
      (row): row is Row =>
        row !== null && typeof row === "object" && !Array.isArray(row) && isConfigurationValue(row),
    );
  } catch {
    return [];
  }
}

/** Literal subscription arrays can grow without flattening code-derived subscriptions. */
export function EventConfiguration({
  id,
  value: input,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const rows = rowsFrom(input);
  const update = (index: number, key: string, value: TriggerValue) => {
    const next = rows.map((row, position) => (position === index ? { ...row, [key]: value } : row));
    if (key === "source") {
      const row = next[index];
      if (!row) return;
      if (value === "schedule")
        row["recurrence"] = {
          timezone: "UTC",
          start: "1970-01-01T00:00:00",
          rule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0",
        };
      else delete row["recurrence"];
      if (value === "schedule" || value === "manual") {
        delete row["connection"];
        delete row["resource"];
        row["event"] = value === "schedule" ? "tick" : "run";
      }
    }
    onChange(JSON.stringify(next, null, 2));
  };
  return (
    <div className="grid min-w-0 gap-6 md:col-span-2">
      {rows.map((row, index) => {
        const label = `Event ${index + 1}`;
        const recurrence = row["recurrence"];
        const schedule =
          recurrence !== null && typeof recurrence === "object" && !Array.isArray(recurrence)
            ? recurrence
            : null;
        return (
          <div key={`${id}-${index}`} className="grid min-w-0 gap-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm">{label}</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={rows.length === 1}
                onClick={() =>
                  onChange(
                    JSON.stringify(
                      rows.filter((_, position) => position !== index),
                      null,
                      2,
                    ),
                  )
                }
              >
                Remove event {index + 1}
              </Button>
            </div>
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <FormField
                id={`${id}-${index}-source`}
                label={`${label} source`}
                kind="text"
                name="source"
                value={text(row["source"])}
                onChange={(value) => update(index, "source", value)}
              />
              <FormField
                id={`${id}-${index}-types`}
                label={`${label} types`}
                kind="multiline"
                name="event"
                value={
                  Array.isArray(row["event"])
                    ? row["event"].map(text).join("\n")
                    : text(row["event"])
                }
                description="One event pattern per line."
                onChange={(value) => {
                  const types = value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean);
                  update(index, "event", types.length === 1 ? (types[0] ?? "") : types);
                }}
              />
              {row["source"] === "manual" || row["source"] === "schedule" ? null : (
                <>
                  <FormField
                    id={`${id}-${index}-connection`}
                    label={`${label} connection`}
                    kind="text"
                    name="connection"
                    value={text(row["connection"])}
                    onChange={(value) => update(index, "connection", value)}
                  />
                  <FormField
                    id={`${id}-${index}-resource`}
                    label={`${label} repository or resource`}
                    kind="text"
                    name="resource"
                    value={text(row["resource"])}
                    onChange={(value) => update(index, "resource", value)}
                  />
                </>
              )}
              {schedule ? (
                <>
                  <FormField
                    id={`${id}-${index}-timezone`}
                    label={`${label} timezone`}
                    kind="text"
                    name="timezone"
                    value={text(schedule["timezone"])}
                    onChange={(value) =>
                      update(index, "recurrence", { ...schedule, timezone: value })
                    }
                  />
                  <FormField
                    id={`${id}-${index}-start`}
                    label={`${label} start`}
                    kind="text"
                    name="start"
                    value={text(schedule["start"])}
                    onChange={(value) => update(index, "recurrence", { ...schedule, start: value })}
                  />
                  <FormField
                    id={`${id}-${index}-rule`}
                    label={`${label} recurrence rule`}
                    kind="text"
                    name="rule"
                    value={text(schedule["rule"])}
                    onChange={(value) => update(index, "recurrence", { ...schedule, rule: value })}
                  />
                </>
              ) : null}
            </div>
          </div>
        );
      })}
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onChange(JSON.stringify([...rows, { source: "manual", event: "run" }], null, 2))
          }
        >
          Add event
        </Button>
      </div>
    </div>
  );
}

export function RepositoryConfiguration({
  id,
  value: input,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const rows = rowsFrom(input);
  const update = (index: number, key: string, value: string) =>
    onChange(
      JSON.stringify(
        rows.map((row, position) => (position === index ? { ...row, [key]: value } : row)),
        null,
        2,
      ),
    );
  return (
    <div className="grid min-w-0 gap-6 md:col-span-2">
      {rows.map((row, index) => (
        <div key={`${id}-${index}`} className="grid min-w-0 gap-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">Repository {index + 1}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={rows.length === 1}
              onClick={() =>
                onChange(
                  JSON.stringify(
                    rows.filter((_, position) => position !== index),
                    null,
                    2,
                  ),
                )
              }
            >
              Remove repository {index + 1}
            </Button>
          </div>
          <div className="grid min-w-0 gap-4 md:grid-cols-3">
            {[
              ["name", "Repository"],
              ["cwd", "Working directory"],
              ["branch", "Branch"],
            ].map(([key, label]) => (
              <FormField
                key={key}
                id={`${id}-${index}-${key}`}
                label={`${label} ${index + 1}`}
                name={key ?? ""}
                kind="text"
                value={text(row[key ?? ""])}
                onChange={(value) => update(index, key ?? "", value)}
              />
            ))}
          </div>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onChange(JSON.stringify([...rows, { name: "", cwd: "", branch: "main" }], null, 2))
          }
        >
          Add repository
        </Button>
      </div>
    </div>
  );
}

function text(value: TriggerValue | undefined) {
  return typeof value === "string" ? value : "";
}
