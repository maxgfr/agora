import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { unlock, wipeAll } from "../../app/state";
import { t } from "../i18n";

export function Locked(): JSX.Element {
  const [pass, setPass] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      class="stack narrow"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await unlock(pass);
        setBusy(false);
        setError(!ok);
      }}
    >
      <h1>{t("unlockTitle")}</h1>
      <label class="field">
        <span>{t("passphrase")}</span>
        <input
          type="password"
          autocomplete="current-password"
          value={pass}
          onInput={(e) => setPass(e.currentTarget.value)}
        />
      </label>
      {error && (
        <p class="error" role="alert">
          {t("wrongPassphrase")}
        </p>
      )}
      <button type="submit" class="btn btn-primary" disabled={busy || !pass}>
        {t("unlock")}
      </button>
      <details class="forgot">
        <summary>{t("forgotPassphrase")}</summary>
        <div class="stack">
          <p class="hint">{t("forgotPassphraseHint")}</p>
          <button
            type="button"
            class="btn btn-danger"
            onClick={() => {
              if (confirm(t("wipeConfirm"))) void wipeAll();
            }}
          >
            {t("wipe")}
          </button>
        </div>
      </details>
    </form>
  );
}
