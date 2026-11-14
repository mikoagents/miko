import { PageHeader } from "../components/app/page.js";
import { Section } from "../components/app/section.js";
import { Skeleton } from "../components/ui/skeleton.js";

export const PICKER_TITLE = "Organization";

export const PICKER_DESCRIPTION = "Pick an organization to manage its entitlements.";

export function OrganizationPickerLoading() {
  return (
    <Section title={PICKER_TITLE} description={PICKER_DESCRIPTION}>
      <div aria-busy="true" aria-label="Loading organizations">
        <Skeleton className="h-8 w-full max-w-sm" />
      </div>
    </Section>
  );
}

export const OPERATOR_DESCRIPTION =
  "View and edit any organization's entitlements. Instance operators only.";
export function OperatorLoading() {
  return (
    <>
      <PageHeader title="Operator" description={OPERATOR_DESCRIPTION} />
      <OrganizationPickerLoading />
    </>
  );
}
