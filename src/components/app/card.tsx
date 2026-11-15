import type { ReactNode } from "react";

import { cn } from "../../lib/utils.js";
import { Skeleton } from "../ui/skeleton.js";

/**
 * The one bordered surface. Anything that would otherwise be a hand-rolled `rounded-* border
 * bg-card p-*` div is this, so cards share their radius, density, and distance from title to
 * body. Title and description are
 * optional: a card with neither is just the box.
 */
export function Card({
  icon,
  title,
  description,
  action,
  children,
  className,
  density = "default",
  layout = "default",
}: {
  /** A glyph identifying what the card is about, beside its title. */
  icon?: ReactNode;
  title?: string;
  description?: string;
  /** A single trailing link or button belonging to the card, not to its body. */
  action?: ReactNode;
  /** Optional: a card that is only a title and an action is still a card. */
  children?: ReactNode;
  /** Placement in a parent grid only. Never used to change how the card looks. */
  className?: string;
  /** Compact cards group settings under a heading outside the surface. */
  density?: "default" | "compact";
  /** A catalog entry inside a link: a leading glyph, a short preview, and optional metadata. */
  layout?: "default" | "catalog";
}) {
  const titled = title !== undefined || description !== undefined || action !== undefined;
  const catalog = layout === "catalog";
  const Heading = catalog ? "h3" : "h2";
  return (
    <section
      className={cn(
        "grid min-w-0 gap-4 rounded-xl border bg-card",
        density === "compact" ? "p-4" : "p-6",
        catalog &&
          "h-full grid-rows-[1fr_auto] gap-3 transition-colors duration-150 group-hover:bg-accent group-focus-visible:bg-accent",
        className,
      )}
    >
      {titled ? (
        <div
          className={cn(
            "flex min-w-0 justify-between gap-4",
            catalog ? "items-start" : "items-center",
          )}
        >
          <div
            className={cn(
              "flex min-w-0",
              catalog ? "flex-col items-start gap-3" : "items-center gap-2.5",
            )}
          >
            {icon === undefined ? null : (
              <span
                aria-hidden="true"
                className={cn(
                  "flex shrink-0 items-center",
                  catalog ? "size-5 text-link [&>svg]:size-5" : "[&>svg]:size-4",
                )}
              >
                {icon}
              </span>
            )}
            <div className="grid min-w-0 gap-1">
              {title === undefined ? null : (
                <Heading className="text-sm text-foreground">{title}</Heading>
              )}
              {description === undefined ? null : (
                <p
                  className={cn(
                    "text-sm text-muted-foreground",
                    catalog && "line-clamp-2 min-h-10",
                  )}
                >
                  {description}
                </p>
              )}
            </div>
          </div>
          {action === undefined ? null : <div className="shrink-0">{action}</div>}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** The same box before its contents are known, so nothing moves when they land. */
export function CardSkeleton({
  title,
  description,
  lines = 3,
}: {
  title?: string;
  description?: string;
  lines?: number;
}) {
  return (
    <Card
      {...(title === undefined ? {} : { title })}
      {...(description === undefined ? {} : { description })}
    >
      <div
        aria-busy="true"
        aria-label={`Loading ${title ?? "card"}`}
        className="grid min-w-0 gap-3"
      >
        {Array.from({ length: lines }, (_, line) => (
          <Skeleton key={line} className={cn("h-4", line === 0 ? "w-40" : "w-full")} />
        ))}
      </div>
    </Card>
  );
}
