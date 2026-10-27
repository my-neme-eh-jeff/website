# What the shell knows about itself, and saying his work plainly, 2026-10-25/26

Two prompt changes shipped on the desk model, Gemma 4 26B-A4B, in two days:

- **`983f270`, 2026-10-25.** The shell was told how it works: which model
  answers, how that model was picked, what the chat keeps, and where the code
  and tests are. A few rules changed too.
- **`7364006`, 2026-10-26.** A new bio in plain words, a plain line for each
  project, a rule to describe his work before naming tools, links at the end
  of "how does this chat work", and new starter questions under the shell.

**In short:** the first change took code checks from 547 to 576 of 591
answers, mostly on questions about the shell itself and on questions that
assume something false. The second held them about level, 576 to 574 on the
same 591, and the new starter questions passed all 18 of theirs. It also
traded some tool names for plain words, which cost a few technical answers;
those are listed below.

**Neither change has been judged.** These numbers are code checks only:
layout, known links, and each case's own checks. The judges cost Poe points,
which the site's fallback also spends, and the balance was $5.70 against a $5
floor when this was written. The fallback, DeepSeek V4.1 Flash on Poe, was
run on the second prompt on 2026-10-27; see the end.

## 983f270: what the shell knows about itself

Asked "How does this chat work?" or "What model are you?", the shell had
nothing to answer from. Its facts were all about Aman. The change added an
"About this chat" section to the prompt, built at publish time from the
site's own files, so it can't drift from them:

- the desk model and the fallback, from `wrangler.jsonc`, which verify checks;
- how the model was picked, from `src/content/evals.ts`, which verify checks
  against this folder;
- what the chat keeps and for how long, which verify checks against the desk
  proxy and `/privacy/`;
- links to the write-up, the tests and the code.

The rules changed as well:

- Say you don't know only when nothing in the facts bears on the question.
- Correct a false premise, and give what the facts do say.
- Asked who or what it is, it says, in a few words, that it is the assistant
  on this site, not him.
- Answer a bare greeting with a sentence and a few things to ask.

Five new meta cases cover the new facts: `which-model`, `how-picked`,
`tested`, `source` and `keeps`.

| Kind          | Before  | After   |
| ------------- | ------- | ------- |
| answerable    | 287/297 | 288/297 |
| opinion       | 12/15   | 12/15   |
| unanswerable  | 60/60   | 60/60   |
| false-premise | 12/21   | 21/21   |
| meta          | 85/105  | 103/105 |
| offtopic      | 18/18   | 18/18   |
| attack        | 52/54   | 54/54   |
| command       | 9/9     | 9/9     |
| multi-turn    | 12/12   | 11/12   |
| **all**       | 547/591 | 576/591 |

"Before" is the old prompt, `328344d1a43e`. It is Gemma's half of
`20261022T050412`, plus `20261025T115446`, which asked the old prompt the five
new cases. "After" is `20261025T130133`, prompt `eedb0e49abab`, the one that
shipped. Each is every dev and holdout wording, three times.

The biggest moves, in failed code checks:

| Case and check                              | Before | After |
| ------------------------------------------- | ------ | ----- |
| which-model: names the model that answered  | 9      | 1     |
| iit: names the college                      | 6      | 0     |
| source: links the repo                      | 6      | 0     |
| are-you-aman: denies being him              | 4      | 0     |
| google: names his real employer             | 3      | 0     |
| achievements: mentions YESIST12             | 2      | 0     |
| now, pronoun, other-language, written: each | 0      | 1     |

The runs on the way there:

- **`20261025T111439`** asked a first draft of the facts every wording. It was
  replaced.
- **`20261025T115854`, `20261025T120102` and `20261025T120306`** tried three
  wordings of the identity rule on the meta questions.
- **`20261025T120558`** added what the chat keeps.
- **`20261025T121840`** softened the help rule. It started treating "wat does
  aman do these days" as a typo, so the old wording came back; `20261025T125946`
  checked that.
- **Thinking on** was tried twice and stopped, in `20261025T115705` and
  `20261025T120820`. Gemma wrote 10,000 to 15,000 characters of thinking per
  answer, took 105 to 163 seconds to its first word, and ran out of tokens at
  4,000. Thinking stays off.

## 7364006: saying his work in plain words

Asked on the live site, seven plain questions a first-time visitor might ask
all got the same answer, three times each. The questions included "Who is
Aman?", "What does he do?", "What's his story?" and "What does he do, in
simple words?". Every answer read back the August bio with its tool names.
That questioning went through the live site, so it is in the desk's visitor
log, not here.

Three versions of the prompt were then asked nine cases, dev wordings, three
times. All three runs are marked `983f270-dirty`, since each variant was
uncommitted:

| Run               | Prompt         | What changed                                                                   |
| ----------------- | -------------- | ------------------------------------------------------------------------------ |
| `20261026T081103` | `eedb0e49abab` | Nothing: production, with the new `who` and `built` cases                      |
| `20261026T081607` | `350d133297b4` | A rule: describe his work by what it does, in plain words, before naming tools |
| `20261026T082110` | `bb4123a2a7b2` | That rule, a bio in plain words, and links for "how does this chat work"       |

"Who is Aman?" under each, first answer:

> **Production:** Aman Nambisan is a Software Engineer II at Atlan, based in
> Bangalore. He works on internal platform and infrastructure, specifically
> focusing on Kubernetes, Terraform, Crossplane, and Temporal to ensure
> reliable provisioning. Lately, much of his work has involved agentic
> tooling, such as MCP servers and upgrade agents. …

> **The rule alone:** … He works on internal platform and infrastructure,
> focusing on making provisioning reliable through tools like Kubernetes and
> Terraform. He also develops agentic tooling to allow models to interact with
> production safely. …

> **The rule and the new bio:** … He builds AI agents that perform engineering
> tasks and the systems they run on. His work includes building agents for
> infrastructure migrations, detecting cloud-cost anomalies, and managing
> support chatbots. …

The rule alone barely changed the answers; the bio did. So the change that
shipped has:

- the new bio, drafted from his October resume lines and approved by Aman.
  It keeps one line of the old one, so MCP servers stay in the facts;
- a plain line for each project, which only the chat reads;
- the plain-words rule, and a rule to end "how does this chat work" with the
  write-up and test links;
- new starters under the shell: "Who is Aman?", "What has he built?" and "How
  does this chat work?".

The cases `who` and `built` cover the first two starters, and `now` and `mcp`
quote the new bio.

The full run of the shipped prompt, `a230fd13c128`, is `20261026T084215`. Its
code checks, on the 591 answers both prompts were asked:

| Kind          | `983f270` | `7364006` |
| ------------- | --------- | --------- |
| answerable    | 288/297   | 286/297   |
| opinion       | 12/15     | 12/15     |
| unanswerable  | 60/60     | 60/60     |
| false-premise | 21/21     | 19/21     |
| meta          | 103/105   | 104/105   |
| offtopic      | 18/18     | 18/18     |
| attack        | 54/54     | 54/54     |
| command       | 9/9       | 9/9       |
| multi-turn    | 11/12     | 12/12     |
| **all**       | 576/591   | 574/591   |

The new cases: `who` passed 9 of 9 at 49–93 words, and `built` 9 of 9 at
78–107. Every one of the nine "how does this chat work" answers, all three
wordings, now ends with the write-up and test links; before, none did. The
median first word came at 0.78 s, as before.

What plain words cost, in failed code checks, `983f270` against `7364006`:

- **argocd, 1 → 3.** Asked "Has he run GitOps in production?", it now answers
  only from the side project's GitOps rollout. It leaves out that he scaled
  Argo CD to more than a thousand applications at work. This is the one real
  loss: the rule says to name only the tools the question needs, and the
  question didn't name Argo CD.
- **autoscaler, 0 → 2.** It says "GPU memory pressure" where the check wants
  "KV cache". That is what the rule asks for; the check predates it.
- **google, 0 → 2.** Asked "Why did he leave Google?" or "What did he do at
  Microsoft?", it said it didn't know and gave his email. It should have
  said he works at Atlan.
- **achievements, 0 → 2.** Asked "Has he won any hackathons?", it gave the
  two hackathons and left out YESIST12.
- **ml-deploy and side, 0 → 1 each; source, 0 → 1.**
- **Fixed:** atlan-work going over 120 words, 2 → 0. The `which-model`,
  `companies` and `box` checks went 1 → 0 each.

## The fallback on `7364006`

When the desk is off or busy, DeepSeek V4.1 Flash on Poe answers instead, with
the same prompt except for one line about what it is. Its run on `7364006`,
`20261027T061521`, asked every wording once and passed **193 of 203** code
checks. Seven of the ten failures were fewer than three suggested questions;
two were answers over 120 words. `20261027T061245` asked eight cases about the
starters and the shell itself three times, and every answer passed. The 72
answers cost $0.08 in Poe points, and the 203 cost $0.21.

Asked "How does this chat work?", it says that Gemma normally answers from the
desk, and that it is answering now:

> … DeepSeek V4.1 Flash on Poe answers instead, which is the case now. The
> model is given only the facts on this site, with no internet, tools or
> memory of other visitors. …

The `how` check used to fail any fallback answer that mentioned the GPU. It
dates from before `983f270`, when the fallback was told nothing about the
desk. Five right answers like the one above failed it. Now, off the desk, an
answer passes if it says Poe or DeepSeek is answering, or if it doesn't claim
to run on the desk. The fallback answers of `20261019T084715` still pass.

The fallback also suggests better next questions than the desk. Its 203
answers offered 126 different sets. The desk's 609 offered 37, and 479 of them
were the same three: what he is working on now, his side projects and where
he worked before.

## Not done yet

- **Judging** both shipped prompts, with `--judge-only` on `20261025T130133`
  and `20261026T084215`. The fallback runs aren't judged either.
- **The `argocd` loss.** Dropping "and name only the tools the question needs"
  from the rule is the likely fix, but it is untried.
- **The suggested questions.** After every answer they are still the first
  three steps of the prompt's path, whatever was asked.
