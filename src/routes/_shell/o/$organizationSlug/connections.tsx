import { ConnectionsLoading } from "../../../../projects/connections-loading.js";
import { createFileRoute } from "@tanstack/react-router";
import { OrganizationConnectionsPanel } from "../../../../projects/panels.js";
export const Route = createFileRoute("/_shell/o/$organizationSlug/connections")({
  staticData: { loadingComponent: ConnectionsLoading, breadcrumb: "Connections" },
  component: OrganizationConnectionsPanel,
});
