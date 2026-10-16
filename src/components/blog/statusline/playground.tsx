import { component$, useSignal, type Signal } from "@qwik.dev/core";
import { Range, Toggle } from "../controls";
import { dur, type Repo, type State } from "./model";
import { calm, demo, heating, wall } from "./scenarios";
import { Statusline } from "./terminal";

const PRESETS = [
  { label: "Calm", state: calm },
  { label: "Heating up", state: heating },
  { label: "At the limit", state: wall },
] as const;

const minutes = (s: number) => Math.floor(s / 60);
const hours = (s: number) => Math.floor(s / 3600);

export const Playground = component$(() => {
  const ctx = useSignal(heating.context);
  const five = useSignal(heating.fiveHour?.used ?? 0);
  const fiveLeft = useSignal(minutes(heating.fiveHour?.resetsIn ?? 0));
  const week = useSignal(heating.week?.used ?? 0);
  const weekLeft = useSignal(hours(heating.week?.resetsIn ?? 0));
  const cold = useSignal(false);
  const sso = useSignal(true);
  const preset: Signal<string> = useSignal("Heating up");
  const repos = useSignal<Repo[]>(heating.repos ?? []);

  const base = PRESETS.find((p) => p.label === preset.value)?.state ?? heating;
  const state: State = {
    ...base,
    context: ctx.value,
    fiveHour: { used: five.value, resetsIn: fiveLeft.value * 60 },
    week: { used: week.value, resetsIn: weekLeft.value * 3600 },
    cacheCold: cold.value,
    aws: { ...demo.aws, ssoValid: sso.value },
    repos: repos.value,
  };

  const matches = (s: State) =>
    ctx.value === s.context &&
    five.value === s.fiveHour?.used &&
    fiveLeft.value === minutes(s.fiveHour.resetsIn) &&
    week.value === s.week?.used &&
    weekLeft.value === hours(s.week.resetsIn) &&
    cold.value === !!s.cacheCold &&
    sso.value;

  return (
    <div>
      <div class="mb-4 flex flex-wrap gap-2" role="group" aria-label="Presets">
        {PRESETS.map((p) => {
          // Only the label in the handler: Qwik serialises what it closes
          // over, and `p` is a preset's whole state.
          const label = p.label;
          return (
            <button
              key={label}
              type="button"
              aria-pressed={preset.value === label && matches(p.state)}
              onClick$={() => {
                const s = PRESETS.find((x) => x.label === label)!.state;
                preset.value = label;
                ctx.value = s.context;
                five.value = s.fiveHour?.used ?? 0;
                fiveLeft.value = minutes(s.fiveHour?.resetsIn ?? 0);
                week.value = s.week?.used ?? 0;
                weekLeft.value = hours(s.week?.resetsIn ?? 0);
                cold.value = !!s.cacheCold;
                sso.value = true;
                repos.value = s.repos ?? [];
              }}
              class="pill text-muted hover:text-text aria-pressed:border-accent aria-pressed:text-text cursor-pointer bg-transparent text-sm"
            >
              {label}
            </button>
          );
        })}
      </div>

      <Statusline state={state} />

      <div class="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <Range
          label="5-hour window used"
          value={five}
          min={0}
          max={100}
          text={`${five.value}%`}
        />
        <Range
          label="5-hour window resets in"
          value={fiveLeft}
          min={0}
          max={300}
          text={dur(fiveLeft.value * 60) || "now"}
        />
        <Range
          label="Weekly window used"
          value={week}
          min={0}
          max={100}
          text={`${week.value}%`}
        />
        <Range
          label="Weekly window resets in"
          value={weekLeft}
          min={0}
          max={168}
          text={dur(weekLeft.value * 3600) || "now"}
        />
        <Range
          label="Context used"
          value={ctx}
          min={0}
          max={100}
          text={`${ctx.value}%`}
        />
        <div class="flex flex-col justify-end gap-2">
          <Toggle label="Prompt cache went cold" value={cold} />
          <Toggle label="AWS SSO token still valid" value={sso} />
        </div>
      </div>
    </div>
  );
});
