/** One run on Home, addressed by the trigger that owns it. Code and legacy runs use different loaders. */
export const ACTIVITY_RUN_ROUTE = "/o/$organizationSlug/home/$triggerId/$runId" as const;

export type ActivityRunView = "conversation" | "details" | "diagnostics";

export interface ActivityRunSearch {
  /** Which of the three views is showing. Omitted means Run details, the first tab. */
  view?: ActivityRunView;
  /** The run is a code Trigger run, so the page reads that record rather than a legacy one. */
  code?: true;
}

const VIEWS: readonly ActivityRunView[] = ["details", "conversation", "diagnostics"];

export function activityRunSearch(code: boolean, view?: ActivityRunView): ActivityRunSearch {
  const search: ActivityRunSearch = {};
  if (code) search.code = true;
  if (view !== undefined && view !== "details") search.view = view;
  return search;
}

/** Drop anything the address bar did not actually ask for, instead of failing the page. */
export function validateActivityRunSearch(search: Record<string, unknown>): ActivityRunSearch {
  const view = VIEWS.find((item) => item === search["view"]);
  return {
    ...(view === undefined ? {} : { view }),
    ...(search["code"] === true || search["code"] === "true" ? { code: true } : {}),
  };
}
