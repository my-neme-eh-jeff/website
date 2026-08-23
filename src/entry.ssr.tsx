/**
 * WHAT IS THIS FILE?
 *
 * SSR renderer function, used by Qwik Router.
 *
 * Note that this is the only place the Qwik renderer is called.
 * On the client, containers resume and do not call render.
 */
import { createRenderer } from "@qwik.dev/router";
import Root from "./root";

export default createRenderer((opts) => {
  return {
    jsx: <Root />,
    options: {
      ...opts,
      /*
       * Preloader tuning.
       *
       * Measured before touching this: a cold page load with NO interaction
       * fetched 34 bundles totalling 174 kB. That is Qwik working as designed
       * — `maxIdlePreloads` defaults to 25, so it warms likely bundles during
       * idle time to make the first interaction instant — and it is also what
       * Lighthouse reports as "unused JavaScript".
       *
       * Qwik's own docs state the trade plainly: preload links "can delay LCP,
       * which is a Core Web Vital", in exchange for a better TTI, which is not.
       * On this site that trade is bad value. There are two interactive things
       * on the whole page (the shell and the contact chooser), so warming 25
       * bundles buys a few milliseconds on an interaction most visitors never
       * make, and spends it against the metric everyone measures.
       *
       *   ssrPreloads: 0    no <link rel=preload> for JS in the HTML at all,
       *                     so nothing competes with the font and the CSS for
       *                     the critical path.
       *   maxIdlePreloads: 4  still warms the handful this page can actually
       *                     need, during idle time, after paint.
       *
       * Not `preloader: false`: that would leave the first keystroke to fetch
       * its bundle cold, which on a slow connection is a visible stall. This
       * keeps the warming, just proportionate to a page with two widgets.
       *
       * Re-measure after changing (expect far fewer than 34):
       *   npm run build && npx http-server dist  # then count /build/*.js hits
       */
      preloader: {
        ssrPreloads: 0,
        maxIdlePreloads: 4,
      },
      // Use container attributes to set attributes on the html tag.
      containerAttributes: {
        lang: "en",
        ...opts.containerAttributes,
      },
      serverData: {
        ...opts.serverData,
        // These are the default values for the document head and are overridden by the `head` exports
        // documentHead: {
        //   title: "My App",
        // },
      },
    },
  };
});
