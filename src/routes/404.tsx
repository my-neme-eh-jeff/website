import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { Link } from "@qwik.dev/router";
import { profile } from "~/content/profile";

export default component$(() => {
  return (
    <div class="grid min-h-[calc(100dvh-17rem)] place-items-center">
      <div class="flex flex-col items-center gap-4 text-center">
        <h1 class="m-0 text-[clamp(6rem,22vw,11rem)] leading-none font-medium tabular-nums">
          404
        </h1>
        <p class="text-muted m-0 text-lg">That page doesn’t exist.</p>
        <Link href="/" class="text-lg">
          Back home →
        </Link>
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: `Not found — ${profile.name}`,
  frontmatter: { column: "stage" },
  meta: [{ name: "robots", content: "noindex" }],
};
