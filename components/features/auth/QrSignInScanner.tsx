"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, InlineError } from "@/components/ui/Primitives";
import { readQrPayload } from "@/lib/auth/recoveryApi";

/**
 * The camera half of scan-to-sign-in.
 *
 * It finds a QR code and hands the decoded string up. It does not know what a
 * sign-in is, does not call the backend and does not touch Firebase — `SignInForm`
 * owns all of that. Keeping the split means the camera can be tested and
 * reasoned about as a camera, and the sign-in path stays in one file.
 *
 * ## Decoding: the browser first, a library only if it must
 *
 * `BarcodeDetector` is native in Chrome, Edge and Android's WebView — most of
 * this company's machines — and costs nothing to ship. Safari and Firefox do
 * not have it, so `jsQR` is the fallback, and it is loaded with a **dynamic
 * import inside the failure branch**: on a browser that has the native detector
 * the library is never fetched at all, and on one that does not it arrives when
 * somebody opens the scanner rather than sitting in the sign-in bundle for
 * everyone. Sign-in is the one page the whole company loads on a cold cache;
 * putting 40KB of QR decoder in it to serve a button most people never press is
 * exactly the kind of weight that makes a login feel slow.
 *
 * ## Why the scan loop is throttled
 *
 * Decoding runs on a timer at `SCAN_INTERVAL_MS`, not in `requestAnimationFrame`.
 * A rAF loop decodes sixty times a second, pins a core, spins up the fan and
 * flattens a laptop battery — for a job where four looks a second finds the code
 * just as fast, because the limit is the human holding the phone steady, not the
 * decoder.
 */

/** Four looks a second. See the note above. */
const SCAN_INTERVAL_MS = 250;

/**
 * The frame handed to the decoder, in pixels on the long edge.
 *
 * The camera may hand back 1920×1080. Decoding that is several times the work
 * for no gain: a QR filling a third of the frame is far past legible at 640,
 * and the copy from video to canvas is the expensive part.
 */
const DECODE_EDGE = 640;

type Phase =
  | { name: "starting" }
  | { name: "scanning" }
  | { name: "failed"; message: string };

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

export function QrSignInScanner({
  onScan,
  onCancel,
  busy,
  error,
}: {
  /** A decoded, shape-checked token. Never a raw camera string. */
  onScan: (token: string) => void;
  onCancel: () => void;
  /** True while the caller is redeeming — the loop pauses rather than re-firing. */
  busy: boolean;
  /** The caller's failure, shown under the viewfinder so the camera stays up. */
  error: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "starting" });

  /* Read by the loop, and deliberately a ref rather than a dependency: putting
     `busy` in the effect's array would tear the camera down and build it back
     up on every redemption attempt, which on most webcams is a visible
     half-second of black and a fresh exposure ramp. */
  const busyRef = useRef(busy);
  busyRef.current = busy;

  /* Same reason. `onScan` is redefined on each render of the parent; a stable
     ref keeps the effect from restarting the camera whenever it does. */
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  /** Stop every track. A camera left running keeps the indicator light on. */
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    /**
     * jsQR, fetched once and only where the native detector is missing.
     * `null` means "asked and it is not available", so a failed fetch is not
     * retried four times a second.
     */
    let jsQR: typeof import("jsqr").default | null | undefined;

    async function decodeFrame(
      detector: BarcodeDetectorLike | null,
      canvas: HTMLCanvasElement,
      context: CanvasRenderingContext2D,
    ): Promise<string | null> {
      if (detector) {
        try {
          const found = await detector.detect(canvas);
          return found[0]?.rawValue ?? null;
        } catch {
          /* A detector that throws mid-session (some Android builds do, when
             the surface is resized) must not kill the scan — fall through to
             the library rather than leaving a dead viewfinder. */
        }
      }

      if (jsQR === undefined) {
        try {
          jsQR = (await import("jsqr")).default;
        } catch {
          jsQR = null;
        }
      }
      if (!jsQR) return null;

      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const hit = jsQR(image.data, image.width, image.height, {
        /* The codes this app shows are dark-on-light. Not attempting the
           inverted pass halves the decode cost for a case that cannot occur. */
        inversionAttempts: "dontInvert",
      });
      return hit?.data ?? null;
    }

    (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setPhase({
          name: "failed",
          message:
            /* getUserMedia is undefined on an insecure origin as well as on an
               old browser, and "your browser does not support this" would send
               somebody hunting for the wrong fix. Naming HTTPS is the actual
               next move when this app is reached over a plain-http tunnel. */
            "This browser cannot open a camera here. Scanning needs a secure (https) connection.",
        });
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            /* A hint, not a requirement — `ideal` rather than `exact`. A laptop
               has no environment-facing camera, and `exact` would fail outright
               on the very machines this feature is for. */
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        setPhase({
          name: "failed",
          message:
            name === "NotAllowedError"
              ? "Camera access was refused. Allow it in your browser's address bar, then try again."
              : name === "NotFoundError"
                ? "No camera was found on this device."
                : "Could not start the camera. Sign in with your password instead.",
        });
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      video.srcObject = stream;
      /* `playsInline` is set on the element too. Without it iOS Safari takes
         the video fullscreen the moment it plays, covering the whole form. */
      try {
        await video.play();
      } catch {
        /* Autoplay refusal. The stream is live and the frames still reach the
           canvas, so the scan works even where the preview does not — better
           than refusing outright. */
      }
      if (cancelled) return;
      setPhase({ name: "scanning" });

      let detector: BarcodeDetectorLike | null = null;
      const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (Ctor) {
        try {
          detector = new Ctor({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;

      const tick = async () => {
        if (cancelled) return;

        /* Paused while the caller redeems, and while the tab is hidden. A
           background tab decoding four frames a second is pure waste — nobody
           is holding a phone up to a window they cannot see. */
        if (!busyRef.current && !document.hidden && video.videoWidth > 0) {
          const scale = Math.min(1, DECODE_EDGE / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);

          const raw = await decodeFrame(detector, canvas, context);
          if (cancelled) return;

          if (raw) {
            const token = readQrPayload(raw);
            /* A QR that is not one of ours is ignored in silence rather than
               reported. Cameras find codes everywhere — a WiFi sticker, a
               parcel label — and an error for each one would bury the real
               instruction under noise while somebody is still lining up. */
            if (token) {
              onScanRef.current(token);
            }
          }
        }

        timer = setTimeout(() => void tick(), SCAN_INTERVAL_MS);
      };

      void tick();
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stopCamera();
    };
  }, [stopCamera]);

  return (
    <div className="flex flex-col gap-4">
      {phase.name === "failed" ? (
        <InlineError message={phase.message} />
      ) : (
        <>
          <div className="relative overflow-hidden rounded-inset bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              /* Decorative: everything this element conveys is stated in the
                 status line below, which is what a screen-reader user gets. */
              aria-hidden="true"
              className="aspect-[4/3] w-full object-cover"
            />
            {/* The target. Purely a guide — the decoder reads the whole frame,
                so a code slightly outside it still scans. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 grid place-items-center"
            >
              <div className="h-[58%] aspect-square rounded-[18px] border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          </div>

          <p role="status" className="text-sm leading-relaxed text-ink-muted">
            {busy
              ? "Code found. Signing you in…"
              : phase.name === "starting"
                ? "Starting the camera…"
                : "Open Cowork on a device you are already signed in to, go to your profile, and press Share Dashboard. Hold the code up to the camera."}
          </p>
        </>
      )}

      {error && <InlineError message={error} />}

      <Button type="button" onClick={onCancel} className="w-full">
        Use a password instead
      </Button>

      {/* Never displayed. It exists to give the decoder pixels — reading them
          straight from a <video> is not possible. */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
