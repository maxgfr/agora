/** Showing a code (QR + text + copy) and taking one (paste or scan). */
import type { JSX } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n";
import { QrCode } from "./QrCode";

const QrScanner = lazy(() => import("./QrScanner").then((m) => ({ default: m.QrScanner })));

export function CopyButton(props: { text: string; testId?: string }): JSX.Element {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      class="btn btn-small"
      data-testid={props.testId}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // clipboard refused: the text stays selectable
        }
      }}
    >
      {done ? t("copied") : t("copy")}
    </button>
  );
}

export function CodeBox(props: {
  code: string;
  label: string;
  testId: string;
  /** "toggle": the QR code shows on demand (where the text is what people mostly use). */
  qr?: boolean | "toggle";
  share?: boolean;
}): JSX.Element {
  const [shown, setShown] = useState(props.qr !== "toggle");
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  return (
    <div class="codebox">
      {props.qr !== false && shown && <QrCode value={props.code} label={props.label} size={200} />}
      <code class="code-text" data-testid={props.testId}>
        {props.code}
      </code>
      <div class="row">
        <CopyButton text={props.code} />
        {props.share && canShare && (
          <button
            type="button"
            class="btn btn-small btn-ghost"
            onClick={() => void navigator.share({ text: props.code }).catch(() => {})}
          >
            {t("share")}
          </button>
        )}
        {props.qr === "toggle" && (
          <button
            type="button"
            class="btn btn-small btn-ghost"
            aria-expanded={shown}
            onClick={() => setShown(!shown)}
          >
            {shown ? t("hideQr") : t("showQr")}
          </button>
        )}
      </div>
    </div>
  );
}

/** A code typed, pasted or scanned; `onCode` returns an error message or null when accepted. */
export function CodeInput(props: {
  label: string;
  submit: string;
  testId: string;
  onCode: (text: string) => string | null | Promise<string | null>;
  /** Fills the field (a code the app's scanner read for this screen). */
  prefill?: string | null;
  /** No camera button (the camera is already open around this field). */
  noScan?: boolean;
}): JSX.Element {
  const [text, setText] = useState(props.prefill ?? "");
  useEffect(() => {
    if (props.prefill) setText(props.prefill);
  }, [props.prefill]);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (value: string) => {
    setBusy(true);
    try {
      const err = await props.onCode(value.trim());
      setError(err);
      if (!err) setText("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      class="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run(text);
      }}
    >
      <label class="field">
        <span>{props.label}</span>
        <textarea
          rows={2}
          value={text}
          data-testid={props.testId}
          spellcheck={false}
          autocomplete="off"
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </label>
      {scanning && (
        <Suspense fallback={<p class="hint">…</p>}>
          <QrScanner
            onResult={(v) => {
              setScanning(false);
              void run(v);
            }}
            onCancel={() => setScanning(false)}
          />
        </Suspense>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <div class="row">
        <button type="submit" class="btn btn-primary" disabled={busy || !text.trim()}>
          {props.submit}
        </button>
        {!scanning && !props.noScan && (
          <button type="button" class="btn btn-ghost" onClick={() => setScanning(true)}>
            {t("scan")}
          </button>
        )}
      </div>
    </form>
  );
}
