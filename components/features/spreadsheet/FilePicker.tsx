"use client";

/**
 * A file chooser that opens as soon as it is mounted, and reports once.
 *
 * A menu item cannot simply call `.click()` on a hidden `<input>`: the menu
 * builds its items DURING render, so reaching for the input's ref there is a
 * ref read during render — which React's lint rule catches, and rightly, since
 * a ref read at that moment can see the previous commit's node.
 *
 * Mounting instead of clicking moves the ref read into an effect, where it
 * belongs. The parent renders this when somebody chooses Insert ▸ Image and
 * drops it again the moment it reports, so the next Insert ▸ Image mounts a
 * fresh one — which also disposes of the other hazard here, that choosing the
 * SAME file twice from one input fires no second change event.
 */

import { useEffect, useRef } from "react";

export function FilePicker({
  accept,
  onPick,
}: {
  accept: string;
  /** Null when the chooser was dismissed without picking anything. */
  onPick: (file: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const reported = useRef(false);
  /* Read by the native listener below, which is registered once and would
     otherwise close over the first render's prop for the life of the input.
     Kept current in its own effect rather than assigned during render — a ref
     written while rendering is read back inconsistently under StrictMode's
     double invocation. */
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = (file: File | null) => {
      if (reported.current) return;
      reported.current = true;
      pick.current(file);
    };
    const onChange = () => report(el.files?.[0] ?? null);
    /* `cancel` fires when the chooser is dismissed with nothing picked. Added
       natively because React's input typings have no `onCancel`; the event is
       also not universal — Firefox has only had it since 2023 — so the parent
       must treat "never reported" as a live possibility and not, say, hold a
       spinner open waiting for it. */
    const onCancel = () => report(null);
    el.addEventListener("change", onChange);
    el.addEventListener("cancel", onCancel);
    el.click();
    return () => {
      el.removeEventListener("change", onChange);
      el.removeEventListener("cancel", onCancel);
    };
  }, []);

  return <input ref={ref} type="file" accept={accept} className="hidden" />;
}
