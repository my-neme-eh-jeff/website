#!/usr/bin/env bash
# Asks each candidate every dev wording once, judged, as soon as its download
# has finished and no other eval has used the desk for 3 minutes. Runs from a
# frozen copy of the eval code (commit 95f81f3, production prompt 328344d1a43e).
set -u
cd ~/portfolio-evals-bakeoff
set -a; . ~/.config/llm/env; set +a
node=$(ls -d ~/.config/nvm/versions/node/v*/bin/node | sort -V | tail -1)
RUNS=~/.local/share/portfolio-evals/runs
idle() { for i in 1 2 3; do pgrep -f "evals/run.mjs" >/dev/null && return 1; sleep 60; done; return 0; }
for m in gemma4:26b-a4b-it-qat qwen3.6:27b-q4_K_M qwen3.6:35b-a3b-q4_K_M gemma4:31b-it-qat glm-4.7-flash:q4_K_M nemotron-3.5-lightning:30b; do
  until ollama list | awk "{print \$1}" | grep -qx "$m"; do sleep 60; done
  until idle; do sleep 30; done
  run=$(date -u +%Y%m%dT%H%M%S)
  echo "== $(date -u +%FT%TZ) $m -> run $run"
  EVAL_OUT=$RUNS "$node" evals/run.mjs --sha 95f81f3 --run "$run" --target "desk:$m" --think false \
    --extra "{\"options\":{\"num_ctx\":8192,\"num_predict\":2000}}" \
    --set dev --reps 1 --judge --judge-reps 1 --budget-usd 1 >> "$RUNS/$run.log" 2>&1
  echo "== $(date -u +%FT%TZ) $m finished with exit $?"
done
echo "== all done $(date -u +%FT%TZ)"
