import { useEffect, useState, type RefObject } from "react";

/**
 * Layout modes are the single source of truth for responsive behaviour.
 * CSS only keys off `data-layout`, so a breakpoint never has to be repeated
 * in both TypeScript and a media query.
 */
export type DashboardLayoutMode = "wide" | "medium" | "condensed" | "compact" | "narrow" | "phone";

export const LAYOUT_BREAKPOINTS = {
  wide: 1280,
  condensed: 1100,
  compact: 960,
  narrow: 720,
  phone: 560,
} as const;

export function layoutModeForWidth(width: number): DashboardLayoutMode {
  if (width <= LAYOUT_BREAKPOINTS.phone) return "phone";
  if (width <= LAYOUT_BREAKPOINTS.narrow) return "narrow";
  if (width <= LAYOUT_BREAKPOINTS.compact) return "compact";
  if (width <= LAYOUT_BREAKPOINTS.condensed) return "condensed";
  if (width <= LAYOUT_BREAKPOINTS.wide) return "medium";
  return "wide";
}

export function isOverlayLayout(mode: DashboardLayoutMode): boolean {
  return mode === "compact" || mode === "narrow" || mode === "phone";
}

function viewportWidth(): number {
  if (typeof window === "undefined") return 1600;
  return Math.max(320, window.innerWidth || 1600);
}

export function useDashboardLayout(ref: RefObject<HTMLElement | null>): {
  mode: DashboardLayoutMode;
  overlayDetail: boolean;
} {
  const [mode, setMode] = useState<DashboardLayoutMode>(() => layoutModeForWidth(viewportWidth()));

  useEffect(() => {
    const node = ref.current;
    const update = () => {
      const measured = node?.getBoundingClientRect().width ?? 0;
      setMode(layoutModeForWidth(measured > 0 ? measured : viewportWidth()));
    };
    update();

    const observer = typeof ResizeObserver === "undefined" || !node ? null : new ResizeObserver(update);
    if (node && observer) observer.observe(node);
    window.addEventListener("resize", update, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref]);

  return { mode, overlayDetail: isOverlayLayout(mode) };
}