import { ActivityRunLoading } from "../../../../../../triggers/activity-loading.js";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { useRouteTenant } from "../../../../../../projects/context.js";
import { ActivityRunPage } from "../../../../../../triggers/activity-run-page.js";
import {
  validateActivityRunSearch,
  type ActivityRunView,
} from "../../../../../../triggers/activity-run.js";

export const Route = createFileRoute("/_shell/o/$organizationSlug/home/$triggerId/$runId")({
  staticData: { loadingComponent: ActivityRunLoading, breadcrumb: "Run" },
  validateSearch: validateActivityRunSearch,
  component: ActivityRunRoute,
});

function ActivityRunRoute() {
  const { organization } = useRouteTenant();
  const { triggerId, runId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: ActivityRunView = search.view ?? "details";
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);
  const onViewChange = useCallback(
    (next: string) => {
      const selected: ActivityRunView =
        next === "conversation" || next === "diagnostics" ? next : "details";
      void navigate({
        search: {
          ...(search.code ? { code: true } : {}),
          ...(selected === "details" ? {} : { view: selected }),
        },
        replace: true,
        resetScroll: true,
      });
    },
    [navigate, search.code],
  );
  return (
    <ActivityRunPage
      key={`${triggerId}:${runId}:${String(search.code === true)}`}
      organizationSlug={organization.slug}
      triggerId={triggerId}
      runId={runId}
      code={search.code === true}
      view={view}
      onViewChange={onViewChange}
    />
  );
}
