import { HomeLoading } from "../../../../home/panel-loading.js";
import { createFileRoute } from "@tanstack/react-router";
import { HomePanel } from "../../../../home/panel.js";

export const Route = createFileRoute("/_shell/o/$organizationSlug/home")({
  staticData: { loadingComponent: HomeLoading, breadcrumb: "Home" },
  component: HomePanel,
});
