"use client";

import {
  draftKey,
  draftKeysIn,
  isDraftEmpty,
  parseDraft,
  serializeDraft,
  type ConversationDraft,
} from "@/lib/rules/messages/drafts";

/**
 * Where a per-conversation draft is kept, and the one rule about touching it.
 *
 * **Nothing here may throw.** Every function is called from a render path or a
 * composer keystroke, and `localStorage` throws for reasons that have nothing
 * to do with this application: private browsing, storage disabled by policy, a
 * full quota, a sandboxed frame. A draft is a convenience — losing one is a
 * small annoyance, and taking the conversation down with it is not.
 *
 * The shape rules live in `lib/rules/messages/drafts.ts`, which does no I/O and
 * is tested against strings. This file is only the seam to the browser.
 */

/** Read one conversation's draft. Null when there is none, or none usable. */
export function readDraft(conversationId: string): ConversationDraft | null {
  try {
    return parseDraft(window.localStorage.getItem(draftKey(conversationId)));
  } catch {
    return null;
  }
}

/**
 * Write one conversation's draft, or remove it once there is nothing left.
 *
 * **An empty draft deletes the key rather than storing emptiness.** Otherwise
 * every conversation anybody ever opened and typed one character into keeps a
 * record for ever, and clearing a composer would leave a stored draft claiming
 * otherwise.
 *
 * A failed write is swallowed on purpose. The most likely cause is a full
 * quota, and the state in the composer is still correct — the person keeps
 * their message for this session and loses only the ability to reload into it.
 */
export function saveDraft(
  conversationId: string,
  draft: ConversationDraft,
): void {
  try {
    const key = draftKey(conversationId);
    if (isDraftEmpty(draft)) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, serializeDraft(draft));
  } catch {
    /* Storage unavailable or full. The composer is unaffected. */
  }
}

/** Forget one conversation's draft — after it has actually been sent. */
export function clearDraft(conversationId: string): void {
  try {
    window.localStorage.removeItem(draftKey(conversationId));
  } catch {
    /* Nothing to do. The key is either gone or unreachable. */
  }
}

/**
 * Forget every draft in this browser.
 *
 * Called when a DIFFERENT person signs in. There is one key per conversation,
 * so there is no fixed list to remove — hence the prefix sweep, and hence the
 * prefix existing at all. Leaving them would put a colleague's half-written
 * message into the next person's composer, which is a disclosure rather than
 * an untidiness.
 *
 * The keys are collected before anything is removed: mutating storage while
 * iterating its index shifts the positions underneath the loop and silently
 * skips entries.
 */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key) keys.push(key);
    }
    for (const key of draftKeysIn(keys)) window.localStorage.removeItem(key);
  } catch {
    /* Storage unreachable. There is nothing readable to leak either. */
  }
}
