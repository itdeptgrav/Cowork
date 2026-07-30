/**
 * GRAV-CMS/hooks/useCoworkNotifications.ts
 *
 * UPGRADED: Now uses Firestore onSnapshot for REAL-TIME notifications.
 * Every notification written to cowork_notifications/{id} for this employee
 * appears instantly — task assigned, chat, daily report, completion, forward,
 * deadline change, group message, DM, meeting, request — everything.
 *
 * Also fires native browser / mobile push notifications (Chrome, Edge,
 * Firefox, Android Chrome, iOS Safari 16.4+ PWA) for every new doc
 * that arrives after the page loads.
 *
 * Fields from Firestore:
 *   recipientEmployeeId, type, title, body, data, read, createdAt
 */
"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  collection, query, where, orderBy, limit,
  onSnapshot, writeBatch, getDocs, doc, DocumentData,
  QuerySnapshot, Unsubscribe,
} from "firebase/firestore";
import { firebaseDb, firebaseAuth } from "./coworkFirebase";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoworkNotification {
  id: string;
  recipientEmployeeId: string;
  type: string;
  title: string;
  body: string;
  data?: any;
  read: boolean;
  createdAt: string;
}

interface UseCoworkNotificationsReturn {
  notifications: CoworkNotification[];
  unread: number;
  // unreadDm: only unread direct_message notifications — use this for Messages badge
  unreadDm: number;
  markRead: () => Promise<void>;
  // markSectionRead: marks only notifications matching the given types as read
  markSectionRead: (types: string[]) => Promise<void>;
}

// ─── Push helpers (kept internal, no separate hook needed) ────────────────────

// ─── Sound player (called when SW asks us to play a sound) ──────────────────

const SOUND_URLS: Record<string, string> = {
  request: "/sounds/notif-request.mp3",
  task_assigned: "/sounds/notif-task.mp3",
  task_chat: "/sounds/notif-chat.mp3",
  daily_report: "/sounds/notif-default.mp3",
  completion: "/sounds/notif-done.mp3",
  default: "/sounds/notif-default.mp3",
};

function playSound(notifType: string) {
  try {
    const url = SOUND_URLS[notifType] || SOUND_URLS.default;
    const audio = new Audio(url);
    audio.volume = 0.7;
    audio.play().catch(() => {
      // Fallback: Web Audio API beep if file not found
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = notifType === "request" ? 880 : notifType === "task_assigned" ? 660 : 780;
        osc.type = "sine";
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
      } catch { /* silent fallback */ }
    });
  } catch { /* silent fallback */ }
}

// Listen for SW → client messages (sound trigger + notification click routing)
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
    if (e.data?.type === "PLAY_NOTIF_SOUND") {
      playSound(e.data.notifType || "default");
    }
    if (e.data?.type === "NOTIF_CLICK") {
      const url: string = e.data.url || "/coworking";
      // Fire the universal panel event for task/request deep-links
      const data = e.data.data || {};
      if (data.type === "request") {
        window.dispatchEvent(new CustomEvent("openRequestPanel", { detail: { tab: "received" } }));
      } else if (data.taskId) {
        localStorage.setItem("selectedTaskId", data.taskId);
        window.dispatchEvent(new CustomEvent("openRequestPanel", { detail: { tab: "received", taskId: data.taskId } }));
      } else {
        window.location.href = url;
      }
    }
  });
}

// ─── Notification helpers ─────────────────────────────────────────────────────

interface PushOpts {
  title: string;
  body: string;
  tag: string;
  url: string;
  notifType: string;
  image?: string;       // attachment image preview URL
  senderIcon?: string;  // sender avatar URL
  data?: Record<string, any>;
}

/** Send a native notification via the registered service worker. */
function showViaServiceWorker(reg: ServiceWorkerRegistration, opts: PushOpts) {
  reg.active?.postMessage({
    type: "SHOW_NOTIFICATION",
    title: opts.title,
    body: opts.body,
    tag: opts.tag,
    notifType: opts.notifType,
    image: opts.image,
    data: { url: opts.url, type: opts.notifType, ...(opts.data || {}) },
  });
}

/** Fallback: fire a Notification directly when no SW is available. */
function showDirect(opts: PushOpts) {
}

/** Register the service worker and request permission. Returns the registration or null. */
async function initPush(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || typeof Notification === "undefined") return null;

  // Request permission if not already decided
  let perm = Notification.permission;
  if (perm === "default") {
    perm = await Notification.requestPermission();
  }
  if (perm !== "granted") return null;

  if (!("serviceWorker" in navigator)) return null;

  try {
    const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return reg;
  } catch (e) {
    console.warn("[CoWork] SW registration failed — falling back to direct Notification:", e);
    return null;
  }
}

// ─── Main hook ────────────────────────────────────────────────────────────────

export function useCoworkNotifications(employeeId: string | null): UseCoworkNotificationsReturn {
  const [notifications, setNotifications] = useState<CoworkNotification[]>([]);
  const [unread, setUnread] = useState<number>(0);
  const [unreadDm, setUnreadDm] = useState<number>(0);

  const unsubRef = useRef<Unsubscribe | null>(null);
  const swRef = useRef<ServiceWorkerRegistration | null>(null);
  // Tracks the ms timestamp of the most recent notification seen on mount.
  // Only notifications NEWER than this value trigger a native push.
  const baselineMs = useRef<number>(0);
  const swReady = useRef<boolean>(false);
  const existingIds = useRef<Set<string>>(new Set());

  // ── 1. Initialise push permission + service worker once ──────────────────
  useEffect(() => {
    if (!employeeId || swReady.current) return;
    swReady.current = true;
    initPush().then(reg => { swRef.current = reg; });
  }, [employeeId]);

  // ── 2. Real-time Firestore listener ─────────────────────────────────────
  useEffect(() => {
    if (!employeeId) return;

    const q = query(
      collection(firebaseDb, "cowork_notifications"),
      where("recipientEmployeeId", "==", employeeId),
      orderBy("createdAt", "desc"),
      limit(50)
    );

    let firstLoad = true;

    const unsub = onSnapshot(
      q,
      (snap: QuerySnapshot<DocumentData>) => {
        // ── Update in-app state ──────────────────────────────────────────
        const notifs: CoworkNotification[] = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            recipientEmployeeId: data.recipientEmployeeId,
            type: data.type,
            title: data.title,
            body: data.body,
            data: data.data,
            read: data.read || false,
            createdAt: data.createdAt?.seconds
              ? new Date(data.createdAt.seconds * 1000).toISOString()
              : data.createdAt || new Date().toISOString(),
          };
        });
        setNotifications(notifs);
        setUnread(notifs.filter(n => !n.read).length);
        setUnreadDm(notifs.filter(n => !n.read && n.type === "direct_message").length);

        // ── Seed baseline on first load; fire push on subsequent changes ─
        if (firstLoad) {
          firstLoad = false;
          // Record the IDs of all existing notifications so we never replay them
          existingIds.current = new Set(snap.docs.map(d => d.id));
          return;
        }

        // ── Push native notification for each genuinely new doc ──────────
        snap.docChanges().forEach(change => {
          if (change.type !== "added") return;
          const data = change.doc.data();

          // Skip if this doc existed before we started listening
          if (existingIds.current.has(change.doc.id)) return;
          existingIds.current.add(change.doc.id);

          // Make title and body richer: show sender name prominently
          const fromName = data.data?.fromName || data.data?.senderName || "";
          const rawTitle = data.title || "CoWork";
          const title = rawTitle;
          const rawBody = data.body || "";
          // Prefix body with sender name if not already there
          const body = (fromName && !rawBody.startsWith(fromName))
            ? `${fromName}: ${rawBody}`
            : rawBody;
          const notifType = data.type || "default";
          const tag = `${notifType}-${change.doc.id}`;
          const taskId = data.data?.taskId || null;
          const requestId = data.data?.requestId || null;
          const convId = data.data?.conversationId || null;

          // Resolve deep-link URL
          const url = notifType === "dm" && convId
            ? `/coworking/direct-messages/${convId}`
            : taskId ? "/coworking/tasks"
              : "/coworking";

          // Extract image preview from first attachment if present
          const attachments: any[] = data.data?.attachments || [];
          const imageUrl: string | undefined = attachments.find(a => a?.type === "image")?.url;

          // Sender avatar — use provided URL or undefined (SW falls back to type icon)
          const senderIcon: string | undefined = data.data?.senderAvatar;

          const opts: PushOpts = {
            title, body, tag, url, notifType,
            image: imageUrl,
            senderIcon,
            data: { taskId, requestId, conversationId: convId, type: notifType },
          };

          const isVisible = typeof document !== "undefined" && document.visibilityState === "visible";

          if (isVisible) {
            // App is open — show in-app toast
            window.dispatchEvent(new CustomEvent("cowork:notification", {
              detail: { title, body, url, type: notifType, tag }
            }));
          }
          if (swRef.current?.active) {
            showViaServiceWorker(swRef.current, opts);
          }
        });
      },
      (err: Error) => {
        // Firestore index not ready or rules issue — fall back to REST
        console.warn("[CoWork] Notifications onSnapshot failed, falling back:", err.message);
        _loadFromREST(employeeId, setNotifications, setUnread);
      }
    );

    unsubRef.current = unsub;
    return () => { unsubRef.current?.(); };
  }, [employeeId]);

  // ── 3. Mark all read ─────────────────────────────────────────────────────
  const markRead = useCallback(async () => {
    if (!employeeId) return;
    try {
      // Optimistic UI update first
      setUnread(0);
      setUnreadDm(0);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));

      // Write to Firestore
      const q = query(
        collection(firebaseDb, "cowork_notifications"),
        where("recipientEmployeeId", "==", employeeId),
        where("read", "==", false)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const batch = writeBatch(firebaseDb);
        snap.docs.forEach(d => batch.update(d.ref, { read: true }));
        await batch.commit();
      }
    } catch (e) {
      // Fallback to REST API
      try {
        const u = firebaseAuth.currentUser;
        if (!u) return;
        const token = await u.getIdToken();
        await fetch(`${BASE}/cowork/notifications/read-all`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        console.error("[CoWork] Failed to mark notifications as read:", err);
      }
    }
  }, [employeeId]);

  // ── 4. Mark only a specific section's notifications as read ──────────────
  const markSectionRead = useCallback(async (types: string[]) => {
    if (!employeeId || !types.length) return;
    try {
      // Optimistic: mark matching unread notifications as read in state
      setNotifications(prev => prev.map(n =>
        !n.read && types.includes(n.type) ? { ...n, read: true } : n
      ));
      setUnread(prev => Math.max(0, prev - notifications.filter(n => !n.read && types.includes(n.type)).length));
      setUnreadDm(prev => types.includes("direct_message")
        ? Math.max(0, prev - notifications.filter(n => !n.read && n.type === "direct_message").length)
        : prev
      );

      // Write to Firestore in background
      const q = query(
        collection(firebaseDb, "cowork_notifications"),
        where("recipientEmployeeId", "==", employeeId),
        where("read", "==", false)
      );
      const snap = await getDocs(q);
      const toMark = snap.docs.filter(d => types.includes(d.data().type));
      if (toMark.length > 0) {
        const batch = writeBatch(firebaseDb);
        toMark.forEach(d => batch.update(d.ref, { read: true }));
        await batch.commit();
      }
    } catch (e) {
      console.error("[CoWork] markSectionRead failed:", e);
    }
  }, [employeeId, notifications]);

  return { notifications, unread, unreadDm, markRead, markSectionRead };
}

// ─── REST fallback ────────────────────────────────────────────────────────────

async function _loadFromREST(
  employeeId: string,
  setNotifications: React.Dispatch<React.SetStateAction<CoworkNotification[]>>,
  setUnread: React.Dispatch<React.SetStateAction<number>>
): Promise<void> {
  try {
    const u = firebaseAuth.currentUser;
    if (!u) return;
    const token = await u.getIdToken();
    const res = await fetch(`${BASE}/cowork/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    const notifs: CoworkNotification[] = data.notifications || [];
    setNotifications(notifs);
    setUnread(notifs.filter(n => !n.read).length);
  } catch (err) {
    console.error("[CoWork] Failed to load notifications from REST:", err);
  }
}
