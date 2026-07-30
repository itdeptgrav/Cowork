/**
 * The session cookie's name, in a module with NO imports.
 *
 * That emptiness is the point. The Edge proxy needs this name, and importing it
 * from `lib/server/session.ts` dragged `node:crypto`, `next/headers` and the
 * filesystem-backed store into the Edge bundle — none of which exist there, so
 * the build failed. A bare constant has nothing to drag.
 */
export const SESSION_COOKIE = "cowork_session";
