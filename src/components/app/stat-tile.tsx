/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop -- the figure and detail are content slots */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "./card.js";
import { Skeleton } from "../ui/skeleton.js";

/**
 * An overview figure. The number is bigger, never heavier, and sits in a fixed-height box so a
 * tile does not resize when its data resolves — the loading, empty, and loaded states occupy
 * the same space.
 */
export function StatTile({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <Card>
      <div className="grid gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {Icon === undefined ? null : <Icon aria-hidden="true" className="size-4" />}
          {label}
        </div>
        <div className="grid min-h-11 content-start gap-1">
          <p className="text-2xl leading-none tabular-nums">{value}</p>
          <p className="min-h-5 text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
    </Card>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

/** Keep the label and the same figure/detail tracks while their values are unknown. */
export function StatTileSkeleton({ label, icon }: { label: string; icon?: LucideIcon }) {
  return (
    <div aria-busy="true" aria-label={`Loading ${label}`}>
      <StatTile
        label={label}
        {...(icon === undefined ? {} : { icon })}
        value={<Skeleton className="h-6 w-16" />}
        detail={<Skeleton className="h-4 w-40 max-w-full" />}
      />
    </div>
  );
}
