"use client";

/**
 * Per-meeting live transcript.
 *
 * Ported from the legacy `hooks/useMeetingTranscript.js`.
 *
 * Architecture:
 *  - SpeechRecognition (Web Speech API) captures the LOCAL participant's words.
 *  - LiveKit DataChannel (`meeting-transcript` topic) broadcasts each recognised
 *    line to all other participants; they receive it via RoomEvent.DataReceived.
 *  - Firestore `meeting_transcripts/{meetId}/lines/{lineId}` is the durable store
 *    (24-hour TTL); lines are loaded on first mount so a late joiner sees history.
 *  - Mic mute polling (500 ms) starts/stops recognition in sync with LiveKit.
 *  - Language modes: Hindi (hi-IN), English (en-IN), Odia (en-IN recognition but
 *    speaker uses Odia — prints English phonetics, avoids Odia-script encoding
 *    issues in Chrome).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRoomContext, useLocalParticipant } from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";
import { firebaseDb } from "./coworkFirebase";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

// ── Language config ────────────────────────────────────────────────────────────

export const SUPPORTED_LANGS = {
  HINDI: {
    code: "hi-IN" as const,
    label: "हि/En",
    recognitionLang: "hi-IN",
    hint: "Hindi + English auto-detect",
  },
  ENGLISH: {
    code: "en-IN" as const,
    label: "English",
    recognitionLang: "en-IN",
    hint: "English only",
  },
  ODIA: {
    code: "odia" as const,
    label: "ଓଡ଼ିଆ",
    recognitionLang: "en-IN",
    hint: "Speak Odia — prints English words",
  },
} as const;

export type LangCode = "hi-IN" | "en-IN" | "odia";

export interface TranscriptLine {
  name: string;
  text: string;
  time: string;
  language: LangCode;
}

const TOPIC = "meeting-transcript";

/**
 * Meetings whose parent transcript document this tab has already created.
 *
 * The parent exists so the security rules have something to address, which is a
 * once-per-meeting need — but it was `setDoc(..., { merge: true })` on EVERY
 * line, doubling the write count and making one document the hot spot for the
 * whole meeting. Firestore also rate-limits sustained writes to a single
 * document, so a lively meeting was contending with itself.
 *
 * Module-scoped rather than a ref: the guard should survive the hook
 * remounting, which happens whenever the room is docked, undocked or the panel
 * is collapsed.
 */
const parentEnsured = new Set<string>();

// ── Firestore helpers ──────────────────────────────────────────────────────────

async function saveLineToFirestore(
  meetId: string,
  line: TranscriptLine,
): Promise<void> {
  if (!meetId || !line) return;
  try {
    const lineId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const deleteAtMs = Date.now() + 24 * 60 * 60 * 1000; // 24-hour TTL
    await setDoc(
      doc(firebaseDb, "meeting_transcripts", meetId, "lines", lineId),
      {
        lineId,
        meetId,
        name: line.name,
        text: line.text,
        time: line.time,
        language: line.language,
        createdAt: serverTimestamp(),
        deleteAtMs,
      },
    );
    // Ensure parent doc exists so the Firestore security rules can address it —
    // once per meeting per tab, not once per line. See `parentEnsured`.
    if (!parentEnsured.has(meetId)) {
      parentEnsured.add(meetId);
      try {
        await setDoc(
          doc(firebaseDb, "meeting_transcripts", meetId),
          { meetId, deleteAtMs, updatedAt: serverTimestamp() },
          { merge: true },
        );
      } catch (e) {
        /* Let the next line retry rather than leaving the parent missing for
           the rest of the meeting. */
        parentEnsured.delete(meetId);
        throw e;
      }
    }
  } catch (e) {
    console.warn("[useMeetingTranscript] saveLineToFirestore:", e);
  }
}

async function loadLinesFromFirestore(
  meetId: string,
): Promise<TranscriptLine[]> {
  if (!meetId) return [];
  try {
    const snap = await getDocs(
      query(
        collection(firebaseDb, "meeting_transcripts", meetId, "lines"),
        orderBy("createdAt", "asc"),
      ),
    );
    return snap.docs.map((d) => ({
      name: d.data().name as string,
      text: d.data().text as string,
      time: d.data().time as string,
      language: (d.data().language ?? "hi-IN") as LangCode,
    }));
  } catch (e) {
    console.warn("[useMeetingTranscript] loadLinesFromFirestore:", e);
    return [];
  }
}

// ── Types for the Web Speech API (not in TS lib.dom) ─────────────────────────

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}

interface SpeechRecognitionResultList {
  readonly length: number;
  readonly resultIndex: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent {
  readonly error: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onresult: (e: SpeechRecognitionEvent) => void;
  onend: () => void;
  onerror: (e: SpeechRecognitionErrorEvent) => void;
  start: () => void;
  abort: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMeetingTranscript({
  participantName,
  meetId,
}: {
  participantName: string;
  meetId: string;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();

  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [activeLang, setActiveLang] = useState<LangCode>(
    SUPPORTED_LANGS.HINDI.code,
  );

  // Refs to avoid stale closures in callbacks
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const runningRef = useRef(false);
  const micOnRef = useRef(false);
  /**
   * Consecutive restarts that produced no speech, used to back off.
   *
   * `onend` re-`start()`s after 300ms whenever the mic is on, which is right
   * for the ordinary case — the Web Speech API ends a session on its own after
   * a stretch of silence and has to be restarted to keep listening.
   *
   * It is wrong when the restart itself is what is failing. A `network` or
   * `service-not-allowed`-adjacent failure ends the session immediately, so the
   * pair became a ~3 Hz retry loop for the length of the meeting: a request
   * every 300ms to a service that is not answering, with nothing counting the
   * failures and nothing ever giving up. Only `not-allowed` broke the cycle,
   * because that branch clears `micOnRef`.
   *
   * Reset by any final result, so a working meeting never backs off.
   *
   * Counted ONLY for failure ends, never for silence ends. A meeting is mostly
   * people listening, and the API ends a session after every quiet stretch — so
   * counting those would climb the ladder and switch off the transcript of the
   * person who was politely not talking. `lastErrorRef` is what tells the two
   * apart.
   */
  const emptyRestartsRef = useRef(0);
  /** The last `onerror` reason, consumed by the next `onend`. */
  const lastErrorRef = useRef<string | null>(null);
  const localPartRef = useRef(localParticipant);
  const nameRef = useRef(participantName);
  const activeLangRef = useRef<LangCode>(SUPPORTED_LANGS.HINDI.code);
  const activeRecognitionLangRef = useRef<string>(SUPPORTED_LANGS.HINDI.recognitionLang);
  const meetIdRef = useRef(meetId);
  const loadedRef = useRef(false);

  // Keep refs current
  localPartRef.current = localParticipant;
  nameRef.current = participantName;
  activeLangRef.current = activeLang;
  meetIdRef.current = meetId;

  // ── Load history on first mount ───────────────────────────────────────────
  useEffect(() => {
    if (!meetId || loadedRef.current) return;
    loadedRef.current = true;
    void loadLinesFromFirestore(meetId).then((lines) => {
      if (lines.length > 0) {
        transcriptRef.current = lines;
        setTranscript([...lines]);
      }
    });
  }, [meetId]);

  /**
   * Show a line. Does NOT persist it.
   *
   * **The split this replaces.** There was one `addLine` that appended to state
   * AND wrote to Firestore, and BOTH the local recogniser and every remote
   * participant's `DataReceived` handler called it. LiveKit does not echo your
   * own `publishData` back to you, so the two paths never overlap for one
   * speaker — but they do mean that when somebody speaks, every OTHER person in
   * the room writes that sentence to Firestore as well.
   *
   * Because the document id was minted per caller (`Date.now()` plus a random
   * suffix), the writers never converged on one document. One sentence in an
   * N-person meeting became N documents and, counting the parent merge, 2N
   * writes — and on the next load `loadLinesFromFirestore` faithfully rendered
   * each sentence N times, so it was a visible correctness bug as much as a
   * billing one.
   *
   * The speaker owns their own line. Everybody else just displays it.
   */
  const addLineRemote = useCallback((line: TranscriptLine) => {
    transcriptRef.current = [...transcriptRef.current, line];
    setTranscript([...transcriptRef.current]);
  }, []);

  /** Show a line I spoke, and persist it — exactly once, from here. */
  const addLineLocal = useCallback(
    (line: TranscriptLine) => {
      addLineRemote(line);
      void saveLineToFirestore(meetIdRef.current, line);
    },
    [addLineRemote],
  );

  // ── Receive DataChannel lines from other participants ─────────────────────
  const onDataRef = useRef<
    (
      payload: Uint8Array,
      participant: unknown,
      kind: unknown,
      topic?: string,
    ) => void
  >(undefined);
  onDataRef.current = (payload, _participant, _kind, topic) => {
    if (topic !== TOPIC) return;
    try {
      const data = JSON.parse(new TextDecoder().decode(payload)) as {
        type: string;
        name: string;
        text: string;
        time: string;
        language: LangCode;
      };
      if (data.type === "tx") {
        /* Display only. The speaker persisted this already. */
        addLineRemote({
          name: data.name,
          text: data.text,
          time: data.time,
          language: data.language,
        });
      }
    } catch {
      /* malformed payload — ignore */
    }
  };

  useEffect(() => {
    if (!room) return;
    const h = (
      payload: Uint8Array,
      participant: unknown,
      kind: unknown,
      topic?: string,
    ) => onDataRef.current?.(payload, participant, kind, topic);
    room.on(RoomEvent.DataReceived, h);
    return () => {
      room.off(RoomEvent.DataReceived, h);
    };
  }, [room]);

  // ── Send my recognised line ───────────────────────────────────────────────
  const sendLineRef = useRef<(text: string) => void>(undefined);
  sendLineRef.current = (text: string) => {
    if (!text?.trim()) return;
    const myName =
      nameRef.current || localPartRef.current?.name || "Participant";
    const line: TranscriptLine = {
      name: myName,
      text: text.trim(),
      time: new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      language: activeLangRef.current,
    };
    addLineLocal(line);
    // Broadcast to other room participants
    const lp = localPartRef.current;
    if (lp) {
      const payload = new TextEncoder().encode(
        JSON.stringify({ type: "tx", ...line }),
      );
      lp.publishData(payload, { reliable: true, topic: TOPIC }).catch((e) => {
        console.warn("[useMeetingTranscript] publishData:", e);
      });
    }
  };

  // ── Build SpeechRecognition instance ─────────────────────────────────────
  const buildRecognition = useCallback(
    (recognitionLangCode: string): SpeechRecognitionInstance | null => {
      const SR =
        typeof window !== "undefined"
          ? window.SpeechRecognition ?? window.webkitSpeechRecognition
          : undefined;
      if (!SR) {
        setSpeechSupported(false);
        return null;
      }
      const r = new SR();
      r.continuous = true;
      r.interimResults = false;
      r.maxAlternatives = 1;
      r.lang = recognitionLangCode;

      r.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            const text = event.results[i][0].transcript;
            if (text?.trim()) {
              /* Recognition is working, so the retry ladder resets. */
              emptyRestartsRef.current = 0;
              sendLineRef.current?.(text);
            }
          }
        }
      };

      r.onend = () => {
        runningRef.current = false;
        if (!micOnRef.current) {
          setIsTranscribing(false);
          return;
        }

        /* Why this session ended, and therefore how hard to try again.
           `no-speech` is the ordinary silence timeout and is not a failure —
           it restarts immediately and never counts. Anything else did fail. */
        const err = lastErrorRef.current;
        lastErrorRef.current = null;
        const failed = err !== null && err !== "no-speech";

        let delay = 300;
        if (failed) {
          /* Give up rather than hammer a service that is not answering. Eight
             consecutive failures spans about half a minute with the ladder
             below — long enough to ride out a real network blip, short enough
             not to spend the meeting retrying. */
          if (emptyRestartsRef.current >= 8) {
            setIsTranscribing(false);
            console.warn(
              `[useMeetingTranscript] speech recognition kept failing (${err}) — stopping. Toggle the mic to try again.`,
            );
            return;
          }
          /* 300ms doubling to a 10s ceiling. */
          delay = Math.min(300 * 2 ** emptyRestartsRef.current, 10_000);
          emptyRestartsRef.current += 1;
        }

        setTimeout(() => {
          const rec = recognitionRef.current;
          if (rec && micOnRef.current && !runningRef.current) {
            try {
              rec.start();
              runningRef.current = true;
            } catch {
              /* already started */
            }
          }
        }, delay);
      };

      r.onerror = (event) => {
        runningRef.current = false;
        /* Recorded for the `onend` that follows, which decides whether to
           restart immediately, back off, or stop. */
        lastErrorRef.current = event.error ?? "unknown";
        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
        ) {
          setSpeechSupported(false);
          micOnRef.current = false;
          setIsTranscribing(false);
        }
        // "no-speech" / "network" / "aborted" → onend fires → auto-restart
      };

      return r;
    },
    [],
  );

  // ── Start recognition ─────────────────────────────────────────────────────
  const startRecognition = useCallback(
    (recognitionLangCode: string) => {
      if (recognitionRef.current) {
        runningRef.current = false;
        try {
          recognitionRef.current.abort();
        } catch {
          /* already stopped */
        }
        recognitionRef.current = null;
      }
      const r = buildRecognition(recognitionLangCode);
      if (!r) return;
      recognitionRef.current = r;
      try {
        r.start();
        runningRef.current = true;
        setIsTranscribing(true);
      } catch (e) {
        console.warn("[useMeetingTranscript] recognition.start():", e);
      }
    },
    [buildRecognition],
  );

  // ── Stop recognition ──────────────────────────────────────────────────────
  const stopRecognition = useCallback(() => {
    runningRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* nothing */
      }
      recognitionRef.current = null;
    }
    setIsTranscribing(false);
  }, []);

  // ── Poll mic mute state every 500 ms ─────────────────────────────────────
  useEffect(() => {
    if (!localParticipant) return;
    const checkMute = () => {
      const pub = localParticipant.getTrackPublication(
        Track.Source.Microphone,
      );
      const muted = !pub || pub.isMuted;
      const was = micOnRef.current;
      micOnRef.current = !muted;
      if (!muted && !was) startRecognition(activeRecognitionLangRef.current);
      else if (muted && was) stopRecognition();
    };
    const interval = setInterval(checkMute, 500);
    checkMute();
    return () => {
      clearInterval(interval);
      micOnRef.current = false;
      stopRecognition();
    };
  }, [localParticipant, startRecognition, stopRecognition]);

  // ── Switch language ───────────────────────────────────────────────────────
  const switchLanguage = useCallback(
    (langCode: LangCode) => {
      let recognitionLang: string;
      if (langCode === "hi-IN") {
        recognitionLang = SUPPORTED_LANGS.HINDI.recognitionLang;
      } else if (langCode === "en-IN") {
        recognitionLang = SUPPORTED_LANGS.ENGLISH.recognitionLang;
      } else {
        // odia — en-IN recognition, Odia speaker
        recognitionLang = SUPPORTED_LANGS.ODIA.recognitionLang;
      }
      setActiveLang(langCode);
      activeLangRef.current = langCode;
      activeRecognitionLangRef.current = recognitionLang;
      if (micOnRef.current) startRecognition(recognitionLang);
    },
    [startRecognition],
  );

  return {
    transcript,
    isTranscribing,
    speechSupported,
    activeLang,
    switchLanguage,
    clearTranscript: () => {
      transcriptRef.current = [];
      setTranscript([]);
    },
  };
}
