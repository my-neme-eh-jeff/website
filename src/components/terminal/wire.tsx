import { component$ } from "@qwik.dev/core";

/** The wire to the box (a `*` is the spark on it), the box's face, and what floats after it. */
type Frame = readonly [wire: string, face: string, after?: string];

const AWAKE: readonly Frame[] = [
  ["------", "o_o"],
  ["------", "o_o"],
  ["*-----", "o_o"],
  ["-*----", "o_o"],
  ["--*---", "o_o"],
  ["---*--", "o_o"],
  ["----*-", "o_o"],
  ["-----*", "o_o"],
  ["------", "O_O"],
  ["------", "o_O"],
  ["------", "O_o"],
  ["------", "o_O"],
  ["------", "o_o"],
  ["------", "-_-"],
  ["------", "o_o"],
  ["------", "o_o"],
];

const ASLEEP: readonly Frame[] = [
  ["------", "-_-"],
  ["------", "-_-", "z"],
  ["------", "-_-", " z"],
  ["------", "-_-", "  Z"],
  ["------", "-_-"],
  ["------", "-_o"],
  ["------", "-_-"],
  ["------", "-_-", "z"],
  ["------", "-_-", " Z"],
  ["------", "-_-", "  z"],
];

const FACES: readonly Frame[] = AWAKE.map(([, face]) => ["", face]);

const width = (f: Frame) => f[0].length + f[1].length + 2 + (f[2]?.length ?? 0);
const COLS = Math.max(...[...AWAKE, ...ASLEEP].map(width));
export const FACE_COLS = Math.max(...FACES.map(width));

const Strip = ({
  frames,
  ms,
  class: cls,
}: {
  frames: readonly Frame[];
  ms: number;
  class: string;
}) => (
  <span class={cls} style={`--n:${frames.length};--ms:${ms}ms`}>
    {frames.map(([wire, face, after], i) => (
      <span class="block" key={i}>
        {wire.split(/(\*)/).map((part, j) =>
          part === "*" ? (
            <span class="text-accent" key={j}>
              *
            </span>
          ) : (
            part
          ),
        )}
        [<span class="text-accent">{face}</span>]{after}
      </span>
    ))}
  </span>
);

/**
 * The shell's busy line: a spark runs down a wire to the box, which sleeps
 * through a cold start. Frame 0 of each strip is its reduced-motion pose.
 */
export const Wire = component$(() => (
  <span class="term-wire" aria-hidden="true" style={`--cols:${COLS}`}>
    <Strip frames={AWAKE} ms={120} class="term-wire-awake" />
    <Strip frames={ASLEEP} ms={380} class="term-wire-asleep" />
  </span>
));

export const Face = component$(() => (
  <span class="term-wire" aria-hidden="true" style={`--cols:${FACE_COLS}`}>
    <Strip frames={FACES} ms={120} class="term-wire-awake" />
  </span>
));
