import { DaemonsLoading } from "../../../../daemons/panel-loading.js";
import { createFileRoute } from "@tanstack/react-router";
import { OrganizationDaemonsPanel } from "../../../../projects/panels.js";
export const Route = createFileRoute("/_shell/o/$organizationSlug/daemons")({
  staticData: { loadingComponent: DaemonsLoading, breadcrumb: "Daemons" },
  component: OrganizationDaemonsPanel,
});
