# Choosing the desk model, 2026-10-20

The terminal on amannambisan.com answers visitors' questions about Aman from a
fixed set of facts. It runs a language model on the desk: a PC at his home,
reached through a Cloudflare tunnel. If the desk can't answer, a cloud model on
Poe does. The desk runs gpt-oss-20b. On 2026-10-19 the evals showed it getting
only 65% of the test questions fully right. It said "I don't know" when the
facts had the answer, invented blog links on his domain, and mostly failed
"What are you?".

The question for this round: which open model, run on that same PC, gives the
most accurate answers? Accuracy and answer quality come first. Speed and size
are reported but don't rule a model out, and small models, 2–4B parameters in
all, were left out on purpose.

**Where it stands (two models still to run):** Qwen3.6-35B-A3B is the most
accurate local model so far, at 96%. Gemma 4 26B-A4B is close behind at 91%,
with perfect formatting and the fastest answers. Both clearly beat
gpt-oss-20b's 82%. Giving gpt-oss more time to reason made it no better.
Nothing has been switched in production. Each model answered each question
once, so the gap between the top two isn't settled yet; see
[What's not settled](#whats-not-settled).

## The results

Each row is one model answering the same 117 dev questions, once each, with
every answer graded. They're sorted by accurate.

| Model                            | Settings     | Accurate                   | Judged and all right        | First word / whole answer | tok/s | Size, CPU/GPU split |
| -------------------------------- | ------------ | -------------------------- | --------------------------- | ------------------------- | ----- | ------------------- |
| Poe fallback, ds-v4.1-flash-1017 | thinking off | **114/117** 97% (93%–99%)  | **109.3/117** 93% (87%–97%) | 1.3s / 2.5s               | —     | —, —                |
| Qwen3.6-35B-A3B                  | think off    | **112/117** 96% (90%–98%)  | **72/117** 62% (52%–70%)    | 2.0s / 4.8s               | 27.4  | 23 GB, 83/17        |
| Gemma 4 26B-A4B                  | think off    | **106/117** 91% (84%–95%)  | **104/117** 89% (82%–93%)   | 0.8s / 3.7s               | 21.9  | 15 GB, 78/22        |
| Qwen3.6-27B                      | think off    | **98/117** 84% (76%–89%)   | **88/117** 75% (67%–82%)    | 5.7s / 39.0s              | 1.9   | 17 GB, 77/23        |
| gpt-oss-20b (production)         | think low    | **96.3/117** 82% (74%–88%) | **76.3/117** 65% (56%–73%)  | 1.8s / 4.5s               | —     | 14 GB, 69/31        |
| gpt-oss-20b                      | think medium | **93/117** 79% (71%–86%)   | **86/117** 74% (65%–81%)    | 15.3s / 17.8s             | 21.5  | 14 GB, 69/31        |
| gpt-oss-20b                      | think high   | **86/117** 74% (65%–81%)   | **81/117** 69% (60%–77%)    | 67.6s / 74.0s             | 21.4  | 14 GB, 69/31        |
| GLM-4.7-Flash                    | think off    | **77/117** 66% (57%–74%)   | **43/117** 37% (29%–46%)    | 0.4s / 3.2s               | 21.2  | 19 GB, 76/24        |

- **Accurate** means the facts and the behaviour are right: no invented
  detail, no wrong claim, no missed fact the code checks look for, no made-up
  link, no "I don't know" when the facts answer, and no answer cut off or left
  blank. It leaves out formatting and the suggested follow-up questions.
- **Judged and all right** also requires the formatting and the three
  suggested follow-up questions to be right.
- The ranges in brackets are 95% Wilson intervals.
- **First word / whole answer** are medians, measured on the desk itself, so
  network time to a visitor isn't included.
- **CPU/GPU split** is what `ollama ps` reported: the share of the model held
  in system RAM against the share on the 6 GB GPU.

The full table, with each judge's criterion, is at the end.

## What each model did

**Qwen3.6-35B-A3B: the most accurate, with broken suggestions.** It covered
every expected point on all 81 questions where a judge checks for them. Its 5
misses were small slips that a visitor would still see:

- it typed the employer as "atlant", and that answer was all in lowercase;
- it gave a verdict ("He fits well") when asked whether he'd suit a role;
- it gave his LinkedIn link without the `www`;
- it said JEE Advanced where the facts say JEE Main and Advanced;
- asked why the site has a chatbot, it described its hardware instead of its job.

Its weak spot is the follow-ups. 37 of 117 answers showed none, because it
writes them without a question mark, which the site's parser throws away, and
it garbles the `<<next>>` separator. A parser that accepts both would show
three on 113 of 117. Where it did show three, the judges passed 76 of 80. It
also uses 23 GB on a box with 24 GB of RAM.

**Gemma 4 26B-A4B: nearly as accurate, and the cleanest.** It invented no
detail in any of its 117 answers, corrected 3 of the 4 false-premise
questions, and showed three follow-ups on every answer, which the judges
passed on 115 of 117. It was also the fastest: under a
second to the first word. 6 of its 11 misses were questions about
itself, such as "What are you?", "who am i talking to" and "Why is there a
chatbot on his site?". It answered those by describing the hardware instead of
its job, which the identity rule tested on 2026-10-19 is meant to fix. The
others were two lists of employers without dates, "aws or gcp?" getting "I
don't know which he prefers", a fit question declined without the relevant
experience, and "when did he finish his phd" answered without saying what he
did study.

**gpt-oss-20b: more thinking didn't help.** At medium reasoning it was no
better than at low, and about 8× slower to start answering. At high reasoning
it used up its 4,000-token limit thinking on 10 of 117 questions and returned
nothing. The same mistakes appeared at every level: "I don't know" to "does he
know model context protocol" and "codeforces rating?" although the facts answer
both, false premises left uncorrected ("Why did he leave Google?"), and the
questions about itself. Thinking longer doesn't fix what the model can't do.

**Qwen3.6-27B (dense): slower and less accurate than its MoE sibling.** All
27.8B weights take part in every token, so with most of them on the CPU it ran
at 1.9 tokens a second, about 40 seconds an answer. On 9 of 117 questions it
wrote only the suggested questions, with no answer.

**GLM-4.7-Flash: the least accurate.** It returned the suggestions alone on 10
questions, had an invented detail in 12 of the 107 answers the judges read, and made up
a link
(`amannambisan.com/#projects`).

## What we learned

- **More reasoning didn't buy accuracy.** gpt-oss-20b scored 82% at low, 79%
  at medium and 74% at high. Every remaining miss had the same cause at all
  three levels.
- **Mixture-of-experts models are the ones that fit this box.** Gemma 4 26B-A4B
  and Qwen3.6-35B-A3B use only 4B and 3B of their parameters for each token.
  Even with 78–83% of the model in system RAM, they answered as fast as
  gpt-oss. The
  dense 27B model was about 10× slower, and no more accurate.
- **Bigger isn't automatically better.** The dense Qwen3.6-27B (84%) lost to
  the MoE Qwen3.6-35B-A3B (96%), partly because it sometimes skipped the
  answer.
- **Some failures only show up once you count them.** Two models sometimes
  answered with nothing but the follow-up block. The board now counts a blank
  answer as wrong; before `7e6a259` those answers dropped out of the
  comparison instead.
- **The site's parser is tuned to gpt-oss's format.** Another model writes its
  suggestions slightly differently, and the site shows none.
- **The fallback is the bar.** The Poe fallback, ds-v4.1-flash-1017, scored
  97%. Its prompt differs by one line: instead of running on the desk, it is
  told it answers from a fixed set of facts.

## What's not settled

- **One answer per question.** Each score has an interval of roughly ±5–7
  points, so 96% against 91% is a lead, not a result.
- **Dev questions only.** The prompt was tuned against these wordings. The 67
  held-out wordings haven't been asked of the candidates yet.
- **Without the identity rule.** Every model got the production prompt
  (`328344d1a43e`). The rule tested on 2026-10-19 targets Gemma's main
  weakness; Qwen passes those questions without it.
- **Thinking off.** The candidates ran with `think: false`. Gemma 4 and
  Qwen3.6 can also think, at a cost in speed.
- **8k context.** The candidates ran at `num_ctx` 8192; production uses 16k.
  Qwen at 16k needs a memory check before it can be trusted on a 24 GB box.
- **The judges aren't calibrated against Aman's own marks yet.** They're
  models from other makers. On the 2026-10-19 baseline, the first two judges
  gave opposite verdicts on 20% of the suggested questions.
- **Timings come from a box doing other work.** It was also serving the live
  site, and each candidate pushed the production model out of memory. While
  that happened, visitors got the Poe fallback.

## What runs next

- **Still running tonight:** Nemotron 3.5 Lightning (`nemotron-3.5-lightning:30b`)
  and Gemma 4 31B (`gemma4:31b-it-qat`, dense). They'll be added here when they
  finish.
- **Then a finalist round for Qwen3.6-35B-A3B and Gemma 4 26B-A4B:** three
  answers per question, dev and held-out wordings, thinking on and off, with
  and without the identity rule, plus a memory check at 16k context.
- **Not before Aman decides:** switching the site's model, the identity rule,
  and a more tolerant follow-up parser are all changes visitors would see.

## How it was run

**The box.**

| Part   | What it was                                               |
| ------ | --------------------------------------------------------- |
| CPU    | AMD Ryzen 5 5600X, 6 cores, 12 threads                    |
| RAM    | 24 GB                                                     |
| GPU    | NVIDIA GeForce RTX 2060, 6 GB, driver 595.91.07           |
| OS     | Ubuntu 26.04.1 LTS, kernel 7.0.0-38-generic               |
| Ollama | 0.34.4, `/api/chat` streaming, called directly on the box |

**The models.** Details are from `ollama show`.

| Ollama tag               | Architecture | Parameters | Quantization | Context in the test |
| ------------------------ | ------------ | ---------- | ------------ | ------------------- |
| `gpt-oss-16k:20b`        | gptoss       | 20.9B      | MXFP4        | 16,384              |
| `gemma4:26b-a4b-it-qat`  | gemma4       | 25.2B      | Q4_0         | 8,192               |
| `qwen3.6:35b-a3b-q4_K_M` | qwen35moe    | 36.0B      | Q4_K_M       | 8,192               |
| `qwen3.6:27b-q4_K_M`     | qwen35       | 27.8B      | Q4_K_M       | 8,192               |
| `glm-4.7-flash:q4_K_M`   | glm4moelite  | 29.9B      | Q4_K_M       | 8,192               |

`gpt-oss-16k:20b` is `gpt-oss:20b` with its context set to 16k, the way the
site runs it.

**The settings.**

- **gpt-oss in production:** `think: "low"`, `num_predict` 700.
- **gpt-oss at medium and high:** `num_predict` 4000, since it counts the
  reasoning tokens too.
- **Every candidate:** `think: false`, `num_ctx` 8192, `num_predict` 2000,
  through the runner's `--extra` flag.

**The questions.** These are the 117 dev wordings in `evals/cases.mjs` (69
cases at this commit). By kind:

| Kind          | Wordings |
| ------------- | -------- |
| answerable    | 65       |
| meta          | 14       |
| unanswerable  | 12       |
| attack        | 10       |
| false-premise | 4        |
| offtopic      | 4        |
| opinion       | 3        |
| multi-turn    | 3        |
| command       | 2        |

Every wording was written for the evals; none comes from the visitor log.

**The prompt.** Every model got the production prompt, hash `328344d1a43e`,
with rules `0f2877b2b288` and facts `e293e6a059d8`, from a frozen copy of the
eval code at commit `95f81f3`. The prompt hasn't changed since; the fallback
row comes from the 2026-10-19 baseline.

**The grading.**

- **Code checks** (`evals/checks.mjs`): layout, known links only, nothing cut
  off or blank, plus each case's own checks, such as "names the earlier
  company".
- **Judges** (`evals/judges.mjs`, `evals/models.mjs`): models on Poe, each
  from a different maker, grading grounded, suggestions, behaves, covers and
  in-role. The pool is claude-haiku-5.5, deepseek-v3.2, gpt-5-mini,
  gemini-3-flash and kimi-k2.6. For each model under test, the panel is the
  first two in the pool not made by its maker, and a third breaks a tie. No
  judge ever grades its own maker's model.
- **Cost:** about $0.21–0.29 per 117 answers. All 19 runs in this folder
  cost $5.67 together.

**The order of events (UTC).**

- **Downloads:** the models came down one at a time at about 3 MB/s, from
  05:46 onward.
- **The runs:** a runner on the box started each one once its download had
  finished and no other eval had used the desk for 3 minutes.
- **gpt-oss medium and high:** these held the desk until 09:51.
- **Runner bug:** the first runner's "is an eval running?" check matched its
  own launcher, so it could never start a run. It was fixed at 09:57.
- **Power cut:** the box lost power at 12:45 while the dense Qwen3.6-27B run
  was being judged. The run resumed at 14:07. The scripts and their logs are
  in [`box/`](box/).

## Reproduce it

On the box, with the Poe key in its environment, for any model Ollama has:

    node evals/run.mjs --target desk:<ollama tag> --think false \
      --extra '{"options":{"num_ctx":8192,"num_predict":2000}}' \
      --set dev --reps 1 --judge --judge-reps 1 --budget-usd 1

From a laptop, `pnpm run eval` starts the same run on the box (see
`evals/box.mjs`).

This command rebuilds the board below from the committed data, as
`evals/results/runs/board.md`:

    node evals/report.mjs --board evals/results/runs/20261019T084715 \
      evals/results/runs/20261020T055511 evals/results/runs/20261020T064312 \
      evals/results/runs/20261020T100108 evals/results/runs/20261020T105045 \
      evals/results/runs/20261020T111512 evals/results/runs/20261020T141300

## The full board

Ranked by accurate: facts and behaviour right, by code checks and the judges' grounded, behaves, covers and in-role, leaving out layout and suggested questions. A blank answer counts as judged and wrong. Every row counts the same 117 wordings, those judged in all 8 rows, each once however many times a run asked it. Intervals are 95% Wilson. The rows were not all asked with the same rules, so prompt and model differences are mixed.

|                                                                                                                                                | accurate                   | judged and all right        | judge: grounded              | judge: suggestions          | judge: behaves               | judge: covers             | judge: in-role               | code checks                 | first word / whole answer, p50 | tok/s p50 |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------- | ---------------------------- | --------------------------- | ---------------------------- | ------------------------- | ---------------------------- | --------------------------- | ------------------------------ | --------- |
| **fallback (ds-v4.1-flash-1017)**<br>run 20261019T084715 · production settings · prompt d20da8ed4454                                           | **114/117** 97% (93%–99%)  | **109.3/117** 93% (87%–97%) | **116.3/117** 99% (96%–100%) | **108.3/117** 93% (86%–96%) | **115.7/117** 99% (95%–100%) | **78/79** 99% (93%–100%)  | **117/117** 100% (97%–100%)  | **113.3/117** 97% (92%–99%) | 1.3s / 2.5s                    | —         |
| **desk:qwen3.6:35b-a3b-q4_K_M**<br>run 20261020T105045 · think false · `{"options":{"num_ctx":8192,"num_predict":2000}}` · prompt 328344d1a43e | **112/117** 96% (90%–98%)  | **72/117** 62% (52%–70%)    | **114/117** 97% (93%–99%)    | **78/117** 67% (58%–75%)    | **115/117** 98% (94%–100%)   | **81/81** 100% (95%–100%) | **117/117** 100% (97%–100%)  | **79/117** 68% (59%–75%)    | 2.0s / 4.8s                    | 27.4      |
| **desk:gemma4:26b-a4b-it-qat**<br>run 20261020T100108 · think false · `{"options":{"num_ctx":8192,"num_predict":2000}}` · prompt 328344d1a43e  | **106/117** 91% (84%–95%)  | **104/117** 89% (82%–93%)   | **117/117** 100% (97%–100%)  | **115/117** 98% (94%–100%)  | **111/117** 95% (89%–98%)    | **73/81** 90% (82%–95%)   | **117/117** 100% (97%–100%)  | **115/117** 98% (94%–100%)  | 0.8s / 3.7s                    | 21.9      |
| **desk:qwen3.6:27b-q4_K_M**<br>run 20261020T111512 · think false · `{"options":{"num_ctx":8192,"num_predict":2000}}` · prompt 328344d1a43e     | **98/117** 84% (76%–89%)   | **88/117** 75% (67%–82%)    | **107/108** 99% (95%–100%)   | **97/108** 90% (83%–94%)    | **106/108** 98% (93%–99%)    | **65/72** 90% (81%–95%)   | **108/108** 100% (97%–100%)  | **94/117** 80% (72%–87%)    | 5.7s / 39.0s                   | 1.9       |
| **desk (gpt-oss-16k:20b)**<br>run 20261019T084715 · production settings · prompt 328344d1a43e                                                  | **96.3/117** 82% (74%–88%) | **76.3/117** 65% (56%–73%)  | **108.3/117** 93% (86%–96%)  | **100.0/117** 85% (78%–91%) | **106.7/117** 91% (85%–95%)  | **72.3/81** 89% (81%–94%) | **115.0/117** 98% (94%–100%) | **96.3/117** 82% (74%–88%)  | 1.8s / 4.5s                    | —         |
| **desk (gpt-oss-16k:20b)**<br>run 20261020T055511 · think medium · `{"options":{"num_predict":4000}}` · prompt 328344d1a43e                    | **93/117** 79% (71%–86%)   | **86/117** 74% (65%–81%)    | **111/117** 95% (89%–98%)    | **112/117** 96% (90%–98%)   | **104/117** 89% (82%–93%)    | **71/81** 88% (79%–93%)   | **116/117** 99% (95%–100%)   | **104/117** 89% (82%–93%)   | 15.3s / 17.8s                  | 21.5      |
| **desk (gpt-oss-16k:20b)**<br>run 20261020T064312 · think high · `{"options":{"num_predict":4000}}` · prompt 328344d1a43e                      | **86/117** 74% (65%–81%)   | **81/117** 69% (60%–77%)    | **105/107** 98% (93%–99%)    | **104/107** 97% (92%–99%)   | **95/107** 89% (81%–93%)     | **60/72** 83% (73%–90%)   | **107/107** 100% (97%–100%)  | **99/117** 85% (77%–90%)    | 67.6s / 74.0s                  | 21.4      |
| **desk:glm-4.7-flash:q4_K_M**<br>run 20261020T141300 · think false · `{"options":{"num_ctx":8192,"num_predict":2000}}` · prompt 328344d1a43e   | **77/117** 66% (57%–74%)   | **43/117** 37% (29%–46%)    | **95/107** 89% (81%–93%)     | **78/107** 73% (64%–80%)    | **93/107** 87% (79%–92%)     | **71/76** 93% (86%–97%)   | **105/107** 98% (93%–99%)    | **71/117** 61% (52%–69%)    | 0.4s / 3.2s                    | 21.2      |
