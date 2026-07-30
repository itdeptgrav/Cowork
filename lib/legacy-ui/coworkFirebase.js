"use client";

/**
 * Compatibility shim for hooks copied from `cowork-old-frontend`.
 *
 * Those hooks import `{ firebaseDb }` from `lib/coworkFirebase`. Rather than
 * edit the body of every copied file — the one change a behavioural re-skin
 * cannot afford — this exposes the same names, backed by **this project's**
 * Firebase app.
 *
 * One app, not two. Porting the old module verbatim would create a second
 * Firebase app on the same project, and two apps mean two auth states: a token
 * refreshed on one leaves the other holding a stale one, and the symptom is an
 * intermittent sign-out nobody can reproduce.
 */
import { legacyFirebase } from "../legacy/firebase";

export const firebaseAuth = legacyFirebase().auth;
export const firebaseDb = legacyFirebase().db;
