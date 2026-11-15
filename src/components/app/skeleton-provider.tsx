import type { ReactNode } from "react";
import { SkulletProvider, type SkulletConfig } from "skullet/react";

// Semantic colours follow the palette already applied by the head script, including a manual
// appearance choice. Using system colours here would disagree with the app's Light/Dark setting.
const CONFIG: SkulletConfig = {
  // The app's semantic variables already select the appearance; no second media-query palette.
  mode: "light",
  theme: {
    light: {
      base: "var(--accent)",
      highlight: "color-mix(in srgb, var(--accent), var(--foreground) 6%)",
    },
    radius: "var(--radius-md)",
    animation: "shimmer",
    speed: "slow",
  },
  reveal: { order: "together", duration: 150, hold: 150 },
};

export function SkeletonProvider({ children }: { children: ReactNode }) {
  return <SkulletProvider {...CONFIG}>{children}</SkulletProvider>;
}
