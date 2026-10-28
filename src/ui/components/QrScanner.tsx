/**
 * Camera QR scanner. Uses the native BarcodeDetector when present, else
 * jsQR (loaded lazily, only when the scanner opens).
 */
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n";

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

type DetectorCtor = new (opts: { formats: string[] }) => Detector;

export function QrScanner(props: {
  onResult: (text: string) => void;
  onCancel: () => void;
  /** Hidden where the surrounding sheet has its own close button. */
  showCancel?: boolean;
}): JSX.Element {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch {
        setError(t("cameraUnavailable"));
        return;
      }
      // Closed while the browser was still asking for the camera: let go of it at once.
      if (stopped || !video.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      const Native = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      const detector = Native ? new Native({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;
      const scan = async () => {
        const v = video.current;
        if (stopped || !v) return;
        const started = performance.now();
        let text: string | null = null;
        if (v.videoWidth > 0) {
          if (detector) {
            text = (await detector.detect(v).catch(() => []))[0]?.rawValue ?? null;
          } else if (jsQR && ctx) {
            // jsQR runs on the main thread: only the square under the reticle, at most 400 px.
            const side = Math.min(v.videoWidth, v.videoHeight);
            const size = Math.min(400, side);
            canvas.width = size;
            canvas.height = size;
            ctx.drawImage(
              v,
              (v.videoWidth - side) / 2,
              (v.videoHeight - side) / 2,
              side,
              side,
              0,
              0,
              size,
              size,
            );
            text =
              jsQR(ctx.getImageData(0, 0, size, size).data, size, size, {
                inversionAttempts: "dontInvert",
              })?.data ?? null;
          }
        }
        if (text && !stopped) {
          props.onResult(text);
          return;
        }
        // Idle at least twice as long as a scan took: a slow phone stays responsive.
        timer = setTimeout(scan, Math.max(150, 2 * (performance.now() - started)));
      };
      void scan();
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const t of stream?.getTracks() ?? []) t.stop();
    };
  }, []);

  return (
    <div class="scanner">
      {error ? (
        <p class="muted">{error}</p>
      ) : (
        <div class="scanner-frame">
          <video ref={video} playsInline muted aria-label={t("cameraPreview")} />
          <div class="scanner-reticle" aria-hidden="true" />
        </div>
      )}
      {props.showCancel !== false && (
        <button type="button" class="btn btn-ghost" onClick={props.onCancel}>
          {t("cancel")}
        </button>
      )}
    </div>
  );
}
