import { component$ } from "@qwik.dev/core";
import {
  DocumentHeadTags,
  RouterOutlet,
  useLocation,
  useQwikRouter,
} from "@qwik.dev/router";

import { analyticsLoader } from "~/content/analytics";
import { fieldScript } from "~/content/field";
import { DEFAULT_PALETTE, PALETTES, paletteCss } from "~/content/palettes";
import { staleTabScript } from "~/content/stale-tab";
import { themeScript } from "~/content/theme";
import "./global.css";

const defaultPalette = PALETTES.find((p) => p.id === DEFAULT_PALETTE)!;
const defaultGrounds = {
  light: defaultPalette.light!.bg,
  dark: defaultPalette.dark!.bg,
};

export default component$(() => {
  useQwikRouter({ viewTransition: true });
  const { url } = useLocation();

  return (
    <>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />

        {/*
         * The default palette's grounds. `themeScript` rewrites them for a saved
         * choice, and an inline script only sees tags parsed before it.
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
        <style dangerouslySetInnerHTML={paletteCss} />
        <script dangerouslySetInnerHTML={themeScript} />
        <script dangerouslySetInnerHTML={staleTabScript} />
        <script dangerouslySetInnerHTML={fieldScript} />

        {/* Fonts load in CORS mode even same-origin, so without crossorigin this downloads twice. */}
        <link
          rel="preload"
          href="/fonts/hanken-grotesk-v12-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/*
         * .ico for browsers without SVG favicons; apple-touch-icon because iOS
         * home screens ignore SVG.
         */}
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        <DocumentHeadTags />

        <link rel="canonical" href={url.href} />
        <script dangerouslySetInnerHTML={analyticsLoader} />
      </head>
      <body>
        <RouterOutlet />
      </body>
    </>
  );
});
