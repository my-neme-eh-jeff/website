import { component$, useSignal } from "@qwik.dev/core";
import { Range } from "../controls";
import { dur } from "./model";
import { demo, quiet } from "./scenarios";
import { Statusline } from "./terminal";

export const Credentials = component$(() => {
  const mins = useSignal(-10);
  const valid = mins.value > 0;
  const when =
    mins.value > 0
      ? `in ${dur(mins.value * 60)}`
      : mins.value === 0
        ? "now"
        : `${dur(-mins.value * 60)} ago`;

  return (
    <div>
      <Statusline
        state={quiet({
          kube: demo.kube,
          aws: { ...demo.aws, ssoValid: valid },
        })}
      />

      <pre class="border-line bg-bg mt-4 overflow-x-auto rounded-lg border px-4 py-3 font-mono text-xs leading-relaxed">
        <span class="text-muted">
          {"# ~/.aws/sso/cache/<sha1 of the session>.json\n"}
        </span>
        {"{\n"}
        <span class="text-muted">{'  "accessToken": "…",'}</span>
        <span class="text-muted">{"        ← never read\n"}</span>
        {"  "}
        <span class="text-accent">"expiresAt"</span>
        {': "…"'}
        <span class="text-muted">
          {`            ← ${valid ? `expires ${when}: shown` : `expired ${when}: hidden`}\n`}
        </span>
        {"}"}
      </pre>

      <div class="mt-5 max-w-sm">
        <Range
          label="SSO token expires"
          value={mins}
          min={-30}
          max={60}
          step={5}
          text={mins.value < 0 ? `expired ${when}` : when}
        />
      </div>
    </div>
  );
});
