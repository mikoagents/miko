/* oxlint-disable eslint-plugin-react-perf/jsx-no-new-array-as-prop, eslint-plugin-react-perf/jsx-no-jsx-as-prop -- template provenance composes summary values and status */
import { useState } from "react";
import { Card } from "../../components/app/card.js";
import { CopyBlock, InlineCode } from "../../components/app/copy-field.js";
import { Disclosure } from "../../components/app/disclosure.js";
import { Section } from "../../components/app/section.js";
import { StatusPill, type StatusTone } from "../../components/app/status-pill.js";
import { SummaryPanel } from "../../components/app/summary-panel.js";
import type { TriggerTemplateReference } from "./sdk.js";
import { triggerTemplateStatus } from "./templates.js";

const STATUS = {
  current: { label: "Up to date", tone: "success" },
  update_available: { label: "Update available", tone: "warning" },
  newer: { label: "Newer than this Hub", tone: "neutral" },
  unknown: { label: "Template unavailable", tone: "neutral" },
} satisfies Record<string, { label: string; tone: StatusTone }>;

export function TriggerTemplateVersion({
  reference,
  canManage,
}: {
  reference: TriggerTemplateReference;
  canManage: boolean;
}) {
  const template = triggerTemplateStatus(reference);
  const status = STATUS[template.status];
  const [open, setOpen] = useState(false);
  const entry = `./${template.id}/trigger.ts`;
  const previewName = `trigger.upgrade-${template.latestVersion ?? reference.version}.ts`;
  return (
    <Section title="Template">
      <Card density="compact">
        <SummaryPanel
          label="Template version"
          layout="facts"
          rows={[
            { label: "Template", value: template.name },
            {
              label: "Installed version",
              value: <InlineCode>{template.installedVersion}</InlineCode>,
            },
            {
              label: "Latest version",
              value: template.latestVersion ?? "Not available in this Hub",
            },
            { label: "Status", value: <StatusPill tone={status.tone}>{status.label}</StatusPill> },
          ]}
        />
        {template.sourceUrl === null ? null : (
          <p className="text-xs text-muted-foreground">
            Adapted from{" "}
            <a href={template.sourceUrl} target="_blank" rel="noreferrer" className="text-link">
              Cursor Automations
            </a>
            . Versions track Miko Hub’s adaptation. Changes to your Trigger stay in your project.
          </p>
        )}
        {canManage && template.status !== "unknown" && template.status !== "newer" ? (
          <Disclosure
            id="trigger-template-upgrade"
            title="Check and upgrade the local project"
            open={open}
            onOpenChange={setOpen}
          >
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                Use the CLI shipped with this Hub version. In your local project, the first command
                checks versions; the second writes a preview while preserving local changes. Adjust
                the path if your project directory has a different name.
              </p>
              <CopyBlock
                label="Check and preview the upgrade"
                action="Copy commands"
                value={`miko trigger template-status ${entry}\nmiko trigger upgrade ${entry}`}
              />
              <p className="text-sm text-muted-foreground">
                Review <code>{previewName}</code> and resolve any merge conflicts before applying.
                Keep <code>.miko-template.json</code> with the project; it contains the original
                template baseline. Upgrades take effect in Hub after you deploy again.
              </p>
              <CopyBlock
                label="Apply the reviewed upgrade"
                action="Copy command"
                value={`miko trigger upgrade ${entry} --apply ./${template.id}/${previewName}`}
              />
            </div>
          </Disclosure>
        ) : null}
      </Card>
    </Section>
  );
}
