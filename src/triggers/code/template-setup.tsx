/* oxlint-disable eslint-plugin-react-perf/jsx-no-new-array-as-prop -- input requirements are projected into shared summary rows */
import { CopyBlock } from "../../components/app/copy-field.js";
import { SummaryPanel } from "../../components/app/summary-panel.js";
import type { TriggerTemplate } from "./templates.js";

export function TemplateSetup({ template, hubUrl }: { template: TriggerTemplate; hubUrl: string }) {
  return (
    <div className="grid gap-3 text-sm text-muted-foreground">
      <p>
        {template.requiresRepository
          ? "Configure the GitHub connection, repository and daemon directory. Repository access is declared in grants."
          : "Use an automation workspace on your daemon. This template does not grant repository access or create a git worktree."}
        {template.multipleRepositories
          ? " Configure each repository and directory in settings.repositories; PR events choose the matching target."
          : ""}
      </p>
      <p>
        {template.trigger.label}. You can also use Run now with the event context needed by this
        task.
        {template.requiresMemory
          ? " Named memory files persist in this Trigger’s durable state."
          : " Persistent memory is disabled for this template."}
      </p>
      {template.requiredMcp.length === 0 ? null : (
        <p>
          Configure these MCP tools on the selected daemon/provider:{" "}
          {template.requiredMcp.join(", ")}. The workflow uses that provider’s native tools and
          options.
        </p>
      )}
      {template.setupNotes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      <SummaryPanel
        label="Template inputs"
        layout="facts"
        rows={template.inputs.map((input) => ({ label: input.label, value: input.description }))}
      />
      {template.notifySlack ? (
        <p>
          Give the Slack bot <code>chat:write</code> and access to the destination. Save its token
          outside the project as <code>SLACK_BOT_TOKEN</code> in the runner secrets file.
          {template.slackMode === "thread"
            ? " Replies use the triggering message’s thread timestamp."
            : ""}
        </p>
      ) : (
        <p>
          Reports stay in the run summary or the GitHub thread requested by the original prompt. No
          Slack bot token is required.
        </p>
      )}
      {template.trigger.transport === "bridge" ? (
        <TemplateEventBridge template={template} hubUrl={hubUrl} />
      ) : null}
    </div>
  );
}

function TemplateEventBridge({ template, hubUrl }: { template: TriggerTemplate; hubUrl: string }) {
  const eventType = template.trigger.events[0];
  if (eventType === undefined) return null;
  const payload =
    template.trigger.kind === "slack_message"
      ? {
          event: {
            channel: "your-slack-channel-id",
            ts: "1700000000.000001",
            text: "The incoming message",
            thread_ts: "1700000000.000001",
          },
        }
      : {
          data: {
            id: "provider-item-id",
            title: "The triggering issue or incident",
            url: "https://example.com/item",
          },
        };
  const value = JSON.stringify(
    {
      id: "provider-delivery-id",
      source: template.trigger.source,
      type: eventType.replace(".*", ".created"),
      receivedAt: "2026-01-01T00:00:00.000Z",
      payload,
    },
    null,
    2,
  );
  return (
    <div className="grid gap-3">
      <p>
        Connect the provider through a verified event relay. Forward its original payload to the
        authenticated Hub event API using the source/type below and a key with Dispatch runs
        permission. Use each delivery’s real ID and timestamp.
        {template.trigger.kind === "slack_message"
          ? " Hub’s built-in Slack connection receives mentions; monitoring every channel message requires this relay. Bot messages are excluded to prevent reply loops."
          : ""}
      </p>
      <CopyBlock label="Forwarded event example" action="Copy event" value={value} />
      <CopyBlock
        label="Forward the event to Hub"
        action="Copy command"
        value={`miko trigger event ${template.id} --input-file ./trigger-event.json --url ${hubUrl} --token-file ./hub.key`}
      />
    </div>
  );
}
