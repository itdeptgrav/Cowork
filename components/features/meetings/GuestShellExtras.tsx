"use client";

import { MeetingEngine } from "./MeetingEngine";
import { MeetingReloadGuard } from "./MeetingReloadGuard";

/**
 * The meeting engine for the shell a guest gets.
 *
 * `WorkspaceShell` mounts `MeetingEngine` for everybody who is signed in, and
 * a guest never sees that shell — so the guest room used to live inside its
 * page and end with it. Mounting the engine here, on the public branch of
 * `ShellFrame`, gives a guest the same room the workspace has: held above the
 * router, docked over the guest page while they are on it, floating and
 * draggable when they are not, and a real picture-in-picture window where the
 * browser has one.
 *
 * Loaded through `next/dynamic` by `ShellFrame` for the same reason
 * `WorkspaceShell` is: the sign-in page shares that branch and must not
 * download LiveKit to show a password field. Only a public route mounts this.
 *
 * `MeetingReloadGuard` comes with it because a guest can lose a meeting to a
 * reload exactly as an employee can, and the recorder's own guard speaks only
 * while a recording is running.
 */
export function GuestShellExtras() {
  return (
    <>
      <MeetingEngine />
      <MeetingReloadGuard />
    </>
  );
}
