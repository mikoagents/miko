import { SkeletonBox } from "skullet/react";
import { cn } from "../../lib/utils.js";

function Skeleton({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("block overflow-hidden rounded-md", className)}
      {...props}
    >
      <SkeletonBox width="100%" height="100%" radius="inherit" />
    </span>
  );
}

export { Skeleton };
