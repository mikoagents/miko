import { ACTIVITY_RUN_DESCRIPTION } from "./activity-loading.js";
/* oxlint-disable eslint-plugin-react-perf/jsx-no-new-function-as-prop, eslint-plugin-react-perf/jsx-no-jsx-as-prop -- the view control reports the mode the reader picked */
import { ACTIVITY_VIEWS, ActivityDetail } from "./activity-detail.js";
import { CodeActivityDetail } from "./code/activity-view.js";
import { PageHeader } from "../components/app/page.js";
import { SegmentedControl } from "../components/app/segmented-control.js";
import type { ActivityRunView } from "./activity-run.js";

/** The run a dialog used to hold: one page, three views, the same record underneath. */
export function ActivityRunPage({
  organizationSlug,
  triggerId,
  runId,
  code,
  view,
  onViewChange,
}: {
  organizationSlug: string;
  triggerId: string;
  runId: string;
  code: boolean;
  view: ActivityRunView;
  onViewChange: (view: string) => void;
}) {
  const navigation = (
    <SegmentedControl
      label="Activity view"
      value={view}
      options={ACTIVITY_VIEWS}
      onChange={onViewChange}
    />
  );
  return (
    <>
      <PageHeader title="Activity details" description={ACTIVITY_RUN_DESCRIPTION} />
      <div className="grid gap-6">
        {code ? (
          <CodeActivityDetail
            navigation={navigation}
            organizationSlug={organizationSlug}
            triggerId={triggerId}
            runId={runId}
            view={view}
            onViewChange={onViewChange}
          />
        ) : (
          <>
            {navigation}
            <ActivityDetail
              organizationSlug={organizationSlug}
              triggerId={triggerId}
              runId={runId}
              view={view}
            />
          </>
        )}
      </div>
    </>
  );
}
