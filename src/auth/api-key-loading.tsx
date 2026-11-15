import type { ReactNode } from "react";
import { DataTableSkeleton } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";
import { Section } from "../components/app/section.js";

export const TABLE_COLUMNS = [
  { header: "Name", fill: true, skeleton: { secondary: true } },
  { header: "Prefix" },
  { header: "Scopes", fill: true },
  { header: "Created" },
  { header: "Last used" },
  { header: "Status" },
  { header: "", align: "end" as const },
];

export const CLI_COLUMNS = [
  { header: "Prefix", fill: true },
  { header: "Created" },
  { header: "Last used" },
  { header: "Status" },
  { header: "", align: "end" as const },
];

export const CLI_LOGINS = {
  title: "CLI logins",
  description: "Durable terminal credentials created through browser approval.",
};

export function ApiKeysLoading({ header }: { header?: ReactNode }) {
  return (
    <>
      {header ?? (
        <PageHeader title="API keys" description="Machine access for this organization." />
      )}
      <Section>
        <DataTableSkeleton label="API keys" columns={TABLE_COLUMNS} />
      </Section>
      <Section title={CLI_LOGINS.title} description={CLI_LOGINS.description}>
        <DataTableSkeleton label="CLI logins" columns={CLI_COLUMNS} rows={1} />
      </Section>
    </>
  );
}
