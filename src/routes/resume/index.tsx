import { component$, useStyles$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { profile, roles, skills } from "~/content/profile";

export default component$(() => {
  useStyles$(`
    .role { border-top: 1px solid var(--line); padding: 1.25rem 0; }
    .role-h { display: flex; gap: 0.75rem; align-items: baseline; flex-wrap: wrap; }
    .role-h h3 { margin: 0; }
    .period { color: var(--muted); font-size: 0.88rem; margin-left: auto; }
    .chips { display: flex; gap: 0.5rem; flex-wrap: wrap; padding: 0; list-style: none; }
    .chips li { border: 1px solid var(--line); border-radius: 999px; padding: 0.25rem 0.7rem; font-size: 0.86rem; }
    .empty { border: 1px dashed var(--line); border-radius: 10px; padding: 1.25rem; color: var(--muted); }
  `);

  return (
    <div class="wrap">
      <h1>Resume</h1>
      <p class="muted">{profile.location}</p>

      <h2 style={{ marginTop: "2rem" }}>Experience</h2>
      {roles.length === 0 ? (
        <div class="empty">
          Nothing here yet. Add entries to <code class="mono">roles</code> in{" "}
          <code class="mono">src/content/profile.ts</code> — deliberately left empty rather than
          filled with invented history.
        </div>
      ) : (
        roles.map((r) => (
          <article class="role" key={`${r.company}-${r.title}`}>
            <div class="role-h">
              <h3>{r.title}</h3>
              <span class="muted">{r.company}</span>
              <span class="period">{r.period}</span>
            </div>
            <ul>
              {r.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </article>
        ))
      )}

      <h2 style={{ marginTop: "2rem" }}>Skills</h2>
      {skills.length === 0 ? (
        <div class="empty">
          Add to <code class="mono">skills</code> in <code class="mono">src/content/profile.ts</code>.
        </div>
      ) : (
        <ul class="chips">
          {skills.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
});

export const head: DocumentHead = {
  title: `Resume — ${profile.name}`,
  meta: [{ name: "description", content: `Resume and experience for ${profile.name}.` }],
};
