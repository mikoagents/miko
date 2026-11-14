import { PageHeader } from "../components/app/page.js";
import { PROVIDER_GUIDES } from "./guides.js";
import { ProviderSectionLoading } from "./provider-section-loading.js";

export const APPS_DESCRIPTION =
  "The GitHub, Slack, Discord, and Linear apps Hub uses to reach your workspaces.";

export function AppsLoading() {
  return (
    <>
      <PageHeader title="Apps" description={APPS_DESCRIPTION} />
      <OverviewLoading />
    </>
  );
}

export function OverviewLoading() {
  return (
    <div aria-label="Loading your apps" aria-busy="true" className="grid gap-3">
      {PROVIDER_GUIDES.map((guide) => (
        <ProviderSectionLoading key={guide.provider} guide={guide} open={false} />
      ))}
    </div>
  );
}
