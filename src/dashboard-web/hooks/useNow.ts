import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let current = Date.now();
let timer: number | null = null;

function tick() {
  current = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  if (!listeners.size) current = Date.now();
  listeners.add(listener);
  if (timer === null) timer = window.setInterval(tick, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot() {
  return current;
}

/**
 * One shared clock for every relative timestamp. Rows subscribe individually,
 * so a tick does not re-render the whole dashboard or create one timer per row.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}