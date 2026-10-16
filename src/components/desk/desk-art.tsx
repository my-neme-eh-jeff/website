import { GRIDS, rasterize, segments } from "./desk";

/**
 * The desk as text, for the first paint and wherever the light never starts.
 * Rendered by the route and projected into the shell, so the shell's own
 * re-renders never run the rasteriser on the client.
 */
export const DeskArt = () => (
  <div class="desk" aria-hidden="true">
    {(["wide", "narrow"] as const).map((size) => (
      <pre class={`desk-grid desk-${size}`} data-desk-grid={size} key={size}>
        {segments(rasterize(GRIDS[size].cols, GRIDS[size].rows)).map((s, i) =>
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
