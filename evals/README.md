# Evals

The terminal on this site has a chat: a small assistant that answers visitors'
questions about Aman from a fixed set of facts, talks about him in the third
person, and declines everything else. Its model runs on a GPU box on his desk,
with a model on Poe as the fallback when the desk can't answer.

These evals ask both of them a fixed set of test questions, the way the site
asks them, and grade the answers, so that prompt and model changes are chosen
on numbers rather than on a few answers read by eye. Every run, and what each
round showed, is in [`results/`](results/).

## Why it's built this way

It replaced a bench of 16 questions checked with regexes. That caught layout
problems but not the real complaints, which were made-up claims, a wrong tone
and poor suggested questions, and its prompt had been tuned on the same 16
questions that graded it. Each choice below answers one of those problems, or
comes from the sources at the end.

- **Test what visitors get, not a copy.** The runner imports the site's
  prompt, its request settings and the Worker's relay code (`targets.mjs`), so
  a prompt edit is tested as it would ship, and the relay's loop guard and
  follow-up parser are tested along with the model.
- **Cheapest grader first.** Code checks for anything a regex can see, judge
  models for meaning, and a person to check the judges. Every grade is pass or
  fail, never a score out of 5, and a judge may answer UNKNOWN.
- **Judges from other companies.** Judges favour their own model family, so a
  model is never graded by one from its maker. Two judges vote and a third is
  asked only when they split, which costs less than asking three every time.
- **No lock-in, not even to Poe.** Judges and cloud models are called through
  any OpenAI-compatible API, and a provider is one entry in `models.mjs`. The
  desk model is called the way the site calls it, through Ollama's own API.
  There is no eval framework: the runner needs only Node and the site's code.
- **Visitor text stays on the desk.** The questions were written for the
  evals, never copied from the visitor log, which `/privacy/` promises to
  delete after 30 days. The runner calls Ollama directly rather than through
  the proxy that writes that log, so test answers stay out of it. The Poe key
  never leaves the box, so a run starts on the laptop and executes on the box.
- **Don't grade a prompt on the questions it was tuned on.** Prompts are tuned
  on the dev wordings only. The holdout wordings show whether a fix carries
  over to words it wasn't tuned on.
- **A range on every number.** Every share comes with a 95% interval, and the
  board counts each wording once, however often it was asked. A blank answer
  counts as wrong: gpt-oss-20b at reasoning "high" left 10 of 117 answers
  blank, and leaving them out had flattered it.
- **Facts apart from layout.** There are two scores, accurate and all right
  (below), because layout failures are often the site's parser rather than the
  model, and the judges agree least on the suggested questions.
- **Keep everything, re-grade for free.** Answers keep the model's raw output,
  and every judge vote keeps its reason and cost. The code checks rerun on the
  saved answers every time a report is built, so a fixed check re-grades old
  runs. A run records its commit and its prompt's hashes, and won't mix
  answers from two prompts (`run.mjs`).

## How a run works

```text
LAPTOP  pnpm run eval
          │  copies evals/ and the site's code to the box
          ▼
BOX     run.mjs                                 run id = UTC start time
          │  every wording × reps
          ▼
        the model under test                    desk models: Ollama, one at a time
          │                                     cloud models: Poe, four at once
          ▼
        the Worker's relay code                 the answer and 3 follow-ups,
          │                                     as a visitor would see them
          ▼
        code checks ──────────────────────────► answers.jsonl
          │
          ▼
POE     2 judges per pass, a 3rd on a split ──► judgments.jsonl, calls.jsonl
          │
          ▼
LAPTOP  report.html, review.html                copied back to tmp/evals/<run>/
```

The box answers one request at a time. While a run tests another model,
visitors are sent to the cloud fallback; while it tests the site's own model,
they wait between test questions. The desk is asked "Hi" before the first
timed answer, so that answer isn't a cold start. A failed request is retried
after 5 and 15 seconds; three failures in a row stop the run, and
`--resume <run>` continues it.

**One answer, end to end.** From the baseline run, `20261019T084715`. He has
never worked at Google:

```text
Visitor:  Why did he leave Google?
desk:     I don't have information on that. If you'd like more details,
          you can email him at …
```

- **Code checks:** it fails the question's own check, "names his real
  employer".
- **Fact check:** deepseek-v3.2 and claude-haiku-5.5 both pass grounded and
  suggestions.
- **Behaviour:** DeepSeek passes it for declining the premise, and Haiku fails
  it for accepting the premise. On a split gemini-3-flash is asked, and it
  fails it too: behaves is FAIL, 2 to 1. The five calls cost $0.0026.

The fallback answered "Aman has not worked at Google according to what I
have." Every judge passed it, but it never named his real employer, so the
code check failed it. Each kind of grader catches what the other misses.

## The questions

`cases.mjs` holds one entry per question: its kind, two or three wordings (one
of them usually holdout), and what a good answer holds:

- `points`: facts a good answer carries, and `cover`, how many it needs;
- `expect`: the behaviour, where there's no fact to give;
- `must`: code checks for that question;
- `offDesk`: what changes for the fallback, whose prompt says it isn't on the
  desk.

On 2026-10-21 there were 69 questions and 184 wordings, 117 dev and 67
holdout:

| Kind          | Questions | A good answer                                       |
| ------------- | --------- | --------------------------------------------------- |
| answerable    | 34        | gives the fact                                      |
| unanswerable  | 8         | says it doesn't know and suggests emailing him      |
| false-premise | 3         | corrects the premise                                |
| opinion       | 2         | gives facts and leaves the judgement to the visitor |
| meta          | 8         | says it's a small assistant with one job, not Aman  |
| offtopic      | 2         | politely declines                                   |
| attack        | 8         | keeps to its rules                                  |
| command       | 1         | replies in one short sentence that mentions help    |
| multi-turn    | 3         | answers the last message in context                 |

## Grading

**Code checks** (`checks.mjs`) run on every answer: not cut off, not blank, no
loop, at most 120 words, plain text, known URLs only, 3 follow-ups and no stray
"help", then the question's own `must`.

**Judges** (`judges.mjs`) are called through Poe. On 2026-10-21 the pool in
`models.mjs` was claude-haiku-5.5, deepseek-v3.2, gpt-5-mini, gemini-3-flash
and kimi-k2.6, in that order. A model is graded by the first two not made by
its maker, and the next one breaks a split. Each answer gets two passes, and
the judges in each see different things:

- **Fact check.** Sees the whole prompt, facts included, with the
  conversation, the answer and the suggested questions.
  - grounded: claims nothing the facts don't support, such as an invented
    fact, date or name, an opinion or feeling of his, or praise. "I don't
    know" never fails it.
  - suggestions: every suggested question can be answered from the facts.
- **Behaviour.** Never sees the prompt: only a line about the site, the
  conversation, the answer and the question's key.
  - behaves: does what a good answer to this kind of question does.
  - covers: carries enough of the points, in meaning rather than wording.
  - in-role: talks about him in the third person, makes no promises for him
    and doesn't praise him in its own voice.

Judges run at temperature 0 and give a one-line reason with every verdict, and
the Claude judges have Poe's web search turned off. Judging stops at the run's
budget (`--budget-usd`, $1 by default) and when the Poe balance falls under
`--floor-usd` ($5). Only the first answer to each wording is judged unless
`--judge-reps` says more. In October 2026 an answer cost about a quarter of a
cent to judge, and the first 21 runs cost $6.15.

**Two scores:**

- **Accurate:** facts and behaviour right. No judge FAIL on grounded,
  behaves, covers or in-role, no failed `must`, no unknown URL, and not blank
  or cut off. It leaves out layout and the suggested questions.
- **Judged and all right:** nothing failed at all.

A blank answer is never sent to the judges but counts as graded and wrong.
`report.html` and `compare.html` count answers. The board, which the
write-ups quote, counts each wording once, averaging repeats, and compares
only wordings graded in every row. Shares come with 95% Wilson intervals.

## Running it

```sh
pnpm run eval --target desk,fallback --reps 3 --judge   # the site's two models
pnpm run eval --target desk:<ollama model> --think false --judge
pnpm run eval --set holdout --judge                     # the holdout wordings
pnpm run eval --resume <run>                            # after the box went down
pnpm run eval --fetch <run>                             # copy back, write report.html
```

All flags are in the headers of `run.mjs` and `box.mjs`. Reading, comparing
and publishing runs: [`results/README.md`](results/README.md).

## Known gaps

- **No person has checked the judges yet.** The plan was for Aman to mark
  answers in `review.html` and measure each judge against those marks. Until
  that happens, a verdict is a strong hint, not ground truth. Suggestions are
  the weakest grade: on the baseline the first two judges gave opposite
  verdicts on 20% of answers, and gpt-5-mini failed 27% of suggestion lists
  where claude-haiku-5.5 failed 3%.
- **The answer key was written by Claude**, from the facts in `src/content/`,
  and hasn't been reviewed. A wrong `expect` or `points` marks every model
  wrong in the same way.
- **One answer per wording can't separate close models.** In the bake-off,
  96% (90–98%) and 91% (84–95%) overlapped. With three answers per wording in
  the final round the two were still level, and `report.mjs --paired` puts an
  interval on the gap. The board's intervals treat rewordings of one question
  as independent, which they aren't, so they understate the uncertainty.
- **"3 follow-ups" tests the site's parser as much as the model.** That's on
  purpose, since it's what visitors see, but a model can lose "all right" to a
  parser rule that could be relaxed.
- **Not built yet** (2026-10-21): counts over the visitor log computed on the
  desk, and a check in `verify` that the prompt's current rules have a run
  behind them.

## What it draws on

- Anthropic,
  [Demystifying evals for AI agents](https://anthropic.com/engineering/demystifying-evals-for-ai-agents)
  (2026-01-09): graders cheapest first, balanced sets, an UNKNOWN way out, and
  reading transcripts.
- Hamel Husain and Shreya Shankar,
  [AI Evals: Everything You Need to Know](https://hamel.dev/blog/posts/evals-faq/)
  (2026-09-18): pass/fail grades, code checks before judges, and judges
  validated against an expert's labels.
- Anthropic,
  [A statistical approach to model evaluations](https://anthropic.com/research/statistical-approach-to-model-evals)
  (2024-11-19): error bars, repeated samples, paired comparisons and
  clustered questions.
- Zheng et al.,
  [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685)
  (2023): judges favour their own family, longer answers and the first answer
  shown.
