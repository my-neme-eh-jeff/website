#!/usr/bin/env bash
# Pulls the remaining eval candidates one at a time, in the order bake-off-2.sh
# runs them, once the pull already under way has ended. A model that is
# already whole pulls again in seconds.
while pgrep -f 'ollama[ ]pull' >/dev/null; do sleep 15; done
for m in qwen3.6:35b-a3b-q4_K_M glm-4.7-flash:q4_K_M nemotron-3.5-lightning:30b gemma4:31b-it-qat; do
  echo "== $(date -u +%FT%TZ) $m"
  ollama pull "$m" 2>&1 | tr "\r" "\n" | grep -v -E "[0-9]+%" | tail -n 3
  [ "${PIPESTATUS[0]}" = 0 ] || echo "== $(date -u +%FT%TZ) $m pull failed"
done
echo "== done $(date -u +%FT%TZ)"
