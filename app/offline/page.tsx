import type { Metadata } from "next";

/**
 * What somebody sees when a navigation fails with no network.
 *
 * Served by the service worker from its precache, so it has to be genuinely
 * self-contained: no session, no repository read, no query. Anything that
 * fetched would fail for exactly the reason this page is being shown.
 *
 * It is deliberately a real page rather than the browser's own error, because
 * the browser's says nothing about the thing people actually worry about —
 * whether the work they just did was saved. The answer is in the copy.
 */

export const metadata: Metadata = {
  title: "Offline — Cowork",
  description: "Cowork is not reachable right now.",
};

/* Static. It must be renderable without a request context, or the worker would
   have nothing to precache. */
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-[46ch] text-center">
        <p className="text-2xl font-light tracking-tight text-ink">
          You are offline
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Cowork cannot reach the network from this device. This is about the
          connection, not your account.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          <strong className="font-medium text-ink">
            Anything you had already saved is safe.
          </strong>{" "}
          Work is written as you go, so a task you submitted, a message you
          sent or a timer you stopped reached the server before this happened.
          Anything still open on screen when the connection dropped was not
          sent, and will need doing again.
        </p>
        <p className="mt-6 text-xs text-ink-faint">
          This page will keep working without a connection. Reload once you are
          back online.
        </p>
        {/*
          A plain anchor, not a router link and not an onClick handler.
          The offline page is served by the service worker as a static
          document; there is no React router mounted around it and no
          JavaScript is guaranteed to have loaded, so navigation has to be
          something the browser can do on its own.
        */}
        <a
          href="/home"
          className="mt-6 inline-block rounded-full bg-ink px-4 py-2 text-xs font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
        >
          Try again
        </a>
      </div>
    </main>
  );
}
