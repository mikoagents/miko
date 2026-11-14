import { DataTableSkeleton, type DataColumn } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";
import { Section } from "../components/app/section.js";

export const MEMBER_COLUMNS: readonly DataColumn[] = [
  { header: "Member", fill: true, skeleton: { secondary: true } },
  { header: "Role" },
  { header: "", align: "end" },
];

export const INVITATION_COLUMNS: readonly DataColumn[] = [
  { header: "Invitee", fill: true },
  { header: "Role" },
  { header: "", align: "end" },
];

export function TeamLoading() {
  return (
    <>
      <PageHeader title="Team" description="People with access to this organization." />
      <Section title="Members">
        <DataTableSkeleton label="Members" columns={MEMBER_COLUMNS} />
      </Section>
      <Section title="Pending invitations">
        <DataTableSkeleton label="Pending invitations" columns={INVITATION_COLUMNS} rows={2} />
      </Section>
    </>
  );
}
