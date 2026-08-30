import { $ } from "@qwik.dev/core";

/**
 * Command history that survives a reload.
 *
 * ---------------------------------------------------------------------------
 * sessionStorage, NOT localStorage, AND THAT IS A SCOPE DECISION
 *
 * A real shell keeps history forever because the shell is yours. This one is a
 * stranger's website, and quietly retaining what someone typed across days is
 * a different proposition from retaining it across an accidental refresh. The
 * per-tab lifetime of sessionStorage matches what is actually being fixed:
 * losing a session's recall to a reload.
 *
 * It also matches the shell's own semantics — closing the panel already ends
 * the session and clears the buffer, so history outliving the tab would be the
 * odd one out.
 *
 * ---------------------------------------------------------------------------
 * READ LAZILY, LIKE EVERYTHING ELSE HERE
 *
 * terminal.tsx deliberately runs no eager task, so nothing may touch storage
 * on load. `load` is therefore called at the moment history is first needed —
 * before the first read (ArrowUp) and before the first WRITE (submit), which
 * matters more than it looks: pushing a command onto an unloaded, empty array
 * and saving that would overwrite the very history being restored.
 * ---------------------------------------------------------------------------
 */

const KEY = "shell:history";

/**
 * Enough to walk back through a session, not enough to be a data store.
 * Storage quotas are per-origin and shared, so an unbounded log here is
 * somebody else's failed write later.
 */
const CAP = 50;

export const load = $((): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Anything can be in storage — another tab, an older version, a person
    // with devtools open. Only strings get through.
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string").slice(-CAP)
      : [];
  } catch {
    // Denied, or not JSON. History is a convenience; never break the shell.
    return [];
  }
});

export const save = $((past: string[]) => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(past.slice(-CAP)));
  } catch {
    // Quota or privacy mode. The in-memory history still works for this page.
  }
});
