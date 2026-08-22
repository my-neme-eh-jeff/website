import { component$, useStyles$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { posts, profile } from "~/content/profile";

// Sorted once at module scope, not per render — see Qwik best practices.
const sorted = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));

export default component$(() => {
  useStyles$(`
    .post { border-top: 1px solid var(--line); padding: 1.15rem 0; }
    .post h2 { font-size: 1.15rem; margin: 0 0 0.25rem; }
    .date { color: var(--muted); font-size: 0.85rem; }
  `);

  return (
    <div class="wrap">
      <h1>Writing</h1>
      {sorted.map((p) => (
        <article class="post" key={p.slug}>
          <h2>{p.title}</h2>
          <div class="date">{p.date}</div>
          <p class="muted">{p.summary}</p>
        </article>
      ))}
    </div>
  );
});

export const head: DocumentHead = {
  title: `Writing — ${profile.name}`,
  meta: [{ name: "description", content: `Posts by ${profile.name}.` }],
};
