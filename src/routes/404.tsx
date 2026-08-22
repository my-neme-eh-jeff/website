import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { Link } from "@qwik.dev/router";
import { profile } from "~/content/profile";

export default component$(() => {
  return (
    <div class="wrap">
      <h1>404</h1>
      <p class="muted">That page doesn't exist.</p>
      <p>
        <Link href="/">Back home →</Link>
      </p>
    </div>
  );
});

export const head: DocumentHead = {
  title: `Not found — ${profile.name}`,
  meta: [{ name: "robots", content: "noindex" }],
};
