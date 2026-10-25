import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { AnalyticsChoice } from "~/components/analytics-choice";
import { MAX_TURNS } from "~/content/chat";
import { profile } from "~/content/profile";
import { ld, privacyGraph, seoMeta } from "~/content/seo";

// Each sentence states how the site behaves: change it with that behaviour.
const UPDATED = "2026-10-19";

export default component$(() => {
  return (
    <div class="max-w-measure space-y-4">
      <h1 class="mb-2">Privacy</h1>
      <p class="text-muted">
        This site is run by {profile.name}, an individual in India. Questions or
        requests about your data:{" "}
        <a
          href={`mailto:${profile.email}`}
          class="decoration-accent/60 underline"
        >
          {profile.email}
        </a>
        .
      </p>

      <h2 class="pt-6">No cookies</h2>
      <p>
        The site sets no cookies. Pages are served by Cloudflare, which, like
        any host, processes your IP address and request details to deliver pages
        and keep the site secure.
      </p>

      <h2 class="pt-6">Analytics</h2>
      <p>
        Cloudflare Web Analytics counts page views, which page you came from,
        your browser type and how fast pages load. It uses no cookies and stores
        nothing on your device. It never loads if you are in the EU, EEA, UK or
        Switzerland, if your browser sends Global Privacy Control or Do Not
        Track, or if you turn it off here:
      </p>
      <AnalyticsChoice />

      <h2 class="pt-6">Stored on your device</h2>
      <ul class="list-disc space-y-2 pl-5">
        <li>
          If you use the shell on the home page, what you type is kept in that
          browser tab so the up arrow can recall it. That copy never leaves your
          browser and is cleared when you close the shell or the tab. Questions
          you ask the chat are sent as described below.
        </li>
        <li>
          If you mute the shell, that choice is saved in your browser until you
          unmute or clear site data.
        </li>
        <li>
          If you turn analytics off above, that choice is saved the same way.
        </li>
        <li>
          If you pick a theme, or light or dark, that choice is saved the same
          way too.
        </li>
      </ul>

      <h2 class="pt-6">The chat</h2>
      <p>
        Questions typed into the shell are answered by an AI model running on my
        own computer. It answers from my CV and can be wrong. When you ask one,
        your question and up to {MAX_TURNS - 1} earlier messages of the
        conversation pass through Cloudflare to that computer. Cloudflare uses
        your IP address only to limit how many questions one network can send
        per minute; my computer never receives it.
      </p>
      <p>
        If my computer is off, busy, unreachable or too slow to start an answer,
        your question and the earlier turns go to Poe, a service run by Quora,
        Inc., and an AI model there answers instead. Your IP address and country
        are not sent. Poe’s answers are not in my log; Poe’s privacy policy
        covers what it keeps.
      </p>
      <p>
        My computer keeps a log of each exchange: your question, the earlier
        turns, the answer and the model’s working notes, the time and your
        country. I read it to see what people ask and to improve the answers.
        Each log is deleted after 30 days. Please don’t type anything sensitive.
        The chat is optional; the rest of the site works without it.
      </p>

      <h2 class="pt-6">Why, and who else</h2>
      <p>
        I process this to run, protect and improve a working demo of my own
        work. Cloudflare, Inc. hosts the site, carries the chat traffic and runs
        the analytics, and Quora, Inc. answers the chat through Poe when my
        computer can’t, on my behalf. Nothing is sold, shared for advertising or
        used to profile you.
      </p>

      <h2 class="pt-6">Your rights</h2>
      <p>
        You can ask me to show, correct or delete chat records about you. Tell
        me roughly when you chatted and what you asked, because I don’t know who
        you are. You can also complain to your data protection authority.
      </p>

      <p class="text-muted pt-6 text-sm">
        Last updated <time dateTime={UPDATED}>19 October 2026</time>.
      </p>
    </div>
  );
});

export const head: DocumentHead = {
  title: `Privacy — ${profile.name}`,
  meta: seoMeta({
    path: "/privacy/",
    title: `Privacy — ${profile.name}`,
    description: `What ${profile.name}'s site collects, why, and how to turn analytics off.`,
  }),
  scripts: [
    {
      type: "application/ld+json",
      key: "ld-privacy",
      dangerouslySetInnerHTML: ld(privacyGraph()),
    },
  ],
};
