import { TriggerRouteLoading } from "../../../../../triggers/code/detail-loading.js";
import { createFileRoute } from "@tanstack/react-router";
import { TriggerDetailPanel } from "../../../../../triggers/code/detail-panel.js";
import { NewTriggerPanel } from "../../../../../triggers/code/new-panel.js";
import { findTriggerTemplate } from "../../../../../triggers/code/templates.js";
import { TriggerTemplatePreviewPanel } from "../../../../../triggers/code/template-preview-panel.js";
import { TemplateConfigurationPanel } from "../../../../../triggers/code/template-configuration-panel.js";

export const Route = createFileRoute("/_shell/o/$organizationSlug/triggers/$triggerId")({
  staticData: { loadingComponent: TriggerRouteLoading, breadcrumb: "Trigger" },
  validateSearch: (search: Record<string, unknown>): { template?: string; setup?: boolean } => {
    const template =
      typeof search["template"] === "string" ? findTriggerTemplate(search["template"]) : undefined;
    return template === undefined
      ? {}
      : { template: template.id, ...(search["setup"] === true ? { setup: true } : {}) };
  },
  component: TriggerRoute,
});

function TriggerRoute() {
  const { triggerId } = Route.useParams();
  const { template, setup } = Route.useSearch();
  const selected = findTriggerTemplate(template);
  if (triggerId === "new" && selected !== undefined && setup !== true)
    return <TriggerTemplatePreviewPanel key={selected.id} template={selected} />;
  if (triggerId === "new" && selected !== undefined)
    return <TemplateConfigurationPanel key={selected.id} template={selected} />;
  return triggerId === "new" ? (
    <NewTriggerPanel key={template ?? "blank"} templateId={template} />
  ) : (
    <TriggerDetailPanel key={triggerId} triggerId={triggerId} />
  );
}
