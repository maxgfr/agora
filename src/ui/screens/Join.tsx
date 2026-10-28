import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { go, joinGroup } from "../../app/state";
import { type Invitation, parseInvite } from "../../model/codes";
import { CodeInput } from "../components/Codes";
import { Link } from "../components/Link";
import { useAction } from "../components/useAction";
import { t } from "../i18n";

export function Join(props: { invite?: Invitation }): JSX.Element {
  const [invite, setInvite] = useState<Invitation | null>(props.invite ?? null);
  const [name, setName] = useState("");
  const { busy, error, run } = useAction();

  return (
    <div class="stack narrow">
      <Link to={{ name: "home" }} class="btn btn-ghost btn-small back">
        ← {t("back")}
      </Link>
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
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const id = await joinGroup(invite, name.trim());
              // Back from the group returns home, not to a form whose invitation is used up.
              go({ name: "group", id }, { replace: true });
            });
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
          {error && (
            <p class="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" class="btn btn-primary btn-large" disabled={busy}>
            {t("join")}
          </button>
        </form>
      )}
    </div>
  );
}
