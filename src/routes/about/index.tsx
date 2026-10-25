import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { Link } from "@qwik.dev/router";
import {
  achievements,
  education,
  posts,
  profile,
  projects,
  roles,
  skills,
} from "~/content/profile";
import { aboutGraph, ld, seoMeta } from "~/content/seo";

/*
 * What the shell prints on request, as a page. Crawlers and AI answer engines
 * read the served HTML and never type a command.
 */

const link = "decoration-accent/60 underline";

const Out = ({
  href,
  label,
  what,
}: {
  href: string;
  label: string;
  what: string;
}) => (
  <a href={href} class={link}>
    {label}
    <span class="sr-only">{` for ${what}`}</span>
    <span class="font-arrow ml-1" aria-hidden="true">
      ↗
    </span>
  </a>
);

export default component$(() => {
  return (
    <div class="space-y-4">
      <h1 class="mb-2">{profile.name}</h1>
      <p class="text-muted">{profile.tagline}</p>
      <p>{profile.bio}</p>

      <h2 class="pt-6">Work</h2>
      {roles.map((r) => (
        <section key={`${r.title}${r.period}`} class="space-y-2 pt-2">
          <h3 class="font-medium">
            {r.title},{" "}
            {r.companyUrl ? (
              <a href={r.companyUrl} class={link}>
                {r.company}
              </a>
            ) : (
              r.company
            )}
          </h3>
          <p class="text-muted text-sm">
            {r.period} · {r.location}
          </p>
          <ul class="list-disc space-y-2 pl-5">
            {r.points.map((pt) => (
              <li key={pt}>{pt}</li>
            ))}
          </ul>
        </section>
      ))}

      <h2 class="pt-6">Projects</h2>
      {projects.map((p) => (
        <section key={p.slug} class="space-y-2 pt-2">
          <h3 class="font-medium">{p.title}</h3>
          {p.detail.map((d) => (
            <p key={d}>{d}</p>
          ))}
          <p class="text-muted text-sm">
            {p.stack.join(", ")}
            {p.repo && (
              <>
                {" · "}
                <Out href={p.repo} label="Code" what={p.title} />
              </>
            )}
            {(p.links ?? []).map((l) => (
              <span key={l.href}>
                {" · "}
                <Out href={l.href} label={l.label} what={p.title} />
              </span>
            ))}
          </p>
        </section>
      ))}

      {posts.length > 0 && (
        <>
          <h2 class="pt-6">Writing</h2>
          <ul class="list-disc space-y-2 pl-5">
            {posts.map((p) => (
              <li key={p.slug}>
                <Link href={`/blog/${p.slug}/`} class={link}>
                  {p.title}
                </Link>
                <span class="text-muted">: {p.summary}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 class="pt-6">Education</h2>
      <p>
        {education.degree}, {education.school}, {education.period}.{" "}
        <span class="text-muted">{education.note}.</span>
      </p>

      <h2 class="pt-6">Achievements</h2>
      <ul class="list-disc space-y-2 pl-5">
        {achievements.map((a) => (
          <li key={a.title}>
            {a.title}
            {a.note && <span class="text-muted">. {a.note}</span>}
          </li>
        ))}
      </ul>

      <h2 class="pt-6">Skills</h2>
      <dl class="space-y-2">
        {skills.map((g) => (
          <div key={g.group}>
            <dt class="font-medium">{g.group}</dt>
            <dd class="text-muted">{g.items.join(", ")}</dd>
          </div>
        ))}
      </dl>

      <h2 class="pt-6">Contact</h2>
      <p>
        Email{" "}
        <a href={`mailto:${profile.email}`} class={link}>
          {profile.email}
        </a>
        , or find me on{" "}
        {profile.links.map((l, i) => (
          <span key={l.href}>
            {i > 0 && (i === profile.links.length - 1 ? " and " : ", ")}
            <a href={l.href} rel="me noopener" class={link}>
              {l.label}
            </a>
          </span>
        ))}
        . My{" "}
        <a href={profile.resume} class={link}>
          resume
        </a>{" "}
        is a PDF on FlowCV.
      </p>
    </div>
  );
});

const title = `About — ${profile.name}`;

export const head: DocumentHead = {
  title,
  frontmatter: { column: "reading" },
  meta: seoMeta({
    path: "/about/",
    title,
    description: `${profile.name}'s roles at ${profile.employer?.name ?? "work"}, his projects in AI agents, LLM serving and MLOps, and his education, achievements and stack.`,
    ogType: "profile",
  }),
  scripts: [
    {
      type: "application/ld+json",
      key: "ld-about",
      dangerouslySetInnerHTML: ld(aboutGraph()),
    },
  ],
};
