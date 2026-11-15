import { ActivityLoading } from "../../../../triggers/activity-loading.js";
import { createFileRoute } from "@tanstack/react-router";
import { TriggerActivityPanel } from "../../../../triggers/activity-panel.js";

export const Route = createFileRoute("/_shell/o/$organizationSlug/activity")({
  staticData: {
    loadingComponent: ActivityLoading,
    breadcrumb: "Activity",
    projectSection: "activity",
  },
  component: TriggerActivityPanel,
});
