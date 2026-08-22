import { ssgAdapter } from "@qwik.dev/router/adapters/ssg/vite";
import { extendConfig } from "@qwik.dev/router/vite";
import baseConfig from "../../vite.config.ts";

export default extendConfig(baseConfig, () => {
  return {
    build: {
      ssr: true,
      // beta.38 ships vite 7.3.1 on rollup. Qwik's `main` template uses
      // `rolldownOptions`, which targets a newer rolldown-vite and is wrong here.
      rollupOptions: {
        input: ["@qwik-router-config"],
      },
    },
    plugins: [
      // `staticAdapter` is deprecated in beta.38 in favour of `ssgAdapter`.
      ssgAdapter({
        origin: "https://amannambisan.com",
      }),
    ],
  };
});
