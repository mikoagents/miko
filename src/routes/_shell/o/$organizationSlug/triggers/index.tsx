import { TriggersLoading } from "../../../../../triggers/panel-loading.js";
import { createFileRoute } from "@tanstack/react-router";
import { TriggersPanel } from "../../../../../triggers/panel.js";

export const Route = createFileRoute("/_shell/o/$organizationSlug/triggers/")({
  staticData: { loadingComponent: TriggersLoading },
  component: TriggersPanel,
});
