/** Picks up what the app's scanner read for this screen (once), even if it is already open. */
import { useEffect } from "preact/hooks";
import { type ScanIntent, scanIntent } from "../../app/state";

export function useIntent<K extends ScanIntent["kind"]>(
  groupId: string,
  kind: K,
  fn: (intent: Extract<ScanIntent, { kind: K }>) => void,
): void {
  const intent = scanIntent.value;
  useEffect(() => {
    if (!intent || intent.groupId !== groupId || intent.kind !== kind) return;
    scanIntent.value = null;
    fn(intent as Extract<ScanIntent, { kind: K }>);
  }, [intent]);
}
