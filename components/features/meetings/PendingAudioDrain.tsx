"use client";

import { useEffect } from "react";
import { drainPendingAudio } from "@/lib/legacy-ui/useMeetingRecording";

/** How often to retry unsent audio while a page is open. */
const RETRY_MS = 60_000;

/**
 * Send audio that never made it, from anywhere in the app.
 *
 * ## The hole this closes
 *
 * A recording is written to the browser's own disk before it is uploaded, so a
 * dropped connection never loses it. What was missing was the second half: the
 * retry lived inside `useMeetingRecording`, and that hook mounts only inside a
 * meeting room. So the rescue happened **only if the person joined another
 * meeting**.
 *
 * Somebody whose network died mid-call, who then went back to their tasks for
 * the rest of the week, had a finished recording sitting in their browser that
 * nothing would ever send. It expires after seven days. That is the case where
 * audio was actually lost, and it was lost to a mounting decision rather than
 * to any failure of the recording itself.
 *
 * Mounted in the shell, this runs on every page: the moment they open Cowork at
 * all, their audio goes.
 *
 * ## Why it is safe to run everywhere
 *
 * `drainPendingAudio` is idempotent and guards against overlapping runs.
 * Chunks are keyed by index server-side so a replay overwrites rather than
 * appends, and finalizing a recording whose chunks were already merged answers
 * `skipped` rather than writing a second file. With nothing pending it is one
 * IndexedDB read that finds an empty store.
 *
 * ## Persistent storage
 *
 * Asked for once, here, because this is the component that cares. Without it
 * the browser's storage is "best effort" and Chrome may evict it when the disk
 * runs low — silently discarding a recording that had not uploaded yet. The
 * request is granted or refused by the browser on its own criteria; either way
 * nothing else changes, so there is nothing to handle but the asking.
 */
export function PendingAudioDrain() {
  useEffect(() => {
    /* Best effort, and deliberately un-awaited: the drain must not wait on a
       permission prompt, and a refusal changes nothing about what follows. */
    void navigator.storage?.persist?.().catch(() => false);

    void drainPendingAudio();
    const timer = setInterval(() => void drainPendingAudio(), RETRY_MS);
    /* The moment the network is back — the commonest reason a chunk is still
       sitting here at all. */
    const onOnline = () => void drainPendingAudio();
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return null;
}
