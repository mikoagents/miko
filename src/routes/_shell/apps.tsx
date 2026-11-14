import { AppsLoading } from "../../provider-applications/panel-loading.js";
import { createFileRoute } from "@tanstack/react-router";
import { AppsPanel } from "../../provider-applications/panel.js";

export const Route = createFileRoute("/_shell/apps")({
  staticData: { loadingComponent: AppsLoading, breadcrumb: "Apps", instance: true },
  component: AppsPanel,
});
