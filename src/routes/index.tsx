import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { CircledChoice } from "~/components/circled-choice/circled-choice";
import { GradientPanel } from "~/components/gradient-panel/gradient-panel";
import { profile, projects, roles } from "~/content/profile";
import { homeGraph, ld, seoMeta } from "~/content/seo";

const current = roles[0];

/**
 * The gradient panel is the hero, with the name set over it.
 *
 * Text on top of the artwork rather than beside it. A panel parked next to a
 * paragraph is what the last two attempts both did, and it always reads as a
 * widget rather than a composition. Over the panel, the ember gives the name
 * somewhere to sit and the page opens on colour instead of on a border.
 *
 * The overlay text is a fixed near-white, not --sem-text. The panel does not
 * theme-swap (it is artwork), so text that DID swap would turn dark-on-dark in
 * light mode. Every hue in the panel is dark enough for white to hold.
 */
export default component$(() => {
  return (
    <div class="wrap">
      <section class="relative">
        <GradientPanel class="min-h-[19rem] sm:min-h-[23rem] lg:min-h-[26rem]" />

        <div class="absolute inset-0 flex flex-col justify-end p-6 sm:p-8 lg:p-10">
          <p class="mb-2 font-mono text-[0.6875rem] tracking-[0.12em] text-white/70 uppercase">
            {profile.jobTitle} · {profile.city}
          </p>
          <h1 class="max-w-[18ch] text-white">{profile.name}</h1>
        </div>
      </section>

      <p class="max-w-measure text-muted mt-8 text-xl leading-snug">
        {profile.tagline}
      </p>

      <p class="max-w-measure mt-4">{profile.bio}</p>

      <div class="mt-6 flex flex-wrap items-center gap-3">
        <a class="pill hover:border-accent" href={`mailto:${profile.email}`}>
          Email
        </a>
        <CircledChoice label="say hi" />
      </div>

      {current && (
        <section class="max-w-measure mt-16">
          <p class="eyebrow mb-4">Now</p>
          <div class="hairline flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span class="font-medium">{current.title}</span>
            <span class="text-muted">
              {current.companyUrl ? (
                <a href={current.companyUrl} rel="noopener">
                  {current.company}
                </a>
              ) : (
                current.company
              )}
            </span>
            <span class="text-muted ml-auto font-mono text-sm">
              {current.period}
            </span>
          </div>
        </section>
      )}

      <section class="max-w-measure mt-16">
        <div class="mb-4 flex items-baseline justify-between gap-4">
          <p class="eyebrow">Selected work</p>
          <span class="text-muted font-mono text-xs">
            {projects.length} projects
          </span>
        </div>

        {projects.map((pr) => (
          <article class="hairline" key={pr.slug}>
            <div class="flex flex-wrap items-baseline gap-x-3">
              <h2 class="text-base font-medium">
                {pr.repo ? (
                  <a href={pr.repo} rel="noopener">
                    {pr.title}
                  </a>
                ) : (
                  pr.title
                )}
              </h2>
              <span class="text-muted ml-auto font-mono text-xs">
                {pr.updated.slice(0, 7)}
              </span>
            </div>
            <p class="text-muted mt-1 mb-2">{pr.summary}</p>
            <ul class="text-muted flex flex-wrap gap-x-3 gap-y-1 p-0 font-mono text-xs">
              {pr.stack.map((t) => (
                <li class="list-none" key={t}>
                  {t}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </div>
  );
});

const title = `${profile.name} — ${profile.jobTitle}`;

export const head: DocumentHead = {
  title,
  meta: seoMeta({
    path: "/",
    title,
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
