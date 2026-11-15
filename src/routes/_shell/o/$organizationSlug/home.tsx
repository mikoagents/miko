import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/o/$organizationSlug/home")({
  staticData: { breadcrumb: "Home" },
  component: Outlet,
});
