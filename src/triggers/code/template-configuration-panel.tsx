/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop, eslint-plugin-react-perf/jsx-no-new-object-as-prop -- template setup carries typed navigation and creation parameters */
import { useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { Card } from "../../components/app/card.js";
import { FailureAlert } from "../../components/app/failure-alert.js";
import { PageHeader } from "../../components/app/page.js";
import { Section } from "../../components/app/section.js";
import { Button } from "../../components/ui/button.js";
import { useRouteTenant } from "../../projects/context.js";
import { useSnapshotQuery } from "../../queries/index.js";
import { TriggerConfigurationEditor } from "./configuration-editor.js";
import { TemplateConfigurationSkeleton } from "./detail-loading.js";
import { TriggerPipelineView } from "./pipeline-view.js";
import { triggerTemplatePreview } from "./template-functions.js";
import type { TriggerTemplate } from "./templates.js";

export function TemplateConfigurationPanel({ template }: { template: TriggerTemplate }) {
  const { organization, capabilities } = useRouteTenant();
  const load = useServerFn(triggerTemplatePreview);
  const navigate = useNavigate();
  const preview = useSnapshotQuery({
    queryKey: ["trigger-template-preview", organization.slug, template.id, template.version],
    queryFn: () => load({ data: { organizationSlug: organization.slug, templateId: template.id } }),
  });
  const cancel = useCallback(() => {
    void navigate({
      to: "/o/$organizationSlug/triggers/$triggerId",
      params: { organizationSlug: organization.slug, triggerId: "new" },
      search: { template: template.id },
    });
  }, [navigate, organization.slug, template.id]);
  const created = useCallback(
    (deployed: { triggerId: string } | null) => {
      if (deployed)
        void navigate({
          to: "/o/$organizationSlug/triggers/$triggerId",
          params: { organizationSlug: organization.slug, triggerId: deployed.triggerId },
        });
    },
    [navigate, organization.slug],
  );
  if (preview.status === "pending") return <TemplateConfigurationSkeleton template={template} />;
  return (
    <>
      <PageHeader title="New trigger" description={template.description}>
        <Button variant="outline" asChild>
          <Link
            to="/o/$organizationSlug/triggers"
            params={{ organizationSlug: organization.slug }}
            search={{ scope: "explore" }}
          >
            Choose another template
          </Link>
        </Button>
      </PageHeader>
      {preview.status === "error" ? (
        <FailureAlert
          title="Template unavailable"
          error={preview.error}
          fallback="Hub couldn't load this template."
          onRetry={preview.refetch}
        />
      ) : (
        <>
          <Section title="Pipeline">
            <TriggerPipelineView manifest={preview.data.manifest} />
          </Section>
          {template.requiredMcp.length > 0 ||
          template.notifySlack ||
          template.trigger.transport === "bridge" ? (
            <Section title="Integration requirements">
              <Card density="compact">
                {template.requiredMcp.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Configure {template.requiredMcp.join(", ")} MCP tools on the selected daemon and
                    provider.
                  </p>
                ) : null}
                {template.notifySlack ? (
                  <p className="text-sm text-muted-foreground">
                    Slack delivery needs a bot with chat:write and channel access. Supply
                    SLACK_BOT_TOKEN through your runner’s secrets file.
                  </p>
                ) : null}
                {template.trigger.transport === "bridge" ? (
                  <p className="text-sm text-muted-foreground">
                    Automatic {template.trigger.source} events need an event relay to Hub. Manual
                    runs remain available.
                  </p>
                ) : null}
                {template.setupNotes.map((note) => (
                  <p key={note} className="text-sm text-muted-foreground">
                    {note}
                  </p>
                ))}
              </Card>
            </Section>
          ) : null}
          {capabilities.manageResources ? (
            <TriggerConfigurationEditor
              current={preview.data.project}
              organizationSlug={organization.slug}
              onClose={cancel}
              onSaved={created}
              creation={{ templateId: template.id }}
            />
          ) : null}
        </>
      )}
    </>
  );
}
