import { component$, sync$, useOnDocument } from "@qwik.dev/core";
import { PALETTES, modesOf } from "~/content/palettes";

const MODE_LABELS = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const options = PALETTES.map((p) => {
  const modes = modesOf(p);
  return {
    id: p.id,
    name: p.name,
    from: p.from,
    only: modes.length === 1 ? modes[0] : undefined,
  };
});

/**
 * The footer's colour picker, on every page.
 *
 * It never wakes Qwik. The panel is a native popover, so opening and closing
 * it (Esc, a click outside) needs no script, and every handler is a sync$
 * that calls `window.siteTheme` from src/content/theme.ts. A sync$ is
 * serialised into the HTML, so it can import nothing and close over nothing:
 * what it needs is in the radios' values and data attributes.
 *
 * The radios start unchecked because the stored choice is unknown at build
 * time. Opening the panel asks the theme script to repaint, which fires
 * `themechange`, and that listener ticks the radios. The same listener keeps
 * them right when the shell, another tab or the OS changes the theme.
 *
 * Hidden until the theme script has run (`data-js` on <html>): without
 * JavaScript the radios could not do anything.
 */
export const ThemePicker = component$(() => {
  useOnDocument(
    "themechange",
    sync$((e: Event) => {
      const t = (
        e as CustomEvent<{ name: string; mode: string; preview: boolean }>
      ).detail;
      const panel = document.getElementById("theme-picker");
      // The shell's picker previews; only a saved choice ticks a radio.
      if (!t || t.preview || !panel) return;
      let only = "";
      let name = "";
      for (const i of panel.querySelectorAll<HTMLInputElement>(
        'input[name="theme-name"]',
      )) {
        i.checked = i.value === t.name;
        if (i.checked) {
          only = i.dataset["only"] ?? "";
          name = i.dataset["name"] ?? "";
        }
      }
      for (const i of panel.querySelectorAll<HTMLInputElement>(
        'input[name="theme-mode"]',
      )) {
        i.checked = i.value === t.mode;
        i.disabled = !!only;
      }
      const note = document.getElementById("theme-note");
      if (note)
        note.textContent = only
          ? `${name} has a ${only} version only. Saved in this browser.`
          : "Saved in this browser.";
    }),
  );

  return (
    <div class="theme-picker">
      <button
        type="button"
        popovertarget="theme-picker"
        class="theme-button hover:text-text inline-flex min-h-6 cursor-pointer items-center gap-2"
        onClick$={sync$(() => window.siteTheme?.set())}
      >
        <span class="swatch swatch-current" aria-hidden="true" />
        Colours
      </button>

      <div
        id="theme-picker"
        popover="auto"
        class="theme-panel text-sm"
        onChange$={sync$((e: Event) => {
          const i = e.target as HTMLInputElement;
          if (i.name === "theme-name") window.siteTheme?.set(i.value);
          else if (i.name === "theme-mode")
            window.siteTheme?.set(undefined, i.value as "auto");
        })}
      >
        <fieldset class="min-w-0">
          <legend class="text-text mb-2 font-medium">Colours</legend>
          <div class="flex flex-col">
            {options.map((o) => (
              <label
                key={o.id}
                class="hover:bg-line has-[:checked]:bg-line has-[:focus-visible]:outline-accent -mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-3"
              >
                <input
                  type="radio"
                  name="theme-name"
                  value={o.id}
                  data-name={o.name}
                  data-only={o.only}
                  class="sr-only"
                />
                <span class="swatch" data-swatch={o.id} aria-hidden="true" />
                <span class="text-text min-w-0">{o.name}</span>
                <span class="text-muted ml-auto text-right text-xs">
                  {o.from}
                  {o.only && ` · ${o.only} only`}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset class="mt-4 min-w-0">
          <legend class="text-text mb-2 font-medium">Light or dark</legend>
          <div class="flex flex-wrap gap-2">
            {MODE_LABELS.map((m) => (
              <label
                key={m.value}
                class="pill text-muted hover:text-text has-[:checked]:border-accent has-[:checked]:text-text has-[:focus-visible]:outline-accent cursor-pointer text-sm has-[:disabled]:cursor-default has-[:disabled]:opacity-50 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2"
              >
                <input
                  type="radio"
                  name="theme-mode"
                  value={m.value}
                  class="sr-only"
                />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>

        <p
          id="theme-note"
          class="text-muted mt-4 mb-0 text-xs"
          aria-live="polite"
        >
          Saved in this browser.
        </p>
        <p class="text-muted mt-1 mb-0 text-xs">
          On the home page you can also type <code>theme</code>.
        </p>
      </div>
    </div>
  );
});
