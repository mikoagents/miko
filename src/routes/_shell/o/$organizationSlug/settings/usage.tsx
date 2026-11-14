import { UsageLoading } from "../../../../../usage/panel-loading.js";
import { createFileRoute } from "@tanstack/react-router";
import { OrganizationUsagePanel } from "../../../../../usage/panel.js";
export const Route = createFileRoute("/_shell/o/$organizationSlug/settings/usage")({
  staticData: { loadingComponent: UsageLoading, breadcrumb: "Usage" },
  component: OrganizationUsagePanel,
});
