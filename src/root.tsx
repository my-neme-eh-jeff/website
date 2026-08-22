import { component$ } from "@qwik.dev/core";
import {
  DocumentHeadTags,
  RouterOutlet,
  useLocation,
  useQwikRouter,
} from "@qwik.dev/router";

import "./global.css";

export default component$(() => {
  useQwikRouter();
  const { url } = useLocation();

  /**
   * This is the root of a QwikRouter site. It contains the document's `<head>` and `<body>`. You can adjust them as you see fit.
   */

  return (
    <>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {/*
         * Three icons, because no single format covers everything:
         * - .svg is the one that renders for most traffic, and is the only one
         *   that can follow prefers-color-scheme (it swaps to a cream tile on a
         *   dark tab strip, where an ink tile would vanish).
         * - .ico is the fallback for browsers with unreliable SVG favicon
         *   support, mainly older Safari. It carries 16/32/48 so the small size
         *   is a purpose-rendered bitmap rather than a downscale of the large one.
         * - apple-touch-icon is required for iOS home screens, which ignore SVG
         *   and render transparency as black — hence a full-bleed opaque square.
         * Order matters: browsers that understand the SVG take it and stop.
         */}
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        <DocumentHeadTags />

        <link rel="canonical" href={url.href} />
      </head>
      <body>
        <RouterOutlet />
      </body>
    </>
  );
});
