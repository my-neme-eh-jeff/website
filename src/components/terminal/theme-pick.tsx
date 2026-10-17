import { component$, sync$, $, type QRL } from "@qwik.dev/core";
import { MODES, PALETTES, modesOf, type ModeChoice } from "~/content/palettes";

export type PickState = {
  open: boolean;
  /** The highlighted row, an index into PICKS. */
  i: number;
  mode: ModeChoice;
  /** The palette saved when the picker opened. */
  saved: string;
};

export const PICKS = PALETTES.map((p) => {
  const modes = modesOf(p);
  return {
    id: p.id,
    name: p.name,
    from: p.from,
    only: modes.length === 1 ? modes[0] : undefined,
  };
});

/**
 * Previews each palette on the whole page as it is reached. Nothing is saved
 * until one is kept; Esc puts back what was there.
 */
export const ThemePick = component$<{
  state: PickState;
  onClose$: QRL<(keep: boolean) => void>;
  onMove$: QRL<() => void>;
}>(({ state, onClose$, onMove$ }) => {
  const show = $((i: number, mode: ModeChoice) => {
    state.i = i;
    state.mode = mode;
    window.siteTheme?.preview(PICKS[i]!.id, mode);
  });

  /**
   * The arrows and Space would otherwise scroll the log. A sync$ is shipped as
   * its source text, so it can't name anything from module scope.
   */
  const guard = sync$((e: KeyboardEvent) => {
    if ((e.target as Element).closest("button")) return;
    const nav = [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      " ",
    ];
    if (nav.includes(e.key)) e.preventDefault();
  });

  const onKey = $(async (e: KeyboardEvent) => {
    const k = e.key;
    if (k === "Escape") return onClose$(false);
    // On a button, Enter and Space press it.
    if ((e.target as Element).closest("button") && (k === "Enter" || k === " "))
      return;
    if (k === "Enter" || k === " ") return onClose$(true);

    const n = PICKS.length;
    let i = state.i;
    let mode = state.mode;
    if (k === "ArrowDown" || k === "j") i = (i + 1) % n;
    else if (k === "ArrowUp" || k === "k") i = (i - 1 + n) % n;
    else if (k === "Home" || k === "PageUp") i = 0;
    else if (k === "End" || k === "PageDown") i = n - 1;
    else if (/^[1-9]$/.test(k) && Number(k) <= n) i = Number(k) - 1;
    else if (
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === "h" ||
      k === "l"
    ) {
      const step = k === "ArrowLeft" || k === "h" ? -1 : 1;
      mode = MODES[(MODES.indexOf(mode) + step + MODES.length) % MODES.length]!;
    } else return;
    if (i === state.i && mode === state.mode) return;
    await show(i, mode);
    await onMove$();
  });

  const at = PICKS[state.i]!;

  return (
    <div
      id="theme-pick"
      class="term-composer rounded-xl px-3 py-2.5 font-mono text-[0.8125rem] leading-relaxed"
      onKeyDown$={[guard, onKey]}
      onFocusOut$={(_, el) =>
        setTimeout(() => {
          if (
            state.open &&
            document.hasFocus() &&
            !el.contains(document.activeElement)
          )
            void onClose$(false);
        }, 0)
      }
    >
      <p class="m-0 flex flex-wrap items-baseline gap-x-3">
        <span id="theme-pick-title" class="text-text font-medium">
          Theme
        </span>
        <span class="text-muted text-[0.6875rem] pointer-coarse:hidden">
          Each one shows as you move.
        </span>
      </p>

      <div
        id="theme-list"
        role="listbox"
        tabIndex={0}
        aria-labelledby="theme-pick-title"
        aria-activedescendant={`theme-opt-${at.id}`}
        class="term-pick-list -mx-1 mt-1.5 rounded-md"
      >
        {PICKS.map((p, j) => (
          <div
            key={p.id}
            id={`theme-opt-${p.id}`}
            role="option"
            aria-selected={j === state.i}
            class="term-pick-row hover:bg-line flex min-h-6 cursor-pointer items-center gap-2.5 rounded-md px-1"
            onClick$={async () => {
              await show(j, state.mode);
              await onClose$(true);
            }}
          >
            <span class="text-muted w-[2ch] shrink-0 text-right">{j + 1}.</span>
            <span
              class="swatch size-3.5"
              data-swatch={p.id}
              aria-hidden="true"
            />
            <span class="text-text w-[9ch] shrink-0">{p.name}</span>
            <span class="text-muted hidden min-w-0 truncate sm:inline">
              {p.from}
            </span>
            {p.only && (
              <span class="text-muted shrink-0">
                <span class="hidden sm:inline">· </span>
                {p.only} only
              </span>
            )}
            {p.id === state.saved && (
              <span class="text-accent ml-auto shrink-0 pl-2">
                <span aria-hidden="true">✓</span>
                <span class="sr-only">, in use</span>
              </span>
            )}
          </div>
        ))}
      </div>

      <div
        role="group"
        aria-label="Light or dark"
        class="mt-2 flex flex-wrap items-center gap-1.5"
      >
        {MODES.map((m) => (
          <button
            type="button"
            key={m}
            aria-pressed={state.mode === m}
            onClick$={() => show(state.i, m)}
            class="border-line text-muted hover:text-text aria-pressed:border-accent aria-pressed:text-text min-h-6 rounded-md border px-2 text-[0.6875rem]"
          >
            {m}
          </button>
        ))}
        {at.only && (
          <span class="text-muted text-[0.6875rem]">
            {at.name} is {at.only} only
          </span>
        )}
      </div>

      <p class="text-muted mt-2 mb-0 flex flex-wrap items-center gap-x-4 text-[0.6875rem]">
        <span class="pointer-coarse:hidden" aria-hidden="true">
          ↑↓ choose
        </span>
        <span class="pointer-coarse:hidden" aria-hidden="true">
          ← → light or dark
        </span>
        <button
          type="button"
          class="hover:text-text min-h-6"
          onClick$={() => onClose$(true)}
        >
          <span class="text-text">enter</span> keep
        </button>
        <button
          type="button"
          class="hover:text-text min-h-6"
          onClick$={() => onClose$(false)}
        >
          <span class="text-text">esc</span> cancel
        </button>
      </p>
    </div>
  );
});
