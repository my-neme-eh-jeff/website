import { component$ } from "@qwik.dev/core";
import {
  DocumentHeadTags,
  RouterOutlet,
  useLocation,
  useQwikRouter,
} from "@qwik.dev/router";

import { analyticsLoader } from "~/content/analytics";
import { DEFAULT_PALETTE, PALETTES, paletteCss } from "~/content/palettes";
import { themeScript } from "~/content/theme";
import "./global.css";

const defaultPalette = PALETTES.find((p) => p.id === DEFAULT_PALETTE)!;
const defaultGrounds = {
  light: defaultPalette.light!.bg,
  dark: defaultPalette.dark!.bg,
};

export default component$(() => {
  /*
   * viewTransition is opt-in (QwikRouterProps defaults it to false). With it
   * on, SPA navigation runs through document.startViewTransition, so the
   * ::view-transition rules in global.css apply. Browsers without the API just
   * navigate instantly — there is no polyfill and none is wanted.
   */
  useQwikRouter({ viewTransition: true });
  const { url } = useLocation();

  return (
    <>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />

        {/*
         * Colour: the default palette follows the reader's OS setting, and a
         * reader can pick another from the footer or with `theme` in the shell.
         *
         * These two tags carry the page colour to the parts of the UI the page
         * does not own -- the mobile address bar and the PWA title bar. Without
         * them a light page sits under dark browser chrome, which is the seam
         * that makes a site look like it merely tolerates dark mode. They hold
         * the default palette's grounds for readers without JavaScript;
         * `themeScript` below rewrites both for anyone who chose otherwise,
         * which is why it has to come after them.
         */}
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content={defaultGrounds.light}
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content={defaultGrounds.dark}
        />
        {/* Every palette's tokens. Values and selectors: src/content/palettes.ts. */}
        <style dangerouslySetInnerHTML={paletteCss} />
        <script dangerouslySetInnerHTML={themeScript} />

        {/*
         * Preload only the one font file needed for first paint: the variable
         * sans, latin subset. Everything else (latin-ext, both mono weights)
         * is fetched on demand via unicode-range, so preloading them would be
         * bytes spent on nothing.
         *
         * `crossorigin` is REQUIRED even though this is same-origin. Fonts are
         * always fetched in CORS mode, so a preload without it is treated as a
         * different request than the one @font-face makes -- and the file is
         * downloaded twice.
         */}
        <link
          rel="preload"
          href="/fonts/hanken-grotesk-v12-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
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
        {/* Conditions and why it is inline: src/content/analytics.ts. */}
        <script dangerouslySetInnerHTML={analyticsLoader} />
      </head>
      <body>
        <RouterOutlet />
      </body>
    </>
  );
});
