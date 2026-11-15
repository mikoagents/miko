import { Cpu, History, Sparkles } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/app/page.js";
import { RecordListSkeleton } from "../components/app/record-list.js";
import { Section, SectionGrid } from "../components/app/section.js";
import { StatGrid, StatTileSkeleton } from "../components/app/stat-tile.js";
import { Disclosure } from "../components/app/disclosure.js";
import { Skeleton } from "../components/ui/skeleton.js";

export const HOME_DESCRIPTION = "What to do next, and what has run.";

export function HomeLoading() {
  const [checklistOpen, setChecklistOpen] = useState(true);
  return (
    <div aria-busy="true" aria-label="Loading overview">
      <PageHeader title="Home" description={HOME_DESCRIPTION} />
      <Section>
        <Disclosure
          id="get-started-loading"
          title="Get started"
          description="Connect an app and a daemon, create a trigger, and run it."
          open={checklistOpen}
          onOpenChange={setChecklistOpen}
          status={CHECKLIST_STATUS}
        >
          <RecordListSkeleton label="Get started" rows={4} />
        </Disclosure>
      </Section>
      <Section title="Overview" description="The last 7 days.">
        <StatGrid>
          <StatTileSkeleton label="Runs" icon={History} />
          <StatTileSkeleton label="Daemons connected" icon={Cpu} />
          <StatTileSkeleton label="Agents used" icon={Sparkles} />
        </StatGrid>
      </Section>
      <SectionGrid>
        <Section title="Recent runs">
          <RecordListSkeleton label="Recent runs" rows={5} />
        </Section>
        <Section title="Daemons">
          <RecordListSkeleton label="Daemons" rows={2} />
        </Section>
      </SectionGrid>
    </div>
  );
}

const CHECKLIST_STATUS = <Skeleton className="h-5 w-20 rounded-full" />;
