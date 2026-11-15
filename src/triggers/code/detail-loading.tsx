import { Card, CardSkeleton } from "../../components/app/card.js";
import { useMatches } from "@tanstack/react-router";
import { Steps } from "../../components/app/steps.js";
import { PageHeader } from "../../components/app/page.js";
import { PageHeaderSkeleton } from "../../components/app/page.js";
import { RecordListSkeleton } from "../../components/app/record-list.js";
import { PipelineSkeleton } from "../../components/app/pipeline.js";
import { Section } from "../../components/app/section.js";
import { FieldSkeleton } from "../../components/app/form-field.js";
import { TriggerRunHistorySkeleton } from "../activity-loading.js";
import { TriggerSourceSkeleton } from "./source-loading.js";
import { findTriggerTemplate, type TriggerTemplate } from "./templates.js";

const CONFIGURATION_SECTIONS = [
  { title: "Events and access", rows: 2 },
  { title: "Runs on", rows: 2 },
  { title: "Agent calls", rows: 1 },
];

export function TriggerRouteLoading() {
  const templateId = useMatches({
    select: (matches) => {
      const search: unknown = matches.at(-1)!.search;
      return typeof search === "object" &&
        search !== null &&
        "template" in search &&
        typeof search.template === "string"
        ? search.template
        : undefined;
    },
  });
  const template = findTriggerTemplate(templateId);
  const setup = useMatches({
    select: (matches) => {
      const search: unknown = matches.at(-1)?.search;
      return (
        typeof search === "object" && search !== null && "setup" in search && search.setup === true
      );
    },
  });
  const creating = useMatches({
    select: (matches) => {
      const params = matches.at(-1)!.params;
      return "triggerId" in params && params.triggerId === "new";
    },
  });
  if (!creating) return <TriggerDetailSkeleton />;
  if (template !== undefined && !setup)
    return <TriggerTemplatePreviewSkeleton template={template} />;
  if (template !== undefined) return <TemplateConfigurationSkeleton template={template} />;
  return (
    <>
      <PageHeader
        title="New trigger"
        description="Choose when it runs. Write what it does. Deploy it to Hub."
      />
      <Steps>
        <CardSkeleton
          title="Write your workflow"
          description="Start with a working script, then add your conditions, loops and API calls."
          lines={5}
        />
        <CardSkeleton
          title="Connect to your Hub"
          description="Use an organization API key for deployment and a runner to execute your scripts."
          lines={5}
        />
        <CardSkeleton
          title="Deploy and try it"
          description="Check the script, deploy it, then open your Trigger and choose Run now."
          lines={5}
        />
      </Steps>
    </>
  );
}

export function TemplateConfigurationSkeleton({ template }: { template: TriggerTemplate }) {
  return (
    <div aria-busy="true" aria-label="Loading template configuration">
      <PageHeader title="New trigger" description={template.description} />
      <Section title="Pipeline">
        <PipelineSkeleton />
      </Section>
      <Section title="Configure trigger">
        <Card density="compact">
          <FieldSkeleton label="Name" />
          <FieldSkeleton label="Runner" />
          <FieldSkeleton label="Daemon" />
          <FieldSkeleton label="Working directory" />
        </Card>
      </Section>
    </div>
  );
}

export function TriggerTemplatePreviewSkeleton({ template }: { template: TriggerTemplate }) {
  return (
    <div aria-busy="true" aria-label="Loading template preview">
      <PageHeader title={template.name} description={template.description} />
      <Section title="Pipeline">
        <PipelineSkeleton />
      </Section>
      {CONFIGURATION_SECTIONS.map(({ title, rows }) => (
        <Section key={title} title={title}>
          <Card density="compact">
            <RecordListSkeleton label={title} rows={rows} />
          </Card>
        </Section>
      ))}
      <Section title="Prompt and source">
        <CardSkeleton lines={2} />
      </Section>
    </div>
  );
}

export function TriggerDetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading Trigger">
      <PageHeaderSkeleton />
      <Section title="Pipeline">
        <PipelineSkeleton />
      </Section>
      {CONFIGURATION_SECTIONS.map(({ title, rows }) => (
        <Section key={title} title={title}>
          <Card density="compact">
            <RecordListSkeleton label={title} rows={rows} />
          </Card>
        </Section>
      ))}
      <Section title="Run history">
        <TriggerRunHistorySkeleton />
      </Section>
      <Section title="Source code">
        <TriggerSourceSkeleton />
      </Section>
    </div>
  );
}
