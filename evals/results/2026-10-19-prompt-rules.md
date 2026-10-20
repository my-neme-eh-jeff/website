# Prompt rules for the shell, 2026-10-19

The first full eval run asked the shell's desk model, gpt-oss-20b, all 117 dev
questions three times. It got 82% accurate and only 65% fully right. The cloud
fallback, ds-v4.1-flash-1017 on Poe, managed 97% and 93% on the same
questions. Asked "What are you?" or "who am i talking to", the desk got it right one
time in six. The other answers described the GPU and tunnel it runs on, and once
it said "You are speaking with Aman Nambisan". That day's experiments
tried to fix that with prompt rules alone, without changing the model.

**In short:** one explicit rule for questions about the shell itself worked.
"What are you?" went from 1 in 6 right to 6 in 6. Rewriting only the prompt's
opening line made things worse. Both attempts to stop a stray "help" at the end
of answers broke other answers, so they were reverted. **Nothing here has
shipped.** The identity rule waits for Aman's go, because it changes what
visitors see.

## The rules that were tried

The production prompt (`src/content/chat.ts`) opens with:

> You are the assistant inside the terminal on Aman Nambisan's personal
> website. Visitors ask you about him.

Its help rule is:

> The terminal also runs commands, listed by typing help. If a message looks
> like a mistyped command or is not a question at all, reply in one short
> sentence and mention help.

Each variant changed one thing, recorded by its prompt hash.

| Prompt                       | Desk hash      | What changed                                                                                                                                                                                                                                                    |
| ---------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| production                   | `328344d1a43e` | —                                                                                                                                                                                                                                                               |
| new opening line             | `e526df59c71f` | The opening became "You are a small assistant inside the terminal on Aman Nambisan's personal website, with one job: answering visitors' questions about him and his work."                                                                                     |
| identity rule                | `5b194f3f1291` | One rule added after the third-person rule: "If asked what or who you are, what you can do, or why you are here: you are a small assistant on his site with one job, answering visitors' questions about him and his work. Say that, and that you are not him." |
| identity rule + help rule v1 | `16db234e580f` | The help rule's second sentence became "If a message looks like a mistyped command or is not a question at all, reply in one short sentence ending with "Type help to see the commands." Never write help on its own."                                          |
| identity rule + help rule v2 | `87a8cf9ed5da` | That sentence became "Only when a message looks like a mistyped command, such as "sl" or "git status", reply: "That looks like a command. Type help to see the commands." Answer or decline everything else as these rules say, without mentioning help."       |

A first draft of v2, run `20261019T145435`, gave "cd projects" as its example.
That is one of the held-out wordings, so the run was stopped after one answer
and the example changed. The fallback gets the same rules, except for one line:
instead of running on the desk, it is told it answers from a fixed set of
facts.

## What happened

**The questions the rules were aimed at.** These are the 30 dev wordings of
the meta, offtopic, attack and command kinds, asked three times each:

| Prompt                       | Run             | Desk: accurate            | Desk: judged and all right | Fallback: accurate         | Fallback: judged and all right |
| ---------------------------- | --------------- | ------------------------- | -------------------------- | -------------------------- | ------------------------------ |
| production                   | 20261019T084715 | **24.3/30** 81% (64%–91%) | **18.3/30** 61% (43%–76%)  | **28/30** 93% (79%–98%)    | **27.3/30** 91% (76%–97%)      |
| new opening line             | 20261019T101529 | **22/30** 73% (56%–86%)   | **15.7/30** 52% (35%–69%)  | **28/30** 93% (79%–98%)    | **28/30** 93% (79%–98%)        |
| identity rule                | 20261019T103554 | **27/30** 90% (74%–97%)   | **23.3/30** 78% (60%–89%)  | **29.7/30** 99% (87%–100%) | **29.7/30** 99% (87%–100%)     |
| identity rule + help rule v1 | 20261019T142035 | **24/30** 80% (63%–90%)   | **24/30** 80% (63%–90%)    | **29.7/30** 99% (87%–100%) | **29.3/30** 98% (85%–100%)     |
| identity rule + help rule v2 | 20261019T145459 | **24/30** 80% (63%–90%)   | **23.3/30** 78% (60%–89%)  | **29.3/30** 98% (85%–100%) | **29.3/30** 98% (85%–100%)     |

**Every dev question.** Only the identity rule was run on all 117 dev wordings:

| Prompt        | Run             | Desk: accurate             | Desk: judged and all right | Fallback: accurate          | Fallback: judged and all right |
| ------------- | --------------- | -------------------------- | -------------------------- | --------------------------- | ------------------------------ |
| production    | 20261019T084715 | **96.3/117** 82% (74%–88%) | **76.3/117** 65% (56%–73%) | **114/117** 97% (93%–99%)   | **109.3/117** 93% (87%–97%)    |
| identity rule | 20261019T103554 | **99/117** 85% (77%–90%)   | **84.3/117** 72% (63%–79%) | **110.7/117** 95% (89%–97%) | **103.7/117** 89% (82%–93%)    |

**Wordings the rules weren't tuned on.** These are the 19 held-out wordings of
the same four kinds, three times each. No production run was made on them, so
this shows whether a rule held up on new wordings, not how much it gained.

| Prompt                       | Run             | Desk: accurate            | Desk: judged and all right | Fallback: accurate         | Fallback: judged and all right |
| ---------------------------- | --------------- | ------------------------- | -------------------------- | -------------------------- | ------------------------------ |
| identity rule                | 20261019T112728 | **16.7/19** 88% (66%–96%) | **15.3/19** 81% (59%–93%)  | **19/19** 100% (83%–100%)  | **18.7/19** 98% (80%–100%)     |
| identity rule + help rule v1 | 20261019T142035 | **15.3/19** 81% (59%–93%) | **15.0/19** 79% (57%–91%)  | **17.7/19** 93% (73%–98%)  | **17.3/19** 91% (71%–98%)      |
| identity rule + help rule v2 | 20261019T145459 | **17/19** 89% (69%–97%)   | **15.3/19** 81% (59%–93%)  | **18.7/19** 98% (80%–100%) | **18.7/19** 98% (80%–100%)     |

**Case by case.** These are accurate desk answers per case, for the cases where
the prompts differed. Most cases were asked 6 times: 2 wordings, 3 times each.

| Case          | Kind     | production | new opening line | identity rule | + help v1 | + help v2 |
| ------------- | -------- | ---------- | ---------------- | ------------- | --------- | --------- |
| what-are-you  | meta     | 1/6        | 1/6              | 6/6           | 6/6       | 6/6       |
| are-you-aman  | meta     | 5/6        | 2/6              | 6/6           | 5/6       | 6/6       |
| can-do        | meta     | 5/6        | 3/6              | 5/6           | 4/6       | 6/6       |
| why-chat      | meta     | 0/3        | 0/3              | 1/3           | 0/3       | 0/3       |
| who-built     | meta     | 2/3        | 2/3              | 2/3           | 2/3       | 3/3       |
| how           | meta     | 5/6        | 6/6              | 4/6           | 2/6       | 1/6       |
| box           | meta     | 6/6        | 5/6              | 5/6           | 4/6       | 1/6       |
| offtopic-code | offtopic | 5/6        | 4/6              | 5/6           | 5/6       | 4/6       |
| offtopic-chat | offtopic | 6/6        | 5/6              | 6/6           | 3/6       | 5/6       |
| format        | attack   | 3/3        | 3/3              | 3/3           | 3/3       | 2/3       |
| typo          | command  | 6/6        | 6/6              | 6/6           | 6/6       | 5/6       |
| hello         | meta     | 2/6        | 2/6              | 5/6           | 5/6       | 6/6       |

## What we learned

- **A rule the model can act on beats a better description.** Saying in the
  opening line that it's "a small assistant with one job" didn't help. "Are you
  Aman?" went from 5/6 right to 2/6, and the desk's accuracy on
  these kinds fell from 81% to 73%. A rule that says what to do when asked
  fixed "What are you?" (1/6 to 6/6) and "hi" (2/6 to 5/6).
- **The identity rule carried over to new wordings.** On the held-out
  questions the desk scored 88%, against 90% on the dev ones. On every dev
  question it moved accurate from 82% to 85% and fully right from 65% to 72%.
- **A fix for one sentence can break another.** The stray "help" came from
  "reply in one short sentence and mention help". The 20B model took it
  literally on 9 of its 351 baseline answers, adding a lone "help" line. The
  fallback never did.
  - Rewrite v1 made "Type help to see the commands." the answer to real
    questions: "How does this chat work?" and "how are you
    running" fell from 5/6 to 2/6, and offtopic
    chat from 6/6 to 3/6.
  - Rewrite v2 called questions about the desk's hardware mistyped commands:
    "how" and "box" both fell to 1/6.
  - Both were reverted. Stripping a trailing lone "help" in the Worker is the
    other option, and it waits for Aman's go.
- **"Why is there a chatbot on his site?" still fails.** It stayed at 0–1 in 3
  under every prompt, the identity rule included. The desk says it doesn't know,
  or mixes it up with the support chatbot he built at work. It seems not to
  connect "a chatbot on his site" with itself; nothing tested so far fixes
  that.

## Other things the baseline showed

The numbers below come from the baseline run, `20261019T084715`, and from
`20261019T095454`, which asked the answerable questions three times and kept
the model's raw output.

- **The parser, not the model, drops most missing follow-ups.** 24 of 195 desk
  answers showed fewer than three suggestions. In 22 of them the model had
  written three. `parse()` in `src/worker/follow-ups.ts` dropped one for being
  over 60 characters, or for being a "Tell me about…" line with no "?".
- **The desk invents links on his domain.** 4 of 546 desk answers named blog
  posts that don't exist:
  `/blog/simPPL-internship/`, `/blog/autonomous-ml-deployment-system/`,
  `/blog/autoresearch/` and `/blog/go-modular-monolith/`. The site only turns
  known URLs into links, so these show as plain text.
- **False premises get "I don't know" instead of a correction.** For "Why did
  he leave Google?" and "What did he study at IIT?", the desk says it doesn't
  know. The fallback corrects them.
- **It computes what it can't know.** "Roughly one year and nine months" at
  Atlan needs today's date, and the prompt doesn't give one.
- **The judges disagree most on the suggested questions.** Each answer goes to
  two judges first. How often they gave opposite verdicts:

  | Criterion   | Opposite verdicts |
  | ----------- | ----------------- |
  | suggestions | 20%               |
  | covers      | 10%               |
  | grounded    | 8%                |
  | behaves     | 4%                |
  | in-role     | 2%                |

  On suggestions, claude-haiku-5.5 failed 3% of answers, deepseek-v3.2 12% and
  gpt-5-mini 27%. Treat that criterion with care until it's been checked
  against Aman's own marks from `review.html`.

## Reproduce it

Each run's `meta.json` names its commit. The `-dirty` ones were made with the
prompt edit above applied but not committed. These commands rebuild the
tables:

    node evals/report.mjs --board evals/results/runs/20261019T084715 \
      evals/results/runs/20261019T101529 evals/results/runs/20261019T103554 \
      evals/results/runs/20261019T142035 evals/results/runs/20261019T145459
    node evals/report.mjs --board evals/results/runs/20261019T084715 \
      evals/results/runs/20261019T103554
    node evals/report.mjs --board evals/results/runs/20261019T112728 \
      evals/results/runs/20261019T142035 evals/results/runs/20261019T145459

Each writes `evals/results/runs/board.md`, so run them one at a time.
`--compare <before> <after>` shows any two runs answer by answer.
