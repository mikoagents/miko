import { TriggersLoading } from "../../../../../triggers/panel-loading.js";
import { createFileRoute } from "@tanstack/react-router";
import { TriggersPanel } from "../../../../../triggers/panel.js";

export const Route = createFileRoute("/_shell/o/$organizationSlug/triggers/")({
  staticData: { loadingComponent: TriggersLoading },
  validateSearch: (search: Record<string, unknown>): { scope?: "explore" } =>
    search["scope"] === "explore" ? { scope: "explore" } : {},
  component: TriggersPanel,
});
