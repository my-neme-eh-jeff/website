import { component$, useId, type Signal } from "@qwik.dev/core";

type RangeProps = {
  label: string;
  value: Signal<number>;
  min: number;
  max: number;
  step?: number;
  /** The value in words. Shown, and read out instead of the raw number. */
  text: string;
};

export const Range = component$<RangeProps>(
  ({ label, value, min, max, step = 1, text }) => {
    const id = useId();
    return (
      <div class="min-w-0">
        <div class="flex items-baseline justify-between gap-3">
          <label for={id} class="text-muted text-sm">
            {label}
          </label>
          {/* Hidden from screen readers: an <output> is a live region, and
              aria-valuetext below already says this on every step. */}
          <output
            for={id}
            aria-hidden="true"
            class="font-mono text-xs tabular-nums"
          >
            {text}
          </output>
        </div>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value.value}
          aria-valuetext={text}
          onInput$={(_, el) => (value.value = el.valueAsNumber)}
          class="accent-accent mt-1 block h-6 w-full cursor-pointer"
        />
      </div>
    );
  },
);

type ChoiceProps = {
  legend: string;
  options: readonly { value: string; label: string }[];
  value: Signal<string>;
};

/** A radio group drawn as pills. The input stays real; only it is hidden. */
export const Choice = component$<ChoiceProps>(({ legend, options, value }) => {
  const name = useId();
  return (
    <fieldset class="min-w-0">
      <legend class="text-muted mb-2 text-sm">{legend}</legend>
      <div class="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            class="pill text-muted hover:text-text has-[:checked]:border-accent has-[:checked]:text-text has-[:focus-visible]:outline-accent cursor-pointer text-sm has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2"
          >
            <input
              type="radio"
              class="sr-only"
              name={name}
              value={o.value}
              checked={value.value === o.value}
              onChange$={() => (value.value = o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
});

export const Toggle = component$<{ label: string; value: Signal<boolean> }>(
  ({ label, value }) => (
    <label class="flex min-h-6 cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={value.value}
        onChange$={(_, el) => (value.value = el.checked)}
        class="accent-accent size-4"
      />
      {label}
    </label>
  ),
);
