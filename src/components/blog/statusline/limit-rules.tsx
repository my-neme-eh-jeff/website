import { render } from "./model";
import { quiet } from "./scenarios";
import { Terminal, type Line } from "./terminal";

const at = (used: number, resetsIn: number, wk = 20, wkIn = 400001) =>
  render(
    quiet({
      fiveHour: { used, resetsIn },
      week: { used: wk, resetsIn: wkIn },
    }),
  ).lines[0] ?? [];

const LINES: Line[] = [
  { comment: "5h window at 45%: under 60%, so it isn't shown" },
  at(45, 9001),
  {
    comment:
      "68% with 30m left: shown, no forecast because the reset comes first",
  },
  at(68, 1801),
  { comment: "72% with 2h10m left: at this pace it runs out before the reset" },
  at(72, 7801),
  { comment: "spent: marked ! with the time until it lifts" },
  at(100, 2281),
  { comment: "two limits: the one blocking you goes first" },
  at(100, 2281, 83, 200001),
];

export const LimitRules = () => (
  <Terminal lines={LINES} label="Five rows showing when a limit appears" />
);
