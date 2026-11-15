/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop, eslint-plugin-react-perf/jsx-no-new-object-as-prop -- catalog cards compose typed tenant links and task glyphs */
import { Link } from "@tanstack/react-router";
import {
  BellRing,
  BookOpen,
  Bug,
  ChartNoAxesCombined,
  CircleAlert,
  Clock,
  FileText,
  Flag,
  FlaskConical,
  GitPullRequest,
  HeartPulse,
  Mail,
  MessageSquare,
  MonitorCheck,
  ShieldCheck,
  UserRoundPlus,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Card } from "../../components/app/card.js";
import { Section } from "../../components/app/section.js";
import { SearchField, SearchFieldSkeleton } from "../../components/app/search-field.js";
import { EmptyState } from "../../components/app/empty-state.js";
import { ContentSkeleton } from "../../components/app/loading.js";
import { ProviderGlyph } from "../../connections/provider-glyph.js";
import { useRouteTenant } from "../../projects/context.js";
import {
  TRIGGER_TEMPLATES,
  TRIGGER_TEMPLATE_CATEGORIES,
  type TriggerTemplate,
} from "./templates.js";

type CatalogTemplate = (typeof TRIGGER_TEMPLATES)[number];
const EVENT_LABELS: Record<TriggerTemplate["trigger"]["kind"], string> = {
  schedule: "Scheduled",
  pull_request: "PR opened or updated",
  review_comment: "PR review comment",
  ci_failure: "CI failure",
  workflow_failure: "Workflow completed",
  slack_message: "Channel message",
  linear_issue: "Issue created",
  sentry_issue: "Issue event",
  pagerduty_incident: "Incident triggered",
};

const TASK_ICONS: Record<string, LucideIcon> = {
  "daily-digest": Mail,
  "find-vulnerabilities": ShieldCheck,
  "add-test-coverage": FlaskConical,
  "build-healthcheck": HeartPulse,
  "clean-up-feature-flags": Flag,
  "customer-health-monitoring-agent": HeartPulse,
  "environment-doctor": MonitorCheck,
  "find-bugs": Bug,
  "generate-docs": FileText,
  "investigate-datadog-errors": ChartNoAxesCombined,
  "monitor-engineering-invariants": ShieldCheck,
  "prepare-anyone-onboarding-session": UserRoundPlus,
  "product-analytics-agent": ChartNoAxesCombined,
  "product-faq-agent": BookOpen,
  "product-finance-agent": Wallet,
  "scan-codebase-vulnerabilities": ShieldCheck,
  "slack-digest-agent": MessageSquare,
  "sync-perf-test-feature-flags": Flag,
};

export function TriggerTemplateGallery() {
  const { organization } = useRouteTenant();
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      TRIGGER_TEMPLATES.filter((template) =>
        [template.name, template.description, template.trigger.label, ...template.tools]
          .join(" ")
          .toLowerCase()
          .includes(search),
      ),
    [search],
  );
  return (
    <div className="min-w-0">
      <Section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-full min-w-0 @xl/page:w-72">
            <SearchField
              id="search-trigger-templates"
              label="Search templates"
              value={query}
              onChange={setQuery}
            />
          </div>
          <a
            href="https://cursor.com/automations?scope=explore"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            Cursor templates ↗
          </a>
        </div>
        <p className="sr-only" role="status">
          {visible.length} templates
        </p>
      </Section>
      {visible.length === 0 ? (
        <EmptyState
          title="No matching templates"
          description="Try another task, service or tool name."
        />
      ) : null}
      <TemplateSections templates={visible} organizationSlug={organization.slug} />
    </div>
  );
}

export function TriggerTemplateGallerySkeleton() {
  return (
    <div className="min-w-0" aria-busy="true" aria-label="Loading templates">
      <Section>
        <SearchFieldSkeleton />
      </Section>
      <TemplateSections templates={TRIGGER_TEMPLATES} loading />
    </div>
  );
}

function TemplateSections({
  templates,
  organizationSlug,
  loading = false,
}: {
  templates: readonly CatalogTemplate[];
  organizationSlug?: string;
  loading?: boolean;
}) {
  return TRIGGER_TEMPLATE_CATEGORIES.map((category) => {
    const items = templates.filter((template) => template.category === category.value);
    if (items.length === 0) return null;
    return (
      <Section key={category.value} title={category.label}>
        <ContentSkeleton loading={loading} label={`Loading ${category.label} templates`}>
          <div className="grid min-w-0 gap-3 @2xl/page:grid-cols-2 @5xl/page:grid-cols-3 @7xl/page:grid-cols-4">
            {items.map((template) =>
              organizationSlug === undefined ? (
                <TemplateCard key={template.id} template={template} />
              ) : (
                <Link
                  key={template.id}
                  to="/o/$organizationSlug/triggers/$triggerId"
                  params={{ organizationSlug, triggerId: "new" }}
                  search={{ template: template.id }}
                  aria-label={`Preview ${template.name} template`}
                  className="group min-w-0 rounded-xl"
                >
                  <TemplateCard template={template} />
                </Link>
              ),
            )}
          </div>
        </ContentSkeleton>
      </Section>
    );
  });
}

function TemplateCard({ template }: { template: CatalogTemplate }) {
  return (
    <Card
      title={template.name}
      description={template.description}
      density="compact"
      layout="catalog"
      icon={<TemplateGlyph id={template.id} kind={template.trigger.kind} />}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span
          className="flex items-center gap-1.5"
          title={template.schedule?.label ?? template.trigger.label}
        >
          <EventGlyph template={template} />
          {EVENT_LABELS[template.trigger.kind]}
        </span>
        <span aria-hidden="true" className="text-extra-muted-foreground">
          ·
        </span>
        <span className="flex items-center gap-1.5 [&>svg]:size-3.5">
          <ProviderGlyph provider={template.notifySlack ? "slack" : "github"} />
          {template.notifySlack ? "Slack" : "GitHub"}
        </span>
      </div>
    </Card>
  );
}

function EventGlyph({ template }: { template: CatalogTemplate }) {
  const source = template.trigger.source;
  if (source === "github" || source === "linear" || source === "schedule")
    return (
      <span className="flex [&>svg]:size-3.5">
        <ProviderGlyph provider={source} />
      </span>
    );
  if (source === "slack_channel")
    return (
      <span className="flex [&>svg]:size-3.5">
        <ProviderGlyph provider="slack" />
      </span>
    );
  return <Workflow aria-hidden="true" className="size-3.5" />;
}

function TemplateGlyph({ id, kind }: { id: string; kind: TriggerTemplate["trigger"]["kind"] }) {
  const Icon = TASK_ICONS[id];
  if (Icon !== undefined) return <Icon />;
  switch (kind) {
    case "pull_request":
    case "review_comment":
      return <GitPullRequest />;
    case "slack_message":
      return <MessageSquare />;
    case "linear_issue":
      return <ProviderGlyph provider="linear" />;
    case "sentry_issue":
      return <CircleAlert />;
    case "pagerduty_incident":
      return <BellRing />;
    case "ci_failure":
    case "workflow_failure":
      return <Workflow />;
    default:
      return <Clock />;
  }
}
