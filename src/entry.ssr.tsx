import { createRenderer } from "@qwik.dev/router";
import Root from "./root";

export default createRenderer((opts) => {
  return {
    jsx: <Root />,
    options: {
      ...opts,
      /*
       * Preloader: OFF. Measured, not assumed.
       *
       * Method: build, serve dist, load / in headless Chrome with no
       * interaction, and count what the browser actually fetched. Brotli
       * figures are `brotli -q 11` over the same files, because production
       * serves compressed and python's http.server does not — measuring the
       * uncompressed number is how this repo previously talked itself into a
       * wrong conclusion (see scripts/audit.mjs).
       *
       *   preloader config          JS requests   raw      brotli
       *   ssrPreloads 0 / idle 4         26      183.4 kB  65.1 kB
       *   ssrPreloads 0 / idle 0         26      183.4 kB  65.1 kB
       *   false                           8      140.9 kB  48.5 kB
       *
       * THE MIDDLE ROW IS THE POINT. maxIdlePreloads does nothing here at any
       * value, because of the sentence in its own docs: bundles that reach
       * 100% probability — the static imports of a bundle already being
       * loaded — "will always be preloaded immediately, no limit". Once the
       * core loads, its import graph follows regardless. The previous note in
       * this file claimed `maxIdlePreloads: 4` "still warms the handful this
       * page can actually need"; it warmed 25, and setting it to 0 warmed the
       * same 25. The knob is effectively binary.
       *
       * So `false`, which saves 18 requests and 16.6 kB on the wire.
       *
       * What this does NOT save, and cannot: q-CqMIWLV0.js, the Qwik core and
       * router, 111 kB raw / 36.6 kB brotli. It is fetched even with the
       * preloader off because the container carries eager listeners that name
       * it — `q-d:qinit`, `q-d:qcinit`, `q-d:qrouterpopstate` — which the
       * router registers for client-side navigation. That bundle is the floor
       * for using Qwik Router at all, and it is 75% of the remaining JS.
       * Verify it is still the floor rather than something we added:
       *   grep -o 'q-d:q[a-z]*="[^"]*"' dist/index.html
       *
       * Cost of turning it off: the first keystroke in the shell fetches its
       * bundle cold (8.3 kB raw / ~3 kB brotli) instead of finding it warm.
       * Qwik's loader queues and replays the event, so no input is lost — it
       * arrives late, not never. That trade is the one the shell was designed
       * for: "load on interaction only". Speculative preloading was quietly
       * doing the opposite, shipping the shell to every visitor who never
       * opens it.
       *
       * Re-measure after changing this (expect 8 script requests):
       *   pnpm run build
       *   python3 -m http.server 8199 --directory dist &
       *   # load http://localhost:8199/ and count /build/*.js in devtools
       */
      preloader: false,
      containerAttributes: {
        lang: "en",
        ...opts.containerAttributes,
      },
      serverData: {
        ...opts.serverData,
      },
    },
  };
});
