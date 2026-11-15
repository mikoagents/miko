/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop, eslint-plugin-react-perf/jsx-no-new-object-as-prop -- preview actions carry typed tenant and template parameters */
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card } from "../../components/app/card.js";
import { CopyBlock } from "../../components/app/copy-field.js";
import { Disclosure } from "../../components/app/disclosure.js";
import { FailureAlert, NoticeAlert } from "../../components/app/failure-alert.js";
import { PageHeader } from "../../components/app/page.js";
import { Section } from "../../components/app/section.js";
import { Button } from "../../components/ui/button.js";
import { useRouteTenant } from "../../projects/context.js";
import { useSnapshotQuery } from "../../queries/index.js";
import { TriggerTemplatePreviewSkeleton } from "./detail-loading.js";
import { TriggerPipelineView } from "./pipeline-view.js";
import { TriggerSettings } from "./settings-view.js";
import { triggerTemplatePreview } from "./template-functions.js";
import { triggerTemplateSource, type TriggerTemplate } from "./templates.js";

const PREVIEW_STATUS = { label: "Template preview", tone: "neutral" } as const;

export function TriggerTemplatePreviewPanel({ template }: { template: TriggerTemplate }) {
  const { organization, capabilities } = useRouteTenant();
  const load = useServerFn(triggerTemplatePreview);
  const [promptOpen, setPromptOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const preview = useSnapshotQuery({
    queryKey: ["trigger-template-preview", organization.slug, template.id, template.version],
    queryFn: () => load({ data: { organizationSlug: organization.slug, templateId: template.id } }),
  });
  if (preview.status === "pending") return <TriggerTemplatePreviewSkeleton template={template} />;
  return (
    <>
      <PageHeader title={template.name} description={template.description} status={PREVIEW_STATUS}>
        <Button variant="outline" asChild>
          <Link
            to="/o/$organizationSlug/triggers"
            params={{ organizationSlug: organization.slug }}
            search={{ scope: "explore" }}
          >
            Choose another template
          </Link>
        </Button>
        {capabilities.manageResources ? (
          <Button asChild>
            <Link
              to="/o/$organizationSlug/triggers/$triggerId"
              params={{ organizationSlug: organization.slug, triggerId: "new" }}
              search={{ template: template.id, setup: true }}
            >
              Use template
            </Link>
          </Button>
        ) : null}
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
          <NoticeAlert standalone tone="neutral" title="Configure before deploying">
            Runner, daemon, provider and repository values are the template's editable defaults. Use
            template to configure them for your environment.
          </NoticeAlert>
          <TriggerSettings manifest={preview.data.manifest} inspection={preview.data.inspection} />
          {template.requiredMcp.length === 0 && template.trigger.transport !== "bridge" ? null : (
            <Section title="Integration requirements">
              <Card density="compact">
                {template.requiredMcp.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Native MCP tools: {template.requiredMcp.join(", ")}. Configure these with your
                    agent provider.
                  </p>
                ) : null}
                {template.trigger.transport === "bridge" ? (
                  <p className="text-sm text-muted-foreground">
                    This event needs a bridge that explicitly forwards {template.trigger.source}{" "}
                    events to Hub.
                  </p>
                ) : null}
              </Card>
            </Section>
          )}
          <Section title="Prompt and source">
            <Card density="compact">
              <Disclosure
                id="template-preview-prompt"
                title="Read the original prompt"
                open={promptOpen}
                onOpenChange={setPromptOpen}
              >
                <CopyBlock label="Original prompt" action="Copy prompt" value={template.prompt} />
              </Disclosure>
              <Disclosure
                id="template-preview-source"
                title="See the Trigger script"
                open={sourceOpen}
                onOpenChange={setSourceOpen}
              >
                <CopyBlock
                  label="trigger.ts"
                  action="Copy code"
                  value={triggerTemplateSource(template)}
                />
              </Disclosure>
              <p className="text-xs text-muted-foreground">
                Adapted from{" "}
                <a className="text-link" href={template.sourceUrl} target="_blank" rel="noreferrer">
                  Cursor Automations
                </a>
                . Template version {template.version}.
              </p>
            </Card>
          </Section>
        </>
      )}
    </>
  );
}
