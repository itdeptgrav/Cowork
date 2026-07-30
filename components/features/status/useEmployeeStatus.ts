"use client";

import { useSyncExternalStore } from "react";
import {
  getServerSnapshot,
  getSnapshot,
  subscribe,
  type EmployeeStatusState,
} from "@/lib/status/employeeStatus";

/**
 * Read the current presence.
 *
 * `useSyncExternalStore` rather than context because the writer sits below the
 * reader in the tree — see the note in `lib/status/employeeStatus.ts`. It also
 * means only the components that actually display presence re-render when it
 * changes, which matters when the thing writing is a room event.
 */
export function useEmployeeStatus(): EmployeeStatusState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
