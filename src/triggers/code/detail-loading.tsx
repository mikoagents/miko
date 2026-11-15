import { Card, CardSkeleton } from "../../components/app/card.js";
import { useMatches } from "@tanstack/react-router";
import { Steps } from "../../components/app/steps.js";
import { PageHeader } from "../../components/app/page.js";
import { PageHeaderSkeleton } from "../../components/app/page.js";
import { SummaryPanelSkeleton } from "../../components/app/summary-panel.js";
import { FlowDiagramSkeleton } from "../../components/app/flow-diagram.js";
import { Section } from "../../components/app/section.js";
import { TriggerRunHistorySkeleton } from "../activity-loading.js";
import { TriggerSourceSkeleton } from "./source-loading.js";

const CONFIGURATION_LABELS = ["Events", "Runs on", "Agent calls", "Access"];

export function TriggerRouteLoading() {
  const creating = useMatches({
    select: (matches) => {
      const params = matches.at(-1)!.params;
      return "triggerId" in params && params.triggerId === "new";
    },
  });
  if (!creating) return <TriggerDetailSkeleton />;
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

export function TriggerDetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading Trigger">
      <PageHeaderSkeleton description={false} />
      <Section>
        <Card title="How it runs">
          <FlowDiagramSkeleton />
        </Card>
      </Section>
      <Section>
        <Card title="Configuration">
          <SummaryPanelSkeleton
            label="Trigger configuration"
            labels={CONFIGURATION_LABELS}
            layout="groups"
          />
        </Card>
      </Section>
      <Section title="Run history" description="Open a run to see its result, steps and logs.">
        <TriggerRunHistorySkeleton />
      </Section>
      <Section>
        <TriggerSourceSkeleton />
      </Section>
    </div>
  );
}
