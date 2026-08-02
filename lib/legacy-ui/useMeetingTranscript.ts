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
    // Ensure parent doc exists so the Firestore security rules can address it
    await setDoc(
      doc(firebaseDb, "meeting_transcripts", meetId),
      { meetId, deleteAtMs, updatedAt: serverTimestamp() },
      { merge: true },
    );
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

  // ── Add line: state + Firestore ───────────────────────────────────────────
  const addLine = useCallback((line: TranscriptLine) => {
    transcriptRef.current = [...transcriptRef.current, line];
    setTranscript([...transcriptRef.current]);
    void saveLineToFirestore(meetIdRef.current, line);
  }, []);

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
        addLine({
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
    addLine(line);
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
            if (text?.trim()) sendLineRef.current?.(text);
          }
        }
      };

      r.onend = () => {
        runningRef.current = false;
        // Auto-restart on silence timeout / network blip when mic is still on
        if (micOnRef.current) {
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
          }, 300);
        } else {
          setIsTranscribing(false);
        }
      };

      r.onerror = (event) => {
        runningRef.current = false;
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
