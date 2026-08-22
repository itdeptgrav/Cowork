"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { opensSupport } from "@/lib/rules/support/shortcut";
import { SupportPanel } from "./SupportPanel";

/**
 * Ctrl+S, anywhere in Cowork, opens Support.
 *
 * Mounted by `ShellFrame` on BOTH of its branches — the bare shell the auth
 * routes get and the workspace shell — so the shortcut answers before anybody
 * has signed in, which is the case it exists for, and afterwards on every
 * page. It is a sibling of the workspace shell rather than a child, so it also
 * answers while the shell is still resolving a session: "Signing you in…" and
 * the stalled screen are exactly when somebody needs support and exactly when
 * no page is mounted to offer it.
 *
 * ## The key is not ours to take unconditionally
 *
 * The browser reads Ctrl+S as "save this page", and Cowork's own document
 * editor and collaborative sheet read it as "save my work" — both bind it
 * deliberately. `opensSupport` holds the stand-down list, and this listener
 * asks it before doing anything: on `/workspace` the keystroke is left alone
 * and reaches the editor that owns it.
 *
 * Everywhere else the default IS prevented, and that is a small improvement on
 * its own: the browser's "Save page as…" dialog over a workspace is a
 * confusing answer to a keystroke nobody meant as an export.
 *
 * The listener is registered in the CAPTURE phase so it sees the keystroke
 * before a page-level handler can stop it — a dialog that swallows keys would
 * otherwise make support unreachable from the one screen somebody is stuck on.
 */
export function SupportShortcut() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      /* Held keys repeat; one press is one panel. */
      if (e.repeat) return;
      if (!opensSupport(e, pathname)) return;
      e.preventDefault();
      /* Already open is already the answer — reopening would throw away a
         half-written sentence by restarting the panel's entrance. */
      setOpen((was) => was || true);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pathname]);

  return (
    <SupportPanel
      open={open}
      onClose={() => setOpen(false)}
      fromPath={pathname}
    />
  );
}
