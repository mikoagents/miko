import { TriggerRouteLoading } from "../../../../../triggers/code/detail-loading.js";
import { createFileRoute } from "@tanstack/react-router";
import { TriggerDetailPanel } from "../../../../../triggers/code/detail-panel.js";
import { NewTriggerPanel } from "../../../../../triggers/code/new-panel.js";

export const Route = createFileRoute("/_shell/o/$organizationSlug/triggers/$triggerId")({
  staticData: { loadingComponent: TriggerRouteLoading, breadcrumb: "Trigger" },
  component: TriggerRoute,
});

function TriggerRoute() {
  const { triggerId } = Route.useParams();
  return triggerId === "new" ? (
    <NewTriggerPanel />
  ) : (
    <TriggerDetailPanel key={triggerId} triggerId={triggerId} />
  );
}
