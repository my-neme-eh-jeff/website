import { createRenderer } from "@qwik.dev/router";
import Root from "./root";

export default createRenderer((opts) => {
  return {
    jsx: <Root />,
    options: {
      ...opts,
      /*
       * @qwik.dev/core rc.3 (2026-10-14): <Link> prefetches through the
       * preloader, so `preloader: false` makes every prefetch a silent no-op.
       *   grep -n -A3 'const requestPreload' node_modules/@qwik.dev/core/dist/core.mjs
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
