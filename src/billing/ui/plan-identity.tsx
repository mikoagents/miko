import { Button } from "../../components/ui/button.js";
import { StatusPill } from "../../components/app/status-pill.js";
import { NO_PLAN, type SubscriptionSummary } from "./presentation.js";

export function PlanIdentity({
  summary,
  action,
  onOpenPicker,
}: {
  summary: SubscriptionSummary;
  action: string | null;
  onOpenPicker: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="grid min-w-0 gap-2">
        {/* The pill is wrapped because a bare inline-flex stretches to the full grid track. */}
        {summary.status !== null && (
          <div>
            <StatusPill tone={summary.status.tone}>{summary.status.label}</StatusPill>
          </div>
        )}
        <p className="text-2xl">{summary.planName ?? NO_PLAN}</p>
        {summary.detail !== null && (
          <p className="text-sm text-muted-foreground">{summary.detail}</p>
        )}
      </div>
      {action !== null && (
        <Button type="button" onClick={onOpenPicker}>
          {action}
        </Button>
      )}
    </div>
  );
}
