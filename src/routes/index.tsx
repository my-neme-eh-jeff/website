import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { Link } from "@qwik.dev/router";
import { StreamText } from "~/components/stream-text/stream-text";
import { GenerativeMesh } from "~/components/generative-mesh/generative-mesh";
import { profile } from "~/content/profile";
import { homeGraph, ld, seoMeta } from "~/content/seo";

/**
 * The hero is the one layout on the site that needs the page width rather than
 * the prose measure — at 68ch a two-column grid has nowhere to go, which is
 * why the container and measure tokens are now separate. Body copy inside the
 * left column is still clamped, via `max-w-measure` on the paragraph.
 */
export default component$(() => {
  return (
    <div class="wrap">
      <section class="grid items-center gap-8 md:grid-cols-[1.15fr_0.85fr]">
        <div>
          <h1 class="mb-2">
            <StreamText text={profile.name} stagger={70} />
          </h1>
          <p class="text-muted mb-4 text-xl">
            <StreamText text={profile.tagline} stagger={45} caret />
          </p>
          <p class="max-w-measure mb-4">{profile.bio}</p>
          <div class="mt-2 flex flex-wrap gap-4">
            <Link class="pill hover:border-accent" href="/resume/">
              Resume →
            </Link>
            <Link class="pill hover:border-accent" href="/blog/">
              Writing →
            </Link>
            {profile.links.map((l) => (
              <a
                class="pill hover:border-accent"
                key={l.href}
                href={l.href}
                rel="me noopener"
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>
        <div class="border-line bg-surface rounded-xl border p-4">
          <GenerativeMesh seed={11} nodes={30} />
        </div>
      </section>
    </div>
  );
});

export const head: DocumentHead = {
  title: profile.jobTitle
    ? `${profile.name} — ${profile.jobTitle}`
    : profile.name,
  meta: seoMeta({
    path: "/",
    title: profile.jobTitle
      ? `${profile.name} — ${profile.jobTitle}`
      : profile.name,
    description: profile.tagline,
    ogType: "profile",
  }),
  scripts: [
    {
      type: "application/ld+json",
      key: "ld-home",
      dangerouslySetInnerHTML: ld(homeGraph()),
    },
  ],
};
