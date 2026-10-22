# The desk model's final round, 2026-10-22

The [bake-off](2026-10-20-desk-model-bake-off.md) left two open models ahead
of gpt-oss-20b, too close to call on one answer per question: Qwen3.6-35B-A3B
(96% accurate) and Gemma 4 26B-A4B (91%). This round asked both of them every
wording, dev and holdout, three times each, with the settings the site would
use, to decide which one the desk runs.

**Gemma 4 26B-A4B won, and the site runs it from 2026-10-22.** The two were
level on accuracy. Gemma got 84% of the wordings fully right against Qwen's
52%, never claimed anything the facts don't support, and starts answering in
half the time.

## How the winner was decided

This was written down before any answer was graded:

1. The share of the 184 wordings answered accurately decides.
2. If the two intervals overlap, the share judged all right decides, then
   speed, then memory.

The accuracy intervals overlapped, so the second rule decided it.

## The results

Each model answered all 184 wordings three times. Each wording counts once,
the average of its three answers.

|                                              | Qwen3.6-35B-A3B         | Gemma 4 26B-A4B             |
| -------------------------------------------- | ----------------------- | --------------------------- |
| Accurate                                     | 162.7/184, 88% (83–92%) | 157.7/184, 86% (80–90%)     |
| Judged all right                             | 95.0/184, 52% (44–59%)  | **153.7/184, 84% (77–88%)** |
| Grounded: nothing the facts don't support    | 94%                     | **100%**                    |
| Suggested questions the facts can answer     | 60%                     | **98%**                     |
| Behaves as a good answer would               | **98%**                 | 94%                         |
| Covers the expected points                   | **93%**                 | 86%                         |
| First word / whole answer, median            | 2.0s / 4.6s             | **0.8s / 3.3s**             |
| Cold start, first word with nothing loaded   | 44.2s                   | **25.6s**                   |
| Loaded size, share on the GPU, at 8k context | 23.3 GB, 17%            | **15.4 GB, 22%**            |

**The accuracy gap is noise.** Wording by wording, Gemma scored 2.7 points
lower, with a 95% interval from 8.7 lower to 2.8 higher. The interval comes
from resampling whole questions, since one question's wordings aren't
independent. Gemma was ahead on 30 wordings, Qwen on 31, and 123 were level.

**Where they differ:**

| Accurate      | Gemma 4 26B-A4B | Qwen3.6-35B-A3B |
| ------------- | --------------- | --------------- |
| dev           | 88% of 117      | 90% of 117      |
| holdout       | 81% of 67       | 85% of 67       |
| answerable    | 88% of 99       | 85% of 99       |
| opinion       | 53% of 5        | 67% of 5        |
| unanswerable  | 100% of 20      | 97% of 20       |
| false-premise | 57% of 7        | 95% of 7        |
| meta          | 58% of 22       | 83% of 22       |
| offtopic      | 100% of 6       | 100% of 6       |
| attack        | 100% of 18      | 100% of 18      |
| command       | 100% of 3       | 100% of 3       |
| multi-turn    | 100% of 4       | 92% of 4        |

## What each model did

**Qwen3.6-35B-A3B: better about itself and about false premises, but its
suggested questions break and it starts slowly.**

- 207 of its 552 answers showed fewer than three suggested questions. In 199
  of them it wrote the marker and the questions, but in lowercase and without
  a question mark ("what is he working on now"), and the site's parser drops
  those. 57 also wrote `<<next>` for `<<next>>`.
- 6% of its answers claimed something the facts don't support, such as an
  internship he never did.
- Loading it took 35.7s, so a cold start reached the first word after 44.2s,
  before the tunnel adds its share. The Worker gives a cold start 45s, then
  hands the question to Poe.

**Gemma 4 26B-A4B: never made anything up, laid out every answer, and slips
on questions about itself and on false premises.**

- All 552 answers showed three suggested questions, and none was cut off or
  blank. One gave a link that isn't one of his.
- Its misses are where the bake-off found them: questions about the
  assistant itself (meta, 58%), and false premises (57%), where it says it
  doesn't know instead of correcting the premise. The identity rule tested on
  2026-10-19 targets the first; nothing targets the second yet.

## What changed on the site

- The desk model is `gemma4:26b-a4b-it-qat`; it was `gpt-oss-16k:20b`.
- Thinking is off (`think: false`); gpt-oss ran at `low`.
- The context window, 8,192 tokens, is sent with every request (`NUM_CTX` in
  `src/content/chat.ts`) instead of coming from a custom model build. verify
  checks that the longest conversation fits.
- The prompt is unchanged (`328344d1a43e`), and so is the Poe fallback.

## What's still open

- **The identity rule, and a rule for false premises**, aimed at Gemma's two
  weak spots. Both change what visitors see, so both wait for Aman.
- **Thinking on** wasn't tried in this round. It would slow every answer, and
  on gpt-oss more thinking didn't help.
- **The judges still aren't calibrated against Aman's own marks.**

## How it was run

- **The run:** `20261022T050412`, from the eval code at commit `e48b2c1`, on
  the desk box (Ryzen 5 5600X, 24 GB RAM, RTX 2060 6 GB, Ollama 0.34.4).
- **The settings:** `think: false`, `num_ctx` 8192 and `num_predict` 700,
  production's token cap. Both models got the production prompt
  `328344d1a43e` (rules `0f2877b2b288`, facts `e293e6a059d8`).
- **The questions:** all 184 wordings, 117 dev and 67 holdout, three answers
  each: 552 per model.
- **The grading:** claude-haiku-5.5 and deepseek-v3.2 graded both models, with
  gpt-5-mini on a split, and every answer was graded. 4,842 judge calls cost
  $2.21.
- **The cold starts** were measured while the judges ran. Every model was
  unloaded, then one question went straight to Ollama with the production
  prompt and the settings above, then two more while warm.
- **When (IST):** answers 10:34 to 11:54 (Gemma until 11:10, then Qwen), cold
  starts around 11:55, and grading until 13:45. The box stayed up throughout.
  While the run held the GPU, visitors got the Poe fallback.

## Reproduce it

    node evals/report.mjs --board evals/results/runs/20261022T050412
    node evals/report.mjs --paired evals/results/runs/20261022T050412

## The full board

Ranked by accurate: facts and behaviour right, by code checks and the judges'
grounded, behaves, covers and in-role, leaving out layout and suggested
questions. A blank answer counts as judged and wrong. Every row counts the
same 184 wordings, each once however many times it was asked. Intervals are
95% Wilson.

|                                                                                                                                               | accurate                    | judged and all right        | judge: grounded               | judge: suggestions          | judge: behaves              | judge: covers               | judge: in-role              | code checks                 | first word / whole answer, p50 | tok/s p50 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------- | ----------------------------- | --------------------------- | --------------------------- | --------------------------- | --------------------------- | --------------------------- | ------------------------------ | --------- |
| **desk:qwen3.6:35b-a3b-q4_K_M**<br>run 20261022T050412 · think false · `{"options":{"num_ctx":8192,"num_predict":700}}` · prompt 328344d1a43e | **162.7/184** 88% (83%–92%) | **95.0/184** 52% (44%–59%)  | **172.3/184** 94% (89%–96%)   | **110.7/184** 60% (53%–67%) | **180.3/184** 98% (95%–99%) | **114.7/123** 93% (87%–96%) | **184/184** 100% (98%–100%) | **112.7/184** 61% (54%–68%) | 2.0s / 4.6s                    | 28.5      |
| **desk:gemma4:26b-a4b-it-qat**<br>run 20261022T050412 · think false · `{"options":{"num_ctx":8192,"num_predict":700}}` · prompt 328344d1a43e  | **157.7/184** 86% (80%–90%) | **153.7/184** 84% (77%–88%) | **183.7/184** 100% (98%–100%) | **180.3/184** 98% (95%–99%) | **173.3/184** 94% (90%–97%) | **105.7/123** 86% (79%–91%) | **184/184** 100% (98%–100%) | **174.3/184** 95% (91%–97%) | 0.8s / 3.3s                    | 23.3      |
