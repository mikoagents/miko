/* oxlint-disable eslint-plugin-react-perf/jsx-no-new-function-as-prop, eslint-plugin-react-perf/jsx-no-new-array-as-prop, eslint-plugin-react-perf/jsx-no-jsx-as-prop -- each generated field binds its source identity and shared control options */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "../../components/app/card.js";
import { CheckboxField } from "../../components/app/checkbox-field.js";
import { Combobox, type ComboboxOption } from "../../components/app/combobox.js";
import { CopyBlock } from "../../components/app/copy-field.js";
import { Disclosure } from "../../components/app/disclosure.js";
import { FailureAlert, NoticeAlert } from "../../components/app/failure-alert.js";
import { FormActions } from "../../components/app/form-actions.js";
import { FormField } from "../../components/app/form-field.js";
import { Section } from "../../components/app/section.js";
import { Button } from "../../components/ui/button.js";
import { useSnapshotQuery } from "../../queries/index.js";
import type { CodeTriggerDetail } from "../functions.js";
import { codeConfigurationResources, configureCodeTrigger } from "./configuration-functions.js";
import {
  configurationChanges,
  configurationInput,
  configurationSourcePreview,
  isConfigurationValue,
} from "./configuration-draft.js";
import type { TriggerConfigurationField } from "./configuration-types.js";
import { EventConfiguration, RepositoryConfiguration } from "./configuration-collections.js";

interface Resources {
  daemons: ComboboxOption[];
  github: ComboboxOption[];
  linear: ComboboxOption[];
  repositories: ComboboxOption[];
}

export function TriggerConfigurationEditor({
  current,
  organizationSlug,
  onClose,
  onSaved,
}: {
  current: Pick<CodeTriggerDetail, "id" | "revisionId" | "version" | "artifact" | "configuration">;
  organizationSlug: string;
  onClose: () => void;
  onSaved: (deployed: { triggerId: string } | null) => void;
}) {
  // Hold the accepted editing baseline even if a background detail refresh discovers a new revision.
  const [baseline] = useState(current);
  const fields = baseline.configuration?.fields ?? EMPTY_FIELDS;
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const [validated, setValidated] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(true);
  const loadResources = useServerFn(codeConfigurationResources);
  const configure = useServerFn(configureCodeTrigger);
  const client = useQueryClient();
  const resources = useSnapshotQuery({
    queryKey: ["trigger-configuration-resources", organizationSlug],
    queryFn: () => loadResources({ data: { organizationSlug } }),
  });
  const draft = useMemo(() => configurationChanges(fields, values), [fields, values]);
  const changed = Object.keys(values).some(
    (id) => values[id] !== configurationInput(fields.find((field) => field.id === id)!),
  );
  const sources = useMemo(
    () => configurationSourcePreview(baseline.artifact?.sources ?? [], fields, draft.changes),
    [baseline.artifact, draft.changes, fields],
  );
  const groups = [...new Set(fields.map((field) => field.group))];
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (changed) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed]);
  const changeField = useCallback((id: string, value: string) => {
    setValues((previous) => ({ ...previous, [id]: value }));
    setValidated(false);
    setFailure(null);
  }, []);
  const submit = async (save: boolean) => {
    if (busy || Object.keys(draft.errors).length > 0 || draft.changes.length === 0) return;
    setBusy(true);
    setFailure(null);
    setValidated(false);
    try {
      const result = await configure({
        data: {
          organizationSlug,
          triggerId: baseline.id,
          revisionId: baseline.revisionId,
          changes: draft.changes,
          save,
        },
      });
      if (result.status === "error") throw new Error(result.error.message);
      if (save) {
        await Promise.all([
          client.invalidateQueries({ queryKey: ["trigger-code", organizationSlug, baseline.id] }),
          client.invalidateQueries({ queryKey: ["triggers", organizationSlug] }),
          client.invalidateQueries({
            queryKey: ["trigger-code-revision", organizationSlug, baseline.id],
          }),
        ]);
        onSaved(result.data.deployed);
      } else setValidated(true);
    } catch (error) {
      setFailure(error instanceof Error ? error : new Error("Hub couldn't update this Trigger."));
    } finally {
      setBusy(false);
    }
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit(true);
  };
  return (
    <form onSubmit={save} aria-label="Trigger configuration">
      <Section
        title="Configure trigger"
        description="Changes update the project source and create a revision when you save."
      >
        <NoticeAlert tone="neutral" title={`Editing revision ${baseline.version}`}>
          Shared settings update every place that references them. Values computed when a run starts
          stay in the workflow code.
        </NoticeAlert>
        {current.revisionId === baseline.revisionId ? null : (
          <NoticeAlert tone="neutral" title="A newer revision is available">
            Copy your changes and reload this page before saving.
          </NoticeAlert>
        )}
        {failure ? (
          <FailureAlert
            title="Configuration not saved"
            error={failure}
            fallback="Check the configuration and try again."
            focusOnArrival
          />
        ) : null}
        {validated ? (
          <NoticeAlert tone="success" title="Configuration valid">
            Source compiles and Hub has validated the configured access. Save changes to apply this
            revision.
          </NoticeAlert>
        ) : null}
        {resources.status === "error" ? (
          <FailureAlert
            title="Resource choices unavailable"
            error={resources.error}
            fallback="Enter the resource names directly or try again."
            onRetry={resources.refetch}
          />
        ) : null}
      </Section>
      <fieldset disabled={busy} className="min-w-0">
        {groups.map((group) => (
          <Section key={group} title={group}>
            <Card density="compact">
              <div className="grid min-w-0 gap-4 md:grid-cols-2">
                {fields
                  .filter((field) => field.group === group)
                  .map((field) => (
                    <ConfigurationField
                      key={field.id}
                      field={field}
                      value={values[field.id] ?? configurationInput(field)}
                      onChange={changeField}
                      error={draft.errors[field.id]}
                      resources={resources.data}
                    />
                  ))}
              </div>
            </Card>
          </Section>
        ))}
      </fieldset>
      {sources.length > 0 ? (
        <Section title="Source changes">
          <Card density="compact">
            <Disclosure
              id="trigger-configuration-source"
              title={`${sources.length} ${sources.length === 1 ? "file" : "files"} changed`}
              open={sourceOpen}
              onOpenChange={setSourceOpen}
            >
              {sources.map((file) => (
                <SourceChange key={file.path} {...file} />
              ))}
            </Disclosure>
          </Card>
        </Section>
      ) : null}
      <FormActions pinned>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || draft.changes.length === 0 || Object.keys(draft.errors).length > 0}
          onClick={() => void submit(false)}
        >
          Check configuration
        </Button>
        <Button
          type="submit"
          disabled={
            busy ||
            draft.changes.length === 0 ||
            Object.keys(draft.errors).length > 0 ||
            current.revisionId !== baseline.revisionId
          }
        >
          {busy ? "Checking…" : "Save changes"}
        </Button>
      </FormActions>
    </form>
  );
}

function ConfigurationField({
  field,
  value: input,
  onChange,
  error,
  resources,
}: {
  field: TriggerConfigurationField;
  value: string;
  onChange: (id: string, value: string) => void;
  error: string | undefined;
  resources: Resources | undefined;
}) {
  const update = useCallback((value: string) => onChange(field.id, value), [field.id, onChange]);
  const select = useCallback((option: ComboboxOption) => update(option.value), [update]);
  const tick = useCallback((checked: boolean) => update(String(checked)), [update]);
  const options = resourceOptions(field, resources);
  if (field.kind === "boolean")
    return (
      <CheckboxField id={field.id} label={field.label} checked={input === "true"} onChange={tick} />
    );
  if (field.kind === "agent")
    return <NativeAgentOptions field={field} value={input} onChange={update} error={error} />;
  if (field.kind === "events")
    return <EventConfiguration id={field.id} value={input} onChange={update} />;
  if (field.label === "Repositories" && field.kind === "json")
    return <RepositoryConfiguration id={field.id} value={input} onChange={update} />;
  const multiline = ["multiline", "list", "json"].includes(field.kind);
  return (
    <div className={multiline ? "min-w-0 md:col-span-2" : "min-w-0"}>
      {options ? (
        <FormField id={field.id} label={field.label}>
          {(control) => (
            <Combobox
              {...control}
              value={input}
              options={options}
              placeholder={`Choose ${field.label.toLowerCase()}`}
              empty="No resources available"
              onChange={select}
            />
          )}
        </FormField>
      ) : (
        <FormField
          id={field.id}
          label={field.label}
          kind={fieldInputKind(field)}
          name={field.id}
          value={input}
          onChange={update}
          {...(error === undefined ? {} : { error })}
          {...fieldDescription(field)}
        />
      )}
    </div>
  );
}

function NativeAgentOptions({
  field,
  value: input,
  onChange,
  error,
}: {
  field: TriggerConfigurationField;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
}) {
  const [advanced, setAdvanced] = useState(false);
  let options: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(input);
    if (
      isConfigurationValue(parsed) &&
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    )
      options = parsed;
  } catch {
    /* Keep invalid advanced input available for correction. */
  }
  const change = (key: string, value: string) => {
    const updated = { ...options };
    if (value === "" && key !== "provider") delete updated[key];
    else updated[key] = value;
    onChange(JSON.stringify(updated, null, 2));
  };
  return (
    <div className="grid min-w-0 gap-4 md:col-span-2">
      <div className="grid min-w-0 gap-4 md:grid-cols-3">
        {[
          ...(Object.hasOwn(options, "provider") ? [["provider", "Provider"]] : []),
          ["model", "Model"],
          ["mode", "Permission mode"],
          ["thinkingOptionId", "Thinking"],
        ].map(([key, label]) => (
          <FormField
            key={key}
            id={`${field.id}-${key}`}
            label={label ?? ""}
            kind="text"
            name={key ?? ""}
            value={typeof options[key ?? ""] === "string" ? String(options[key ?? ""]) : ""}
            onChange={(value) => change(key ?? "", value)}
            placeholder="Provider default"
          />
        ))}
      </div>
      <Disclosure
        id={`${field.id}-native`}
        title="Native provider options"
        open={advanced}
        onOpenChange={setAdvanced}
      >
        <FormField
          id={field.id}
          label={field.label}
          kind="multiline"
          name={field.id}
          value={input}
          onChange={onChange}
          {...(error === undefined ? {} : { error })}
          description="Native options are passed through to your provider."
        />
      </Disclosure>
    </div>
  );
}

function SourceChange({
  path,
  before,
  content,
}: {
  path: string;
  before: string;
  content: string;
}) {
  const [original, setOriginal] = useState(false);
  return (
    <div className="grid min-w-0 gap-3">
      <CopyBlock label={`${path} updated`} action="Copy updated code" value={content} />
      <Disclosure
        id={`configuration-original-${path}`}
        title={`Compare with original ${path}`}
        open={original}
        onOpenChange={setOriginal}
      >
        {original ? (
          <CopyBlock label={`${path} original`} action="Copy original code" value={before} />
        ) : null}
      </Disclosure>
    </div>
  );
}

const EMPTY_FIELDS: TriggerConfigurationField[] = [];

function resourceOptions(field: TriggerConfigurationField, resources: Resources | undefined) {
  if (field.label.endsWith("Daemon")) return resources?.daemons;
  if (field.label.endsWith("GitHub connection")) return resources?.github;
  if (field.label.endsWith("Linear connection")) return resources?.linear;
  if (field.label === "Repository") return resources?.repositories;
  return undefined;
}
function fieldInputKind(field: TriggerConfigurationField) {
  if (["multiline", "list", "json"].includes(field.kind)) return "multiline" as const;
  return field.kind === "number" ? ("number" as const) : ("text" as const);
}
function fieldDescription(field: TriggerConfigurationField) {
  if (field.kind === "list") return { description: "One value per line." };
  if (field.kind === "json")
    return { description: "JSON values, preserved in the project source." };
  return {};
}
