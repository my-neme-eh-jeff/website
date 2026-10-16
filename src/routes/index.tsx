import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { DeskArt } from "~/components/desk/desk-art";
import { Terminal } from "~/components/terminal/terminal";
import { profile, projects, roles } from "~/content/profile";
import { homeGraph, ld, seoMeta } from "~/content/seo";

const current = roles[0];

/**
 * The first screen is the shell, with the desk drawn inside it. What he does
 * now and his selected work come after, for anyone who scrolls instead.
 */
export default component$(() => {
  return (
    <>
      <Terminal>
        <DeskArt q:slot="idle" />
      </Terminal>

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
                    <span
                      class="text-accent font-arrow ml-1 text-xs"
                      aria-hidden="true"
                    >
                      ↗
                    </span>
                  </a>
                ) : (
                  pr.title
                )}
              </h2>

              {/*
               * Demo, write-up, whatever exists off the repo — in the space the
               * date used to occupy. A repo link asks someone to read source
               * before they know if they care; a 3-minute demo shows the thing
               * working. Where both exist, this is the better first click, so
               * Repo comes last. Repo is repeated here even though the title
               * links to it: an unlabelled title link went unnoticed.
               *
               * The visible label is short so the row stays quiet, so the
               * project title is appended sr-only: a screen reader listing
               * links hears "Demo video, Autonomous ML Deployment System"
               * rather than three identical "Demo video" entries.
               */}
              {(pr.links?.length || pr.repo) && (
                <span class="ml-auto flex flex-wrap items-baseline gap-x-3">
                  {[
                    ...(pr.links ?? []),
                    ...(pr.repo ? [{ label: "Repo", href: pr.repo }] : []),
                  ].map((l) => (
                    <a
                      key={l.href}
                      href={l.href}
                      rel="noopener"
                      class="text-muted hover:text-text font-mono text-xs"
                    >
                      {l.label}
                      <span class="sr-only">, {pr.title}</span>
                      <span class="text-accent ml-1" aria-hidden="true">
                        ↗
                      </span>
                    </a>
                  ))}
                </span>
              )}
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
  frontmatter: { column: "stage" },
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
