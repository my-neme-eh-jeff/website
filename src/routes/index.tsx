import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { DeskArt } from "~/components/desk/desk-art";
import { Terminal } from "~/components/terminal/terminal";
import { profile } from "~/content/profile";
import { homeGraph, ld, seoMeta } from "~/content/seo";

export default component$(() => (
  <Terminal>
    <DeskArt q:slot="idle" />
  </Terminal>
));

const title = `${profile.name} — ${profile.jobTitle}`;

export const head: DocumentHead = {
  title,
  frontmatter: { column: "stage" },
  meta: seoMeta({
    path: "/",
    title,
    description: profile.tagline,
    ogType: "video.other",
    video: "/og/home.mp4",
  }),
  scripts: [
    {
      type: "application/ld+json",
      key: "ld-home",
      dangerouslySetInnerHTML: ld(homeGraph()),
    },
  ],
};
