import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { go, joinGroup } from "../../app/state";
import { type Invitation, parseInvite } from "../../model/codes";
import { CodeInput } from "../components/Codes";
import { t } from "../i18n";

export function Join(props: { invite?: Invitation }): JSX.Element {
  const [invite, setInvite] = useState<Invitation | null>(props.invite ?? null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div class="stack narrow">
      <button
        type="button"
        class="btn btn-ghost btn-small back"
        onClick={() => go({ name: "home" })}
      >
        ← {t("back")}
      </button>
      <h1>{t("joinTitle")}</h1>
      {!invite ? (
        <CodeInput
          label={t("pasteInvite")}
          submit={t("join")}
          testId="invite-input"
          onCode={(text) => {
            const inv = parseInvite(text);
            if (!inv) return t("invalidInvite");
            setInvite(inv);
            return null;
          }}
        />
      ) : (
        <form
          class="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const id = await joinGroup(invite, name.trim());
            go({ name: "group", id });
          }}
        >
          <label class="field">
            <span>{t("yourName")}</span>
            <input
              maxLength={64}
              value={name}
              data-testid="join-name"
              onInput={(e) => setName(e.currentTarget.value)}
            />
            <small class="hint">{t("yourNameHint")}</small>
          </label>
          <button type="submit" class="btn btn-primary btn-large" disabled={busy}>
            {t("join")}
          </button>
        </form>
      )}
    </div>
  );
}
