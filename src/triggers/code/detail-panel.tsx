import { TriggerDetailSkeleton } from "./detail-loading.js";
/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop -- workflow cards compose their source and status controls */
import { useCallback, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { FailureAlert, NoticeAlert } from "../../components/app/failure-alert.js";
import { FormDialog } from "../../components/app/form-dialog.js";
import { FormField } from "../../components/app/form-field.js";
import { PageHeader } from "../../components/app/page.js";
import { Section } from "../../components/app/section.js";
import { Button } from "../../components/ui/button.js";
import { useSnapshotQuery } from "../../queries/index.js";
import { useRouteTenant } from "../../projects/context.js";
import { codeTriggerDetail, codeTriggerAction, type CodeTriggerDetail } from "../functions.js";
import { TriggerRunHistory } from "../activity-panel.js";
import { TriggerSource } from "./source-view.js";
import { TriggerSettings } from "./settings-view.js";
import { TriggerPipelineView } from "./pipeline-view.js";
import { TriggerTemplateVersion } from "./template-view.js";
import { TriggerConfigurationEditor } from "./configuration-editor.js";

type Action = "run" | "enable" | "disable";
const ACTION_FEEDBACK = {
  run: { title: "Run queued", message: "Follow its progress in Run history below." },
  enable: { title: "Trigger enabled", message: "Matching events can start new runs." },
  disable: {
    title: "Trigger disabled",
    message: "New runs are paused. Existing runs can still finish.",
  },
};
const ENABLED_STATUS = { label: "Enabled", tone: "success" } as const;
const DISABLED_STATUS = { label: "Disabled", tone: "neutral" } as const;

export function TriggerDetailPanel({ triggerId }: { triggerId: string }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [contextError, setContextError] = useState<string | undefined>();
  const edit = useCallback(() => {
    setSaved(false);
    setEditing(true);
  }, []);
  const closeEditor = useCallback(() => setEditing(false), []);
  const savedConfiguration = useCallback(() => {
    setEditing(false);
    setSaved(true);
  }, []);
  const { organization } = useRouteTenant();
  const organizationSlug = organization.slug;
  const load = useServerFn(codeTriggerDetail);
  const act = useServerFn(codeTriggerAction);
  const client = useQueryClient();
  const source = useSnapshotQuery({
    queryKey: ["trigger-code", organizationSlug, triggerId],
    queryFn: () => load({ data: { organizationSlug, triggerId } }),
  });
  const mutation = useMutation({
    mutationFn: async (request: { action: Action; payload?: unknown }) => {
      const result = await act({
        data: {
          organizationSlug,
          triggerId,
          action: request.action,
          ...(request.payload === undefined ? {} : { payload: request.payload }),
        },
      });
      if (result.status === "error") throw new Error(result.error.message);
      return result;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["triggers", organizationSlug] }),
        client.invalidateQueries({ queryKey: ["trigger-code", organizationSlug, triggerId] }),
        client.invalidateQueries({ queryKey: ["trigger-history", organizationSlug, triggerId] }),
      ]);
    },
  });
  const requestAction = useCallback(
    (action: Action) => {
      const subscriptions =
        source.status === "success" ? source.data.artifact?.manifest.on : undefined;
      if (action === "run" && needsManualContext(subscriptions)) {
        setContextError(undefined);
        setRunOpen(true);
        return;
      }
      mutation.mutate({ action });
    },
    [mutation, source.data, source.status],
  );
  const submitContext = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const value = new FormData(event.currentTarget).get("context");
      const raw = typeof value === "string" ? value.trim() : "";
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        setContextError("Event context must be a JSON object.");
        return;
      }
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        setContextError("Event context must be a JSON object.");
        return;
      }
      setContextError(undefined);
      setRunOpen(false);
      mutation.mutate({ action: "run", payload });
    },
    [mutation],
  );
  const closeRun = useCallback((open: boolean) => {
    setRunOpen(open);
    if (!open) setContextError(undefined);
  }, []);
  if (source.status === "pending") return <TriggerDetailSkeleton />;
  if (source.status === "error")
    return (
      <>
        <PageHeader title="Trigger" />
        <FailureAlert
          title="Trigger unavailable"
          error={source.error}
          fallback="Hub couldn't load this Trigger."
          onRetry={source.refetch}
        />
      </>
    );
  const data = source.data;
  const manifest = data.artifact?.manifest;
  const feedback =
    mutation.isSuccess && mutation.variables ? ACTION_FEEDBACK[mutation.variables.action] : null;
  return (
    <>
      <PageHeader
        title={data.name}
        description={
          manifest?.description ??
          "Matching events start your workflow. Results and logs are saved with each run."
        }
        status={data.enabled ? ENABLED_STATUS : DISABLED_STATUS}
      >
        {data.canManage && manifest ? (
          <Button
            variant="outline"
            disabled={editing || data.configuration?.unavailable !== null}
            onClick={edit}
          >
            Edit configuration
          </Button>
        ) : null}
        {data.canManage && manifest && !editing ? (
          <TriggerActions
            enabled={data.enabled}
            busy={mutation.isPending}
            onAction={requestAction}
          />
        ) : null}
      </PageHeader>
      <ManualRunDialog
        open={runOpen}
        busy={mutation.isPending}
        error={contextError}
        onOpenChange={closeRun}
        onSubmit={submitContext}
      />
      {mutation.error ? (
        <FailureAlert
          standalone
          title="Trigger action failed"
          error={mutation.error}
          fallback="Try again."
        />
      ) : null}
      {feedback ? (
        <NoticeAlert standalone tone="success" title={feedback.title}>
          {feedback.message}
        </NoticeAlert>
      ) : null}
      {saved ? (
        <NoticeAlert standalone tone="success" title="Configuration saved">
          Project source and configuration now use the new revision.
        </NoticeAlert>
      ) : null}
      {manifest ? (
        <TriggerDefinitionSettings
          data={data}
          editing={editing}
          organizationSlug={organizationSlug}
          onClose={closeEditor}
          onSaved={savedConfiguration}
        />
      ) : (
        <NoticeAlert standalone tone="neutral" title="Previous configuration">
          Deploy a code project with the same name to update this Trigger and keep its history.
        </NoticeAlert>
      )}
      <Section title="Run history">
        <TriggerRunHistory organizationSlug={organizationSlug} triggerId={triggerId} />
      </Section>
      <Section title="Source code">
        <TriggerSource organizationSlug={organizationSlug} current={data} />
      </Section>
    </>
  );
}

function needsManualContext(subscriptions: readonly { source: string }[] | undefined): boolean {
  return (subscriptions ?? []).some(
    (subscription) => subscription.source !== "manual" && subscription.source !== "schedule",
  );
}

function ManualRunDialog({
  open,
  busy,
  error,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  error: string | undefined;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Run with event context"
      description="Paste the event this Trigger should read. The CLI input file is unchanged."
      label="Run with event context"
      submitLabel="Run now"
      busy={busy}
      onSubmit={onSubmit}
    >
      <FormField
        id="trigger-run-context"
        label="Event context"
        description="JSON object sent as this run's payload. Include the repository and pull request number, or the Slack channel and thread timestamp, when the template requires them."
        {...(error === undefined ? {} : { error })}
        kind="multiline"
        name="context"
        required
      />
    </FormDialog>
  );
}

function TriggerActions({
  enabled,
  busy,
  onAction,
}: {
  enabled: boolean;
  busy: boolean;
  onAction: (action: Action) => void;
}) {
  const toggle = useCallback(() => onAction(enabled ? "disable" : "enable"), [enabled, onAction]);
  const run = useCallback(() => onAction("run"), [onAction]);
  return (
    <>
      <Button variant="outline" disabled={busy} onClick={toggle}>
        {enabled ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        {enabled ? "Disable" : "Enable"}
      </Button>
      <Button disabled={!enabled || busy} onClick={run}>
        <Play aria-hidden="true" />
        Run now
      </Button>
    </>
  );
}

function TriggerDefinitionSettings({
  data,
  editing,
  organizationSlug,
  onClose,
  onSaved,
}: {
  data: CodeTriggerDetail;
  editing: boolean;
  organizationSlug: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const manifest = data.artifact!.manifest;
  return (
    <>
      {" "}
      <Section title="Pipeline">
        <TriggerPipelineView manifest={manifest} />
      </Section>
      {manifest.template === undefined ? null : (
        <TriggerTemplateVersion reference={manifest.template} canManage={data.canManage} />
      )}
      {editing ? (
        <TriggerConfigurationEditor
          current={data}
          organizationSlug={organizationSlug}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : (
        <TriggerSettings manifest={manifest} inspection={data.inspection} />
      )}
      {data.canManage && data.configuration?.unavailable ? (
        <NoticeAlert standalone tone="neutral" title="Edit this project in code">
          {data.configuration.unavailable}
        </NoticeAlert>
      ) : null}
    </>
  );
}
