/**
 * The app-wide scanner: the camera (or a pasted code) reads any agora code and
 * the app opens what it is for. See `handleScan` in ../../app/state.ts.
 */
import type { JSX } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import { handleScan, scanOpen } from "../../app/state";
import { t } from "../i18n";
import { CodeInput } from "./Codes";

const QrScanner = lazy(() => import("./QrScanner").then((m) => ({ default: m.QrScanner })));

export function ScanSheet(): JSX.Element | null {
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const open = scanOpen.value;
  const close = () => {
    scanOpen.value = false;
    setError(null);
  };
  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  /** A pasted code: the field shows the error itself. */
  const take = (text: string): string | null => {
    const err = handleScan(text);
    if (err) return t(err);
    close();
    return null;
  };
  /** A code from the camera: the error shows above the field. */
  const scanned = (text: string) => {
    const err = take(text);
    setError(err);
  };
  return (
    <div class="sheet-backdrop">
      <div
        class="sheet stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-title"
        tabIndex={-1}
        ref={dialog}
      >
        <div class="row-between">
          <h2 id="scan-title">{t("scanTitle")}</h2>
          <button type="button" class="btn btn-small btn-ghost" onClick={close}>
            {t("close")}
          </button>
        </div>
        <p class="hint">{t("scanHint")}</p>
        <Suspense fallback={<div class="spinner" aria-hidden="true" />}>
          <QrScanner onResult={scanned} onCancel={close} showCancel={false} />
        </Suspense>
        {error && (
          <p class="error" role="alert" data-testid="scan-error">
            {error}
          </p>
        )}
        <CodeInput
          label={t("orPaste")}
          submit={t("openCode")}
          testId="scan-input"
          onCode={take}
          noScan
        />
      </div>
    </div>
  );
}
