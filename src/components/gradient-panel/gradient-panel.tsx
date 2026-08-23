import { component$ } from "@qwik.dev/core";

/**
 * A grainy warm gradient surface, in the vein of the Colir gallery tiles.
 *
 * ---------------------------------------------------------------------------
 * WHY LAYERED CSS GRADIENTS AND NOT AN IMAGE OR WEBGL
 *
 * An image would be the obvious answer and is the wrong one here: a panel this
 * large needs to be sharp at 2x, which means a heavy file, and it would not
 * follow the theme. WebGL would render beautifully and cost a canvas, a
 * context, and JavaScript on a page whose entire selling point is that it ships
 * almost none.
 *
 * Five offset radial-gradients plus a conic sweep get most of the way there,
 * cost zero bytes beyond the CSS, stay sharp at any density, and render before
 * hydration because they are just paint.
 *
 * The grain overlay is what sells it. Smooth CSS ramps band visibly across a
 * panel this wide; fractal noise at low opacity breaks the bands up and reads
 * as film grain rather than as a defect. See the `grain` utility in global.css.
 *
 * Colours are fixed rather than theme-swapped. This is artwork, not chrome —
 * a deep ember panel is the intent in both themes, and remapping it to cream
 * on light would just make it a beige rectangle. It sits behind white text in
 * both, which is why every hue here stays dark enough for that to hold.
 * ---------------------------------------------------------------------------
 */
export const GradientPanel = component$<{ class?: string }>(
  ({ class: cls = "" }) => {
    return (
      <div
        class={`relative isolate overflow-hidden rounded-2xl ${cls}`}
        // Decorative: the surrounding content carries all the meaning.
        aria-hidden="true"
      >
        <div
          class="absolute inset-0"
          style={{
            background: [
              // Hot core, upper left.
              "radial-gradient(120% 90% at 18% 12%, #ff8a3d 0%, transparent 58%)",
              // Deep ember pulling to the right.
              "radial-gradient(100% 120% at 78% 34%, #d0341f 0%, transparent 62%)",
              // Crimson weight along the bottom.
              "radial-gradient(90% 70% at 62% 92%, #8f1d13 0%, transparent 60%)",
              // A cooler bruise so the ramp is not one single hue.
              "radial-gradient(70% 60% at 96% 96%, #4a1030 0%, transparent 55%)",
              // Sweep that gives the veining its direction.
              "conic-gradient(from 210deg at 42% 58%, rgb(0 0 0 / 0.42), transparent 28%, rgb(0 0 0 / 0.3) 62%, transparent 88%)",
              // Ground, so no gap ever shows through the stack.
              "linear-gradient(160deg, #2a0d08, #160604)",
            ].join(", "),
          }}
        />
        <div class="grain" />
      </div>
    );
  },
);
