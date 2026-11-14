import { PanelSkeleton } from "../components/app/loading.js";
import { useMatches } from "@tanstack/react-router";

export function RouteLoading() {
  const Loading = useMatches({
    select: (matches) =>
      matches.flatMap(({ staticData }) => staticData.loadingComponent ?? []).at(-1),
    structuralSharing: false,
  });
  return Loading === undefined ? <PanelSkeleton /> : <Loading />;
}

export function RoutePending() {
  return (
    <section aria-label="Loading page" aria-busy="true">
      <RouteLoading />
    </section>
  );
}
