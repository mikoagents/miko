import { Card } from "../../components/app/card.js";
import { PageHeader } from "../../components/app/page.js";
import { Section } from "../../components/app/section.js";
import { ContentSkeleton } from "../../components/app/loading.js";
import { PlanIdentity } from "./plan-identity.js";
import { FeatureList, type SubscriptionSummary } from "./presentation.js";

const SAMPLE_PLAN: SubscriptionSummary = {
  planName: "Organization plan",
  detail: "Your current billing period and allowance.",
  status: { tone: "neutral", label: "Active" },
};

const SAMPLE_FEATURES = [
  { key: "runs", label: "Monthly agent runs", tooltip: null },
  { key: "seats", label: "Team seats included", tooltip: null },
  { key: "workflows", label: "Workflow automation", tooltip: null },
  { key: "support", label: "Included plan features", tooltip: null },
];

export function BillingLoading({ name }: { name?: string }) {
  return (
    <>
      <PageHeader
        title="Billing"
        description={
          name === undefined
            ? "Plan and billing for this organization."
            : `Plan and billing for ${name}.`
        }
      />
      <Section title="Plan">
        <ContentSkeleton loading label="Loading plan">
          <Card>
            <PlanIdentity summary={SAMPLE_PLAN} action={null} onOpenPicker={ignorePlanAction} />
            <FeatureList features={SAMPLE_FEATURES} className="sm:grid-cols-2 sm:gap-x-6" />
            <p className="text-sm text-muted-foreground">Monthly agent run allowance.</p>
          </Card>
        </ContentSkeleton>
      </Section>
    </>
  );
}

function ignorePlanAction() {}
