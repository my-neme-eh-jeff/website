# desk/

What runs on Aman's desk for the shell's chat. Nothing here is built or
deployed with the site; it is copied to the desk by hand.

```
visitor -> Worker (/api/chat) -> Workers VPC -> Cloudflare Tunnel
        -> chat-log-proxy.mjs (127.0.0.1:11500) -> Ollama (127.0.0.1:11434)
```

- `chat-log-proxy.mjs` forwards only `POST /api/chat`, streams the answer
  through unchanged, and keeps each exchange as an OpenTelemetry trace in
  `~/.local/share/portfolio-chat/traces-YYYY-MM-DD.jsonl` (one file per UTC
  day; what a trace holds is below).
  Before forwarding it asks Ollama's `/api/ps` what is loaded and answers at
  once: `x-desk-model: warm` if the chat's model is, `cold` if not (the shell's
  "cold start" note). If another model is in use, such as an eval, a question
  would queue behind it, so the proxy returns 503 `busy` without asking Ollama,
  and the Worker asks Poe. "In use" means the model's `expires_at` moved within
  the last 2 minutes: Ollama moves it as each request finishes. The proxy
  reads `/api/ps` every 10s to time those moves. A model left loaded but idle
  doesn't count; Ollama swaps it out for a cold start. If Ollama doesn't
  answer, the proxy returns 502.
- **Retention is 30 days.** The proxy deletes a day file, `traces-*` or the
  older `chats-*`, once that day began more than 30 days ago, at startup and
  hourly. `/privacy/` promises this; change
  `RETENTION_DAYS` and that page together.
- `chatlog.mjs` prints that log, in either format. Its options are in the
  comment at its top.
- `probe-ps.mjs` checks that Ollama still moves `expires_at` the way the busy
  check assumes. Run it on the desk after upgrading Ollama.
- `portfolio-chat-proxy.service` keeps the proxy running as a user unit.

## What a trace holds

Each line is one OTLP/JSON `ExportTraceServiceRequest`: the format the
OpenTelemetry Collector's file exporter writes, so OTel tools can load the
files. Names follow the GenAI semantic conventions as of 2026-10-22
(github.com/open-telemetry/semantic-conventions-genai). `verify` checks the
encoding, the required GenAI attributes and the conversation ids; the files
haven't been loaded into a Collector yet.

An exchange is two spans. `POST /api/chat` is the proxy's: the status code,
`desk.state` (`warm`, `cold`, `busy`) and the visitor's country
(`geo.country.iso_code`). `chat <model>` is the call to Ollama. It's absent when
the proxy answered `busy` or Ollama was down, and then the proxy's span holds
the messages and the conversation id instead:

| Attributes                                                                            | What they hold                                                                                                           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `gen_ai.input.messages`                                                               | everything sent to the model: the system prompt, up to 8 earlier turns, the question                                     |
| `gen_ai.output.messages`                                                              | the model's reasoning and its text, which ends with the suggested questions after `<<next>>`                             |
| `gen_ai.request.*`, `ollama.request.*`                                                | the model asked for, token cap, thinking level, sampling, `keep_alive` and every Ollama option sent                      |
| `gen_ai.response.model`, `ollama.model.digest`                                        | which weights answered                                                                                                   |
| `gen_ai.prompt.version`, `desk.prompt.rules`, `desk.prompt.facts`                     | the prompt's hash, the one eval runs record in `meta.json`, and its rules' and facts' hashes                             |
| `gen_ai.usage.*`, `gen_ai.response.finish_reasons`                                    | tokens in (with those read from cache), tokens out, and why it stopped                                                   |
| `gen_ai.response.time_to_first_chunk`, `desk.time_to_first_text`, `ollama.*_duration` | timings, in seconds                                                                                                      |
| `gen_ai.conversation.id`                                                              | the conversation it belongs to (below)                                                                                   |
| `desk.outcome` (on both spans), `error.type`                                          | `ok`, `cancelled` (the visitor hung up, or the Worker gave up waiting and asked Poe), `busy`, `error`, `upstream_<code>` |

**Conversation ids are made on the desk.** The shell sends each earlier answer
back as it showed it, which is the desk's answer up to the suggested
questions. The proxy remembers its answers for 6 hours and gives a question the
id of the latest earlier answer it finds there, so a turn Poe answered in
between, which the desk never sees, doesn't split the conversation. A restart
starts new ids; the earlier turns in every trace still link them.

Nothing else about the visitor is stored: no IP address, user agent, request id
or session id. The desk never sees them, because the Worker forwards only the
country. Poe's answers aren't here either: `/privacy/` says they aren't logged.

**For training on it later:** each `chat` span is an example, input messages to
output messages, tagged with the prompt version and the model's digest. A
conversation's next question says how the answer landed: one of its suggested
questions, a rephrase, a cancel, or nothing more. The files last 30 days.

**Sending traces elsewhere too.** With `DESK_OTLP_TRACES_URL` in the proxy's
environment, each trace is also posted as OTLP/HTTP JSON to that URL (the full
`…/v1/traces` path), with any `DESK_OTLP_HEADERS` (`key=value,key=value`).
`OTEL_SERVICE_NAME` renames the service. The file is written either way. The
standard `OTEL_EXPORTER_OTLP_*` names are ignored on purpose, so a collector
set up for another tool on the box never receives visitors' conversations.
Each trace holds the whole conversation, so name the receiver in `/privacy/`
before setting this.

## Install or update on the desk

Update the desk before pushing a Worker that relies on the change: verify
checks the repo's copy, and nothing checks the copy on the desk.

From the repo root on a machine that can `ssh box`:

```sh
ssh box 'mkdir -p ~/.local/lib/portfolio-desk ~/.config/systemd/user'
scp desk/chat-log-proxy.mjs desk/chatlog.mjs desk/probe-ps.mjs box:.local/lib/portfolio-desk/
scp desk/portfolio-chat-proxy.service box:.config/systemd/user/
ssh box 'systemctl --user daemon-reload && systemctl --user enable --now portfolio-chat-proxy && systemctl --user restart portfolio-chat-proxy'
```

`~/.local/bin/chatlog` on the desk is a two-line wrapper that runs
`chatlog.mjs` with the same Node as the unit. A non-interactive `ssh box`
has no `~/.local/bin` on its PATH, so call it by that full path there.

The VPC service must point at the proxy's port, not Ollama's. Check with
`wrangler vpc service get <service_id>` on the desk (the id is in
`wrangler.jsonc`).
