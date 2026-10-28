/** Runs a user action once at a time: a busy flag, and any failure shown instead of a stuck button. */
import { useState } from "preact/hooks";
import { t } from "../i18n";

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`${t("actionFailed")} (${detail})`);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}
