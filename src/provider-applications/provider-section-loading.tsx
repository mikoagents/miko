/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop -- a provider skeleton composes its glyph and status slots */
import { Disclosure } from "../components/app/disclosure.js";
import { FieldSkeleton } from "../components/app/form-field.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { ProviderGlyph } from "../connections/provider-glyph.js";
import { guideFields, type ProviderGuide } from "./guides.js";

export function ProviderSectionLoading({ guide, open }: { guide: ProviderGuide; open: boolean }) {
  return (
    <div aria-busy="true">
      <Disclosure
        id={guide.provider}
        open={open}
        onOpenChange={ignoreLoadingDisclosureChange}
        media={<ProviderGlyph provider={guide.provider} />}
        title={guide.name}
        description={guide.summary}
        status={<Skeleton className="h-5 w-24 rounded-full" />}
      >
        {/* The page being waited for is a card of instructions beside a card of fields. */}
        <div className="grid gap-4">
          {guideFields(guide, "").map((field) => (
            <FieldSkeleton
              key={field.name}
              label={field.label}
              description={field.description !== undefined}
            />
          ))}
        </div>
      </Disclosure>
    </div>
  );
}

function ignoreLoadingDisclosureChange(): void {}
