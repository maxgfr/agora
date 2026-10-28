import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { saveSettings, settings } from "../../app/settings";
import { locked, restartSessions, setPassphrase, wipeAll } from "../../app/state";
import { Link } from "../components/Link";
import { lang, setLang, t } from "../i18n";

const lines = (s: string) =>
  s
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

function Lock(): JSX.Element {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  if (locked.value) {
    return (
      <div class="stack">
        <p class="ok-line">{t("lockedOn")}</p>
        <button type="button" class="btn" onClick={() => void setPassphrase(null)}>
          {t("removeLock")}
        </button>
      </div>
    );
  }
  return (
    <form
      class="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (a !== b) {
          setError(true);
          return;
        }
        setBusy(true);
        try {
          await setPassphrase(a);
          setA("");
          setB("");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label class="field">
        <span>{t("passphrase")}</span>
        <input
          type="password"
          autocomplete="new-password"
          minLength={8}
          value={a}
          onInput={(e) => setA(e.currentTarget.value)}
        />
      </label>
      <label class="field">
        <span>{t("passphraseRepeat")}</span>
        <input
          type="password"
          autocomplete="new-password"
          value={b}
          onInput={(e) => setB(e.currentTarget.value)}
        />
      </label>
      {error && <p class="error">{t("mismatch")}</p>}
      <button type="submit" class="btn" disabled={busy || a.length < 8}>
        {t("setLock")}
      </button>
    </form>
  );
}

export function SettingsScreen(): JSX.Element {
  const s = settings.value;
  const [relays, setRelays] = useState(s.relays.join("\n"));
  const [trackers, setTrackers] = useState(s.trackers.join("\n"));
  const [stun, setStun] = useState(s.stun.join("\n"));
  const [torrent, setTorrent] = useState(s.torrent);
  const [relayOnly, setRelayOnly] = useState(s.relayOnly);
  const [turn, setTurn] = useState(s.turn ?? { url: "", username: "", credential: "" });
  const [saved, setSaved] = useState(false);

  return (
    <div class="stack narrow">
      <Link to={{ name: "home" }} class="btn btn-ghost btn-small back">
        ← {t("back")}
      </Link>
      <h1>{t("settings")}</h1>
      <section class="card stack">
        <h2>{t("language")}</h2>
        <div class="segmented" role="radiogroup" aria-label={t("language")}>
          {(["fr", "en"] as const).map((l) => (
            <label key={l} class={lang.value === l ? "seg seg-on" : "seg"}>
              <input
                type="radio"
                class="sr-only"
                name="lang"
                checked={lang.value === l}
                onChange={() => setLang(l)}
              />
              {l === "fr" ? "Français" : "English"}
            </label>
          ))}
        </div>
      </section>
      <section class="card stack">
        <h2>{t("lockTitle")}</h2>
        <p class="hint">{t("lockHint")}</p>
        <Lock />
      </section>
      <form
        class="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          saveSettings({
            relays: lines(relays),
            trackers: lines(trackers),
            stun: lines(stun),
            torrent,
            relayOnly,
            turn: turn.url.trim() ? { ...turn, url: turn.url.trim() } : null,
          });
          restartSessions();
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        }}
      >
        <h2>{t("network")}</h2>
        <label class="field">
          <span>{t("relays")}</span>
          <textarea
            rows={4}
            spellcheck={false}
            value={relays}
            onInput={(e) => setRelays(e.currentTarget.value)}
          />
          <small class="hint">{t("relaysHint")}</small>
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={torrent}
            onChange={(e) => setTorrent(e.currentTarget.checked)}
          />
          <span>{t("useTrackers")}</span>
        </label>
        <label class="field">
          <span>{t("trackers")}</span>
          <textarea
            rows={2}
            spellcheck={false}
            value={trackers}
            onInput={(e) => setTrackers(e.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span>{t("stun")}</span>
          <textarea
            rows={2}
            spellcheck={false}
            value={stun}
            onInput={(e) => setStun(e.currentTarget.value)}
          />
        </label>
        <fieldset class="stack-tight">
          <legend>{t("turn")}</legend>
          <input
            placeholder="turns:turn.example.org:443"
            value={turn.url}
            aria-label="TURN URL"
            onInput={(e) => setTurn({ ...turn, url: e.currentTarget.value })}
          />
          <input
            placeholder="username"
            value={turn.username}
            aria-label="TURN username"
            onInput={(e) => setTurn({ ...turn, username: e.currentTarget.value })}
          />
          <input
            type="password"
            placeholder="credential"
            value={turn.credential}
            aria-label="TURN credential"
            onInput={(e) => setTurn({ ...turn, credential: e.currentTarget.value })}
          />
        </fieldset>
        <label class="check">
          <input
            type="checkbox"
            checked={relayOnly}
            onChange={(e) => setRelayOnly(e.currentTarget.checked)}
          />
          <span>{t("relayOnlyLabel")}</span>
        </label>
        <div class="row">
          <button type="submit" class="btn btn-primary">
            {t("save")}
          </button>
          {saved && <span class="ok-line">{t("saved")}</span>}
        </div>
      </form>
      <div class="danger-zone">
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
    </div>
  );
}
