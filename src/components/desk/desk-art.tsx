import { GRIDS, rasterize, segments } from "./desk";

const ART = (["wide", "narrow"] as const).map((size) => ({
  size,
  parts: segments(rasterize(GRIDS[size].cols, GRIDS[size].rows)),
}));

/**
 * Rendered by the route and projected into the shell, so the shell's own
 * re-renders never run the rasteriser on the client.
 */
export const DeskArt = () => (
  <div class="desk" aria-hidden="true">
    {ART.map(({ size, parts }) => (
      <pre class={`desk-grid desk-${size}`} data-desk-grid={size} key={size}>
        {parts.map((s, i) =>
          s.led ? (
            <span class="desk-led" key={i}>
              {s.text}
            </span>
          ) : (
            s.text
          ),
        )}
      </pre>
    ))}
  </div>
);
