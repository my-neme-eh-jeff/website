import tailwindcss from "@tailwindcss/vite";
import { qwikVite } from "@qwik.dev/core/optimizer";
import { qwikRouter } from "@qwik.dev/router/vite";
import { defineConfig, type UserConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

type PkgDep = Record<string, string>;
const { dependencies = {}, devDependencies = {} } = pkg as any as {
  dependencies: PkgDep;
  devDependencies: PkgDep;
  [key: string]: unknown;
};
errorOnDuplicatesPkgDeps(devDependencies, dependencies);

export default defineConfig((): UserConfig => {
  return {
    plugins: [
      tailwindcss(),
      qwikRouter({
        // @qwik.dev/router rc.3 turns autolink on by default, which puts an
        // empty aria-hidden link in every MDX heading. Ids stay without it.
        mdxPlugins: {
          remarkGfm: true,
          rehypeSyntaxHighlight: true,
          rehypeAutolinkHeadings: false,
        },
      }),
      // Inlines the stylesheet (default limit 20,000 bytes) instead of linking
      // it. `pnpm run verify` fails once it outgrows this.
      qwikVite({ optimizerOptions: { inlineStylesUpToBytes: 60_000 } }),
    ],
    resolve: { tsconfigPaths: true },
    optimizeDeps: {
      exclude: [],
    },

    server: {
      headers: {
        "Cache-Control": "public, max-age=0",
      },
    },
    preview: {
      headers: {
        "Cache-Control": "public, max-age=600",
      },
    },
  };
});

function errorOnDuplicatesPkgDeps(
  devDependencies: PkgDep,
  dependencies: PkgDep,
) {
  const duplicateDeps = Object.keys(devDependencies).filter(
    (dep) => dependencies[dep],
  );
  if (duplicateDeps.length > 0) {
    throw new Error(
      `"${duplicateDeps.join(", ")}" is listed in both "devDependencies" and "dependencies". Keep it in one.`,
    );
  }
}
