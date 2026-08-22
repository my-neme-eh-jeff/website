import { component$, useStyles$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { Link } from "@qwik.dev/router";
import { StreamText } from "~/components/stream-text/stream-text";
import { GenerativeMesh } from "~/components/generative-mesh/generative-mesh";
import { profile } from "~/content/profile";
import { homeGraph, ld, seoMeta } from "~/content/seo";

export default component$(() => {
  useStyles$(`
    .hero { display: grid; gap: 2rem; }
    .hero-fig { border: 1px solid var(--line); border-radius: 12px; padding: 1rem; background: var(--surface); }
    .links { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.5rem; }
    .cta { display: inline-flex; gap: 0.4rem; align-items: center;
           border: 1px solid var(--line); border-radius: 999px;
           padding: 0.45rem 0.95rem; text-decoration: none; font-size: 0.94rem; }
    .cta:hover { border-color: var(--accent); }
    @media (min-width: 820px) {
      .hero { grid-template-columns: 1.15fr 0.85fr; align-items: center; }
    }
  `);

  return (
    <div class="wrap">
      <section class="hero">
        <div>
          <h1>
            <StreamText text={profile.name} stagger={70} />
          </h1>
          <p class="muted" style={{ fontSize: "1.15rem" }}>
            <StreamText text={profile.tagline} stagger={45} caret />
          </p>
          <p>{profile.bio}</p>
          <div class="links">
            <Link class="cta" href="/resume/">
              Resume →
            </Link>
            <Link class="cta" href="/blog/">
              Writing →
            </Link>
            {profile.links.map((l) => (
              <a class="cta" key={l.href} href={l.href} rel="me noopener">
                {l.label}
              </a>
            ))}
          </div>
        </div>
        <div class="hero-fig">
          <GenerativeMesh seed={11} nodes={30} />
        </div>
      </section>
    </div>
  );
});

export const head: DocumentHead = {
  title: profile.jobTitle ? `${profile.name} — ${profile.jobTitle}` : profile.name,
  meta: seoMeta({
    path: "/",
    title: profile.jobTitle ? `${profile.name} — ${profile.jobTitle}` : profile.name,
    description: profile.tagline,
    ogType: "profile",
  }),
  scripts: [
    { type: "application/ld+json", key: "ld-home", dangerouslySetInnerHTML: ld(homeGraph()) },
  ],
};
