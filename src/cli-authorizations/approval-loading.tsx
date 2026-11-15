/* oxlint-disable eslint-plugin-react-perf/jsx-no-new-array-as-prop -- the approval placeholder composes its two labelled facts */
import { AuthCard } from "../components/app/auth-layout.js";
import { FormActions } from "../components/app/form-actions.js";
import { SummaryPanel, type SummaryRow } from "../components/app/summary-panel.js";
import { Skeleton } from "../components/ui/skeleton.js";

export const RECIPIENT_LABEL = "Organization receiving access";

export const EXPIRY_LABEL = "Request expires";

/** Known approval labels stay visible while the request and decision controls load. */
export function CliLoginLoading({ rows }: { rows?: readonly SummaryRow[] }) {
  return (
    <div className="mx-auto w-full max-w-lg">
      <div aria-busy="true">
        <AuthCard
          focusOnMount={false}
          titleId="approval-loading-heading"
          title="Approve CLI login"
          description="Grant this terminal durable access to one organization."
        >
          <SummaryPanel
            label="CLI login"
            rows={
              rows ?? [
                { label: RECIPIENT_LABEL, value: <Skeleton className="h-5 w-40" /> },
                { label: EXPIRY_LABEL, value: <Skeleton className="h-5 w-24" /> },
              ]
            }
          />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <FormActions>
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-40" />
          </FormActions>
        </AuthCard>
      </div>
    </div>
  );
}
