import { createRenderer } from "@qwik.dev/router";
import Root from "./root";

export default createRenderer((opts) => {
  return {
    jsx: <Root />,
    options: {
      ...opts,
      /*
       * Preloader: ON. Measured, not assumed.
       *
       * It is what <Link> prefetches through. Visible, hover and click
       * prefetch all hand bundle names to the preloader, and core only
       * forwards them once the preloader module has loaded and set
       * `globalThis.qPreload` — which `preloader: false` stops from ever
       * happening. With it off, each of those was a silent no-op and a click
       * pulled the next route's code as a ten-request waterfall before the view
       * transition could start. Check the hand-off:
       *   grep -n -A3 'const requestPreload' node_modules/@qwik.dev/core/dist/core.mjs
       *
       * `node scripts/measure-nav.mjs --rtt 40` (and 150): headless Chrome,
       * cold cache, / -> Writing, median of 3, rc.3, 2026-10-14. Brotli is
       * computed from the files, since python's http.server does not compress.
       *
       *   preloader   JS on / before a click     click -> transition ready
       *                                           40 ms RTT    150 ms RTT
       *   false        6 req,  44.9 kB brotli       397 ms       1277 ms
       *   on          48 req,  72.6 kB brotli        88 ms        207 ms
       *
       * The price is that middle column: +42 requests and +27.7 kB, fetched
       * after the load event and an idle callback rather than before first
       * paint (`ssrPreloads: 0`, also Qwik's default, keeps it that way).
       * It includes the shell's handlers, so the first keystroke there no
       * longer waits on the network. On /blog/ the same figure is larger,
       * because the post link it prefetches carries the interactive figures.
       * To trade some speed back for bytes, `prefetchBundles="intent"` on a
       * <Link> waits for hover or focus instead of visibility.
       *
       * What stays on the click path is one round trip on the FIRST
       * navigation: the router's own `goto` chunk. It is not an event handler,
       * so nothing preloads it; later navigations find it loaded.
       *
       * Two corrections to the note this replaced, which turned the preloader
       * off after seeing `maxIdlePreloads` "do nothing": it caps CONCURRENT
       * preloads, not the total, so no value of it fetches less; and `0` is
       * ignored outright, because server.mjs only passes it on
       * `if (options.maxIdlePreloads)`. Check:
       *   grep -n 'options.maxIdlePreloads' node_modules/@qwik.dev/core/dist/server.mjs
       *
       * Unchanged either way: the core + router bundle (109 kB raw) loads on
       * every page, because the container's eager `q-d:` listeners name it.
       * That is the floor for using Qwik Router at all:
       *   grep -o 'q-d:q[a-z]*="[^"]*"' dist/index.html
       */
      preloader: { ssrPreloads: 0 },
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
