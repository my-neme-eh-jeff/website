import { $ } from "@qwik.dev/core";

// sessionStorage, not localStorage: typed text shouldn't outlive the tab.
const KEY = "shell:history";

const CAP = 50;

export const load = $((): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string").slice(-CAP)
      : [];
  } catch {
    // Denied, or not JSON.
    return [];
  }
});

/** Overwrites what is stored, so call `load` first. */
export const save = $((past: string[]) => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(past.slice(-CAP)));
  } catch {
    // Quota or privacy mode; history still works in memory.
  }
});
