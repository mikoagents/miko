import { Card } from "../../components/app/card.js";
import { FieldSkeleton } from "../../components/app/form-field.js";
import { DisclosureSkeleton } from "../../components/app/disclosure.js";

export function TriggerSourceSkeleton() {
  return (
    <Card title="Source code">
      <div className="grid min-w-0 gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <FieldSkeleton label="Code revision" description={false} />
        </div>
        <SourceFilesSkeleton />
      </div>
    </Card>
  );
}

export function SourceFilesSkeleton() {
  return (
    <div className="grid min-w-0 gap-3">
      <DisclosureSkeleton variant="file" />
      <DisclosureSkeleton variant="file" />
    </div>
  );
}
