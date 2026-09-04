"use client";

/**
 * Voice typing — Docs' Tools ▸ Voice typing.
 *
 * The browser's own speech recognition (Chrome and Edge ship it; Firefox
 * and Safari do not) listens while the pill is open and drops each
 * finished phrase at the caret. Nothing leaves the machine through us: the
 * recognition is the browser's, and only the recognised text touches the
 * document. Interim words show in the pill so the speaker sees the
 * recogniser keeping up, and are replaced when the phrase settles.
 */

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";

import { speechRecognitionCtor, type RecognitionLike } from "@/lib/documents/voice";
import { spokenPunctuation } from "@/lib/documents/voice";

export function DocsVoiceTyping({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [interim, setInterim] = useState("");
  const [status, setStatus] = useState<"listening" | "unsupported" | "denied" | "stopped">(() => (speechRecognitionCtor() ? "listening" : "unsupported"));
  const recognition = useRef<RecognitionLike | null>(null);
  const wantOn = useRef(true);

  useEffect(() => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (finalText) {
        const text = spokenPunctuation(finalText.trim());
        const parts = text.split("\n\n");
        const chain = editor.chain().focus();
        parts.forEach((part, i) => {
          if (i > 0) chain.splitBlock();
          part.split("\n").forEach((line, j) => {
            if (j > 0) chain.setHardBreak();
            if (line) chain.insertContent(line + " ");
          });
        });
        chain.run();
      }
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantOn.current = false;
        setStatus("denied");
      }
    };
    rec.onend = () => {
      /* Chrome ends a continuous session after a silence; start again while
         the pill is open, so a pause for thought does not switch it off. */
      if (wantOn.current) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      } else setStatus("stopped");
    };
    recognition.current = rec;
    try {
      rec.start();
    } catch {
      /* A recogniser that will not start is as good as none. Reported from a
         callback, since the effect body itself must not set state. */
      setTimeout(() => setStatus("unsupported"), 0);
    }
    return () => {
      wantOn.current = false;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* never started */
      }
    };
  }, [editor]);

  const stop = () => {
    wantOn.current = false;
    try {
      recognition.current?.stop();
    } catch {
      /* not running */
    }
    onClose();
  };

  return (
    <div
      role="status"
      className="fixed bottom-16 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-hairline bg-[var(--surface-raised)] py-2 pr-2 pl-4 text-[12.5px] text-ink shadow-[var(--shadow-deck-seat)]"
    >
      {status === "listening" && (
        <>
          <span aria-hidden className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e0564b] opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#e0564b]" />
          </span>
          <span className="max-w-[40ch] truncate">{interim || "Listening… speak, and say “full stop” or “new paragraph”."}</span>
        </>
      )}
      {status === "unsupported" && <span>Voice typing needs Chrome or Edge, which carry the speech recogniser.</span>}
      {status === "denied" && <span>The microphone was blocked. Allow it in the address bar, then try again.</span>}
      {status === "stopped" && <span>Voice typing stopped.</span>}
      <button type="button" onClick={stop} className="rounded-full bg-[var(--control)] px-3 py-1 text-[12px] font-medium text-ink hover:bg-[var(--control-hover)]">
        {status === "listening" ? "Stop" : "Close"}
      </button>
    </div>
  );
}
