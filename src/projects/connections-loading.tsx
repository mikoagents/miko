/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop -- each provider owns its glyph slot */
import { Card } from "../components/app/card.js";
import { RecordListSkeleton } from "../components/app/record-list.js";
import { PageHeader } from "../components/app/page.js";
import { Section } from "../components/app/section.js";
import { ProviderGlyph } from "../connections/provider-glyph.js";

export const CONNECTIONS_DESCRIPTION = "Organization provider connections.";

export const CONNECTION_PROVIDERS = ["github", "discord", "slack", "linear"] as const;

export function providerLabel(provider: (typeof CONNECTION_PROVIDERS)[number]) {
  if (provider === "github") return "GitHub";
  if (provider === "discord") return "Discord";
  return provider === "slack" ? "Slack" : "Linear";
}

export function ConnectionsLoading() {
  return (
    <>
      <PageHeader title="Connections" description={CONNECTIONS_DESCRIPTION} />
      <Section>
        {CONNECTION_PROVIDERS.map((provider) => (
          <Card
            key={provider}
            title={providerLabel(provider)}
            icon={<ProviderGlyph provider={provider} />}
          >
            <RecordListSkeleton label={`${providerLabel(provider)} connections`} rows={1} />
          </Card>
        ))}
      </Section>
    </>
  );
}
