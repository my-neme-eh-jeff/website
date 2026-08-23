import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { profile, roles, skills } from "~/content/profile";
import { ld, resumeGraph, seoMeta } from "~/content/seo";

export default component$(() => {
  return (
    <div class="wrap">
      <div class="max-w-measure">
        <h1>Resume</h1>
        {profile.city && <p class="text-muted">{profile.city}</p>}

        <h2 class="mt-8 mb-2">Experience</h2>
        {roles.length === 0 ? (
          <div class="callout">
            Nothing here yet. Add entries to{" "}
            <code class="font-mono text-sm">roles</code> in{" "}
            <code class="font-mono text-sm">src/content/profile.ts</code> —
            deliberately left empty rather than filled with invented history.
          </div>
        ) : (
          roles.map((r) => (
            <article class="hairline" key={`${r.company}-${r.title}`}>
              <div class="flex flex-wrap items-baseline gap-3">
                <h3 class="text-base font-semibold">{r.title}</h3>
                <span class="text-muted">{r.company}</span>
                <span class="text-muted ml-auto text-sm">{r.period}</span>
              </div>
              <ul class="mt-2 list-disc pl-5">
                {r.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </article>
          ))
        )}

        <h2 class="mt-8 mb-2">Skills</h2>
        {skills.length === 0 ? (
          <div class="callout">
            Add to <code class="font-mono text-sm">skills</code> in{" "}
            <code class="font-mono text-sm">src/content/profile.ts</code>.
          </div>
        ) : (
          <ul class="flex list-none flex-wrap gap-2 p-0">
            {skills.map((s) => (
              <li class="pill" key={s}>
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: `Resume — ${profile.name}`,
  meta: seoMeta({
    path: "/resume/",
    title: `Resume — ${profile.name}`,
    description: `Experience, roles and skills for ${profile.name}.`,
  }),
  scripts: [
    {
      type: "application/ld+json",
      key: "ld-resume",
      dangerouslySetInnerHTML: ld(resumeGraph()),
    },
  ],
};
