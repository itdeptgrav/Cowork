"use client";
import { useEffect, useState } from "react";

export function useDutyStatus(employeeId) {
  const [mode, setMode] = useState(null); // null = loading, "online" | "offline" | "emergency"

  useEffect(() => {
    if (!employeeId) return;
    let unsub = () => {};
    (async () => {
      const { firebaseDb } = await import("./coworkFirebase");
      const { doc, onSnapshot } = await import("firebase/firestore");
      unsub = onSnapshot(
        doc(firebaseDb, "cowork_duty_status", employeeId),
        (snap) => {
          if (!snap.exists()) { setMode("offline"); return; }
          const d = snap.data();
          setMode(d.mode || (d.isOnline ? "online" : "offline"));
        },
        (e) => console.error("[useDutyStatus] snapshot:", e.message)
      );
    })();
    return () => unsub();
  }, [employeeId]);

  return mode;
}