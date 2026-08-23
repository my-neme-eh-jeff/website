import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { Link } from "@qwik.dev/router";
import { StreamText } from "~/components/stream-text/stream-text";
import { CircledChoice } from "~/components/circled-choice/circled-choice";
import { profile, projects, roles } from "~/content/profile";
import { homeGraph, ld, seoMeta } from "~/content/seo";

const current = roles[0];

/**
 * Single column, left-aligned, no hero card.
 *
 * The previous layout put a boxed figure beside the text, which read as a
 * widget parked next to a paragraph. The generative mesh it contained is now
 * part of the page's atmosphere instead (see the `field` layer in layout.tsx),
 * so the eye lands on the sentence rather than on a rectangle.
 *
 * Sections are separated by eyebrow labels and hairlines rather than cards.
 * That keeps the page reading as one document, which is what a portfolio is.
 */
export default component$(() => {
  return (
    <div class="wrap">
      <div class="max-w-measure">
        <p class="eyebrow mb-3">
          {profile.jobTitle} · {profile.city}
        </p>

        <h1 class="mb-3">
          <StreamText text={profile.name} stagger={70} />
        </h1>

        <p class="text-muted mb-5 text-xl leading-snug">
          <StreamText text={profile.tagline} stagger={22} caret />
        </p>

        <p class="mb-6">{profile.bio}</p>

        <div class="flex flex-wrap items-center gap-3">
          <Link class="pill hover:border-accent" href="/resume/">
            Resume
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
          <CircledChoice label="say hi" />
        </div>
      </div>

      {/* Now — one line, because "what are you doing currently" is the first
          thing a recruiter scans for. */}
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
