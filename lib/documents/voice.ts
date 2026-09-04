/**
 * Voice typing's plain parts: finding the browser's speech recogniser, and
 * turning spoken punctuation ("full stop", "new paragraph") into marks. The
 * component in `DocsVoiceTyping.tsx` does the listening.
 */

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => RecognitionLike;

export function speechRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Spoken punctuation words → marks, so "full stop" ends a sentence. */
export function spokenPunctuation(text: string): string {
  return text
    .replace(/\s*\b(full stop|period)\b/gi, ".")
    .replace(/\s*\bcomma\b/gi, ",")
    .replace(/\s*\bquestion mark\b/gi, "?")
    .replace(/\s*\bexclamation (mark|point)\b/gi, "!")
    .replace(/\s*\bcolon\b/gi, ":")
    .replace(/\s*\bsemicolon\b/gi, ";")
    .replace(/\s*\bnew line\b/gi, "\n")
    .replace(/\s*\bnew paragraph\b/gi, "\n\n")
    .replace(/\n[ \t]+/g, "\n");
}

