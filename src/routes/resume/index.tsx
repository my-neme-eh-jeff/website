import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import {
  achievements,
  education,
  profile,
  roles,
  skills,
} from "~/content/profile";
import { ld, resumeGraph, seoMeta } from "~/content/seo";

/**
 * Consecutive roles at the same company are grouped under one heading, so a
 * three-title progression reads as one tenure rather than three separate jobs.
 * Computed at module scope — the data is static, so this runs once.
 */
const grouped = roles.reduce<
  Array<{ company: string; url?: string; entries: typeof roles }>
>((acc, role) => {
  const last = acc.at(-1);
  if (last && last.company === role.company) last.entries.push(role);
  else
    acc.push({
      company: role.company,
      ...(role.companyUrl ? { url: role.companyUrl } : {}),
      entries: [role],
    });
  return acc;
}, []);

export default component$(() => {
  return (
    <div class="wrap">
      <div class="max-w-measure">
        <p class="eyebrow mb-3">
          {profile.city}
          {profile.email && (
            <>
              {" · "}
              <a href={`mailto:${profile.email}`}>{profile.email}</a>
            </>
          )}
        </p>
        <h1 class="mb-8">Resume</h1>

        <section>
          <p class="eyebrow mb-4">Experience</p>
          {grouped.map((g) => (
            <div class="hairline" key={g.company}>
              <h2 class="mb-3 text-base font-medium">
                {g.url ? (
                  <a href={g.url} rel="noopener">
                    {g.company}
                  </a>
                ) : (
                  g.company
                )}
              </h2>

              {g.entries.map((r) => (
                <article class="mb-5 last:mb-0" key={r.title + r.period}>
                  <div class="flex flex-wrap items-baseline gap-x-3">
                    <h3 class="text-base font-medium">{r.title}</h3>
                    <span class="text-muted ml-auto font-mono text-xs whitespace-nowrap">
                      {r.period} · {r.location}
                    </span>
                  </div>
                  <ul class="mt-2 flex flex-col gap-1.5 p-0">
                    {r.points.map((pt, i) => (
                      <li class="flex list-none gap-2.5" key={i}>
                        <span
                          class="text-accent mt-[0.15em] shrink-0 font-mono text-xs"
                          aria-hidden="true"
                        >
                          —
                        </span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          ))}
        </section>

        <section class="mt-14">
          <p class="eyebrow mb-4">Skills</p>
          {skills.map((grp) => (
            <div class="hairline" key={grp.group}>
              <h3 class="text-muted mb-2 text-sm">{grp.group}</h3>
              <ul class="flex flex-wrap gap-2 p-0">
                {grp.items.map((s) => (
                  <li class="pill py-1 text-sm" key={s}>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section class="mt-14">
          <p class="eyebrow mb-4">Achievements</p>
          <ul class="flex flex-col p-0">
            {achievements.map((a) => (
              <li class="hairline list-none" key={a.title}>
                <span class="font-medium">{a.title}</span>
                {a.note && <p class="text-muted mt-1 mb-0">{a.note}</p>}
              </li>
            ))}
          </ul>
        </section>

        <section class="mt-14">
          <p class="eyebrow mb-4">Education</p>
          <div class="hairline">
            <div class="flex flex-wrap items-baseline gap-x-3">
              <h3 class="text-base font-medium">{education.school}</h3>
              <span class="text-muted ml-auto font-mono text-xs whitespace-nowrap">
                {education.period}
              </span>
            </div>
            <p class="text-muted mt-1 mb-0">
              {education.degree} · {education.note}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
});

const desc = `Experience, skills and projects for ${profile.name}, ${profile.jobTitle} at ${profile.employer?.name ?? ""}.`;

export const head: DocumentHead = {
  title: `Resume — ${profile.name}`,
  meta: seoMeta({
    path: "/resume/",
    title: `Resume — ${profile.name}`,
    description: desc,
  }),
  scripts: [
    {
      type: "application/ld+json",
      key: "ld-resume",
      dangerouslySetInnerHTML: ld(resumeGraph()),
    },
  ],
};
