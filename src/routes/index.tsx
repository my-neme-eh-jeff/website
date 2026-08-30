import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { CircledChoice } from "~/components/circled-choice/circled-choice";
import { Terminal } from "~/components/terminal/terminal";
import { CopyEmail } from "~/components/copy-email";
import { profile, projects, roles } from "~/content/profile";
import { homeGraph, ld, seoMeta } from "~/content/seo";

const current = roles[0];

/**
 * Two sections, and the gradient behind them is the same element.
 *
 * Section one is nothing but the wash and the name — no card, no eyebrow, no
 * boxed panel. Section two is the shell. Between them the background shifts
 * hue, driven by scroll position in CSS (see `.field` in global.css), so the
 * change reads as one continuous surface moving rather than two backgrounds
 * swapping.
 *
 * There is no <GradientPanel> any more. The gradient used to be a rounded card
 * inside the content column, which made it a widget; as the page background it
 * is the thing the content sits on.
 */
export default component$(() => {
  return (
    <>
      {/* Section 1 — gradient and name only. */}
      <section class="flex min-h-[62vh] flex-col justify-center lg:min-h-[68vh]">
        <h1 class="max-w-[20ch]">{profile.name}</h1>
        <p class="max-w-measure text-muted mt-4 text-xl leading-snug">
          {profile.tagline}
        </p>
        <div class="mt-7 flex flex-wrap items-center gap-3">
          {/*
           * The address itself, not the word "Email" — a mailto: link is a
           * no-op on any machine with no mail handler registered, and this
           * used to be the only place the address appeared. See CopyEmail.
           */}
          <CopyEmail email={profile.email} />
          <CircledChoice label="say hi" />
        </div>
      </section>

      {/* Section 2 — the shell. */}
      <section class="pt-8">
        <div class="mb-3 flex items-baseline justify-between gap-4">
          <p class="eyebrow">Shell</p>
          <span class="text-muted font-mono text-xs">try `help`</span>
        </div>
        <Terminal />
      </section>

      {current && (
        <section class="max-w-measure mt-20">
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
                    <span
                      class="text-accent ml-1 font-mono text-xs"
                      aria-hidden="true"
                    >
                      ↗
                    </span>
                  </a>
                ) : (
                  pr.title
                )}
              </h2>
              <span class="text-muted ml-auto font-mono text-xs">
                {pr.updated.slice(0, 7)}
              </span>
            </div>
            <p class="text-muted mt-1 mb-3">{pr.summary}</p>

            {/*
             * The detail paragraphs were already written (drawn from each repo's
             * README) but rendered nowhere, which is the worst of both: the words
             * exist and no reader or retrieval engine can see them.
             *
             * This is the one lever that raises content depth without inventing
             * anything — retrieval systems select passages, and a 140-word page
             * offers almost nothing to select.
             */}
            {pr.detail.map((d, i) => (
              <p class="mb-2 last:mb-3" key={i}>
                {d}
              </p>
            ))}

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
    </>
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
