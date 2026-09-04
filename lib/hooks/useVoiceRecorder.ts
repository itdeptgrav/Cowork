"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pickAudioMime, voiceNoteFilename } from "@/lib/rules/messages/voiceNote";

export interface VoiceRecorder {
  /** Whether this browser can record at all — false hides the control. */
  supported: boolean;
  recording: boolean;
  /** Elapsed whole seconds while recording, for the timer. */
  seconds: number;
  error: string | null;
  /** Begin recording (asks for the mic the first time). */
  start: () => Promise<void>;
  /** Stop and DELIVER the note through `onRecorded`. */
  stop: () => void;
  /** Stop and DISCARD — nothing is delivered. */
  cancel: () => void;
}

/**
 * Record a voice note and hand it back as a `File`, ready for the SAME upload
 * path a picked file takes. No new storage, no schema change: an audio file is
 * an attachment of kind `voice`, which both chats already render as a player.
 *
 * The browser MediaRecorder is stopped and its tracks released on unmount, on
 * cancel, and on send, so a recording never keeps the mic open in the
 * background.
 */
export function useVoiceRecorder(
  onRecorded: (file: File) => void,
): VoiceRecorder {
  const supported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  /* onRecorded is read at stop time, not captured when `start` was built, so a
     re-render of the composer between start and stop cannot deliver to a stale
     handler. */
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setSeconds(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (!supported || recRef.current) return;
    setError(null);
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickAudioMime();
      const rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const cancelled = cancelledRef.current;
        const type = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        cleanup();
        if (cancelled || blob.size === 0) return;
        const name = voiceNoteFilename(type, `${Date.now()}`);
        onRecordedRef.current(new File([blob], name, { type: blob.type }));
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("Microphone access was blocked.");
      cleanup();
    }
  }, [supported, cleanup]);

  const stop = useCallback(() => {
    cancelledRef.current = false;
    recRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    recRef.current?.stop();
  }, []);

  return { supported, recording, seconds, error, start, stop, cancel };
}
