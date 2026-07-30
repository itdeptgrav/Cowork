"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { GuideStep, HelpGuide } from "@/lib/help/types";

/**
 * The walkthrough engine.
 *
 * One engine, no per-guide code. A new walkthrough is configuration — a target,
 * a message, the page it happens on, the capability it needs — and everything
 * below applies to it unchanged: finding the element, navigating to its page,
 * scrolling, spotlighting, placing the tooltip so it never covers the thing it
 * is pointing at, and saying something useful when the control genuinely is not
 * there.
 *
 * It points; it never touches. There is no click, no focus steal, no form fill.
 * A help feature that operates the product on your behalf has stopped
 * explaining and started acting.
 *
 * Elements are found by `data-help`, never by CSS selector or DOM path. A class
 * name is a styling decision that moves when the design does; a help target is
 * a contract that says "this control is the one the step means".
 */

type Placement = "top" | "bottom" | "left" | "right";

interface Anchor {
  rect: DOMRect;
  placement: Placement;
}

const TOOLTIP_W = 340;
const TOOLTIP_H = 190;
const GAP = 14;
const PAD = 8;

/**
 * Choose a side with room, preferring below.
 *
 * The rule that matters: the tooltip must never cover the element it points at.
 * The previous version pinned itself to the bottom of the screen, so for a
 * control near the bottom it sat on top of the very thing the reader was being
 * told to click.
 */
function place(rect: DOMRect): Placement {
  const { innerWidth: w, innerHeight: h } = window;
  if (h - rect.bottom > TOOLTIP_H + GAP) return "bottom";
  if (rect.top > TOOLTIP_H + GAP) return "top";
  if (w - rect.right > TOOLTIP_W + GAP) return "right";
  if (rect.left > TOOLTIP_W + GAP) return "left";
  return rect.top > h / 2 ? "top" : "bottom";
}

/** Sub-pixel-tolerant rect comparison. See `measure` for why it exists. */
function sameRect(a: DOMRect, b: DOMRect): boolean {
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function tooltipStyle(a: Anchor | null): React.CSSProperties {
  const width = `min(${TOOLTIP_W}px, calc(100vw - 24px))`;
  if (!a) {
    return {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width,
    };
  }
  const { rect, placement } = a;
  const w = window.innerWidth;
  const clampX = (x: number) => Math.max(12, Math.min(x, w - TOOLTIP_W - 12));

  switch (placement) {
    case "bottom":
      return {
        left: clampX(rect.left + rect.width / 2 - TOOLTIP_W / 2),
        top: rect.bottom + GAP,
        width,
      };
    case "top":
      return {
        left: clampX(rect.left + rect.width / 2 - TOOLTIP_W / 2),
        bottom: window.innerHeight - rect.top + GAP,
        width,
      };
    case "right":
      return { left: rect.right + GAP, top: Math.max(12, rect.top), width };
    case "left":
      return {
        right: w - rect.left + GAP,
        top: Math.max(12, rect.top),
        width,
      };
  }
}

export function GuidedTour({
  guide,
  onClose,
}: {
  guide: HelpGuide;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  /* Distinguishes "we have not looked yet" from "we looked and it is absent".
     Without it every step flashes its missing-state message for a frame. */
  const [searching, setSearching] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const step: GuideStep | undefined = guide.steps[index];
  const last = index === guide.steps.length - 1;

  /** The page this step needs, carried from the last step that named one. */
  let requiredPage = guide.startAt;
  for (let i = index; i >= 0; i--) {
    const p = guide.steps[i]?.page;
    if (p) {
      requiredPage = p;
      break;
    }
  }

  const onWrongPage =
    !!requiredPage && !pathname?.startsWith(requiredPage.split("?")[0]);

  /* Navigate for the reader rather than asking them to. A walkthrough that
     stops to say "go to Tasks yourself" has failed at the one thing it is for.
     This is the only navigation the assistant performs, it is always to a page
     the step itself declares, and it never submits anything. */
  useEffect(() => {
    if (step && onWrongPage && requiredPage) router.push(requiredPage);
  }, [step, onWrongPage, requiredPage, router]);

  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector<HTMLElement>(
      `[data-help="${step.target}"]`,
    );
    if (!el) {
      setAnchor(null);
      setSearching(false);
      return;
    }
    const rect = el.getBoundingClientRect();
    setAnchor((prev) => {
      /* Bail out when nothing has actually moved. This is not an optimisation:
         measurement is driven by a MutationObserver, so a new object here would
         re-render, the re-render would mutate the DOM, the mutation would
         measure again, and the tour would spin at frame rate forever. Returning
         `prev` unchanged is what stops that loop. */
      if (prev && sameRect(prev.rect, rect)) return prev;
      /* Keep the previous side unless the target has genuinely moved. A
         placement recomputed on every scroll frame makes the tooltip flip
         sides mid-scroll, which is the "jumping randomly" complaint. */
      const moved =
        !prev ||
        Math.abs(prev.rect.top - rect.top) > 24 ||
        Math.abs(prev.rect.left - rect.left) > 24;
      return { rect, placement: moved ? place(rect) : prev.placement };
    });
    setSearching(false);
  }, [step]);

  /* Track the target for as long as the step lasts.
   *
   * Two things move a highlighted control, and they need different answers. It
   * may not exist yet, because the step before this one navigated and the page
   * is still rendering — that is what the fast poll is for. Or it may exist and
   * then move, because a list finished loading, a panel opened, or a validation
   * message pushed the form down — and that can happen at any point, not only
   * in the first two seconds.
   *
   * An earlier version stopped measuring after twenty tries and then listened
   * only for scroll and resize. Anything that reflowed the page without either
   * left the spotlight sitting over blank space while the tooltip talked about
   * a control somewhere else. So measurement now runs for the whole step, off
   * every source that can move something: mutations, body resize, scroll, and a
   * slow keep-alive for whatever those three miss.
   *
   * Every source funnels through one animation frame, and `measure` returns the
   * previous anchor unchanged when nothing moved. Both matter — without them a
   * MutationObserver that re-renders on every mutation is a spin loop. */
  useEffect(() => {
    if (!step) return;
    /* Deferred a microtask rather than set in the effect body: this
       synchronises React to the DOM, and doing it synchronously cascades a
       render — the same shape the presence bridge and profile switcher use. */
    queueMicrotask(() => setSearching(true));

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    /* Fast while the page is still arriving, slow once it has. The step reports
       the control as missing after two seconds — see the tooltip — but keeps
       looking, so a control that arrives late still gets highlighted instead of
       stranding the reader on a dead step. */
    let tries = 0;
    let poll = window.setInterval(function fast() {
      schedule();
      if (++tries === 20) {
        window.clearInterval(poll);
        poll = window.setInterval(schedule, 500);
      }
    }, 100);

    /* Structure only. Watching attributes as well would fire this callback on
       essentially every React render — every class toggle, every aria update —
       to catch the rarer case of a target moved by a style change alone. The
       keep-alive below already catches that within half a second, which is not
       worth a per-render observer callback on the whole document. */
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });
    const resizes = new ResizeObserver(schedule);
    resizes.observe(document.body);

    /* First read deferred for the same reason as the flag above — the poll
       keeps trying, so nothing is lost by not measuring inside the body. */
    queueMicrotask(measure);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      window.clearInterval(poll);
      if (frame) window.cancelAnimationFrame(frame);
      mutations.disconnect();
      resizes.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [step, measure, pathname]);

  /* Watch for the reader doing the thing.
   *
   * Listeners are attached to the ELEMENT, not to the document, so a click
   * elsewhere cannot advance the tour by accident. `capture` is used because a
   * control that stops propagation — and several do — would otherwise never
   * report the click that its own step is waiting for.
   *
   * Nothing here calls the control. The tour observes; the reader acts. */
  const action = step?.awaitAction ?? "none";
  useEffect(() => {
    if (!step || action === "none" || action === "navigate") return;

    let advanceTimer = 0;
    const advance = () => {
      /* A short beat before moving on: advancing in the same tick as the click
         swaps the panel out from under the reader's cursor and reads as a
         glitch rather than as progress. */
      window.clearTimeout(advanceTimer);
      advanceTimer = window.setTimeout(
        () => setIndex((i) => Math.min(i + 1, guide.steps.length - 1)),
        420,
      );
    };

    if (action === "appears" && step.awaitTarget) {
      const id = window.setInterval(() => {
        if (document.querySelector(`[data-help="${step.awaitTarget}"]`)) {
          window.clearInterval(id);
          advance();
        }
      }, 200);
      return () => {
        window.clearInterval(id);
        window.clearTimeout(advanceTimer);
      };
    }

    /* Attaching once and giving up is wrong here, and it fails in the most
       common case there is: the previous step navigated, so at the moment this
       effect runs the field does not exist yet. The reader then types into the
       field the tour just asked them to fill and nothing happens — which is
       exactly the "it made me press Next anyway" behaviour interactivity was
       supposed to remove.

       So it waits for the element, and keeps watching after it has one: React
       can replace the node on re-render, and a listener on a detached node is a
       listener on nothing. */
    let attached: HTMLElement | null = null;
    let timer = 0;
    const evt = action === "click" ? "click" : action;
    const onEvent =
      action === "click"
        ? advance
        : () => {
            /* Debounced: advancing on the first keystroke would move on before
               the reader has finished the thing the step asked them to do. */
            window.clearTimeout(timer);
            timer = window.setTimeout(advance, 900);
          };

    const detach = () => {
      attached?.removeEventListener(evt, onEvent, { capture: true });
      attached = null;
    };

    const sync = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-help="${step.target}"]`,
      );
      if (el === attached && (!attached || attached.isConnected)) return;
      detach();
      if (!el) return;
      /* `capture` because a control that stops propagation — and several do —
         would otherwise never report the event its own step is waiting for.
         Scoped to the ELEMENT, never the document, so activity elsewhere on the
         page cannot advance the tour by accident. */
      el.addEventListener(evt, onEvent, { capture: true });
      attached = el;
    };

    sync();
    const watch = window.setInterval(sync, 200);
    return () => {
      window.clearInterval(watch);
      window.clearTimeout(timer);
      window.clearTimeout(advanceTimer);
      detach();
    };
  }, [step, action, guide.steps.length, pathname]);

  /* `navigate` completes when the route actually changes. Held in a ref so the
     effect compares against where the step STARTED rather than re-firing on
     every render. */
  const startedOn = useRef<string | null>(null);
  useEffect(() => {
    /* Deliberately keyed on the STEP, not on the route: this records where the
       step began so the navigate check has something to compare against. Adding
       `pathname` would reset the baseline on the very change it is watching
       for, and the step would never complete. */
    startedOn.current = pathname ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  useEffect(() => {
    if (action !== "navigate") return;
    if (startedOn.current && pathname && pathname !== startedOn.current) {
      setIndex((i) => Math.min(i + 1, guide.steps.length - 1));
    }
  }, [pathname, action, guide.steps.length]);

  /* Scroll to the target once per step, when it is first found.
   *
   * The previous version keyed this on the anchor's top edge — the exact value
   * scrolling changes. Every scroll re-measured, the new top re-ran the effect,
   * and the effect scrolled again: a reader who tried to look anywhere else got
   * dragged back. Keying on the step index and latching it means the tour puts
   * the control on screen and then leaves the reader alone. */
  const found = anchor !== null;
  const scrolledFor = useRef(-1);
  useEffect(() => {
    if (!step || !found || scrolledFor.current === index) return;
    scrolledFor.current = index;
    document
      .querySelector<HTMLElement>(`[data-help="${step.target}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [step, index, found]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && !last) setIndex((i) => i + 1);
      if (e.key === "ArrowLeft" && index > 0) setIndex((i) => i - 1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, last, index]);

  if (!step) return null;

  const missing = !anchor && !searching && !onWrongPage;

  return (
    <div className="pointer-events-none fixed inset-0 z-[80]">
      {/* One element does both jobs: the ring marks the target, and its
          enormous spread shadow dims everything else — so the dimmed layer can
          never drift out of alignment with the hole in it. */}
      {anchor && (
        <span
          aria-hidden="true"
          /* `pointer-events-none` on the ring AND on the root: the spotlight
             sits over the control it marks, and a reader told to click
             something must actually be able to click it. */
          className="help-spotlight pointer-events-none absolute rounded-inset transition-all duration-300 ease-[var(--ease-out-expo)]"
          style={{
            left: anchor.rect.left - PAD,
            top: anchor.rect.top - PAD,
            width: anchor.rect.width + PAD * 2,
            height: anchor.rect.height + PAD * 2,
          }}
        />
      )}

      {!anchor && (
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background: "color-mix(in srgb, var(--body-bg) 62%, transparent)",
          }}
        />
      )}

      <div
        role="dialog"
        aria-label={`Step ${index + 1} of ${guide.steps.length}`}
        aria-live="polite"
        className="frost-bar pointer-events-auto absolute rounded-panel border border-hairline p-4 shadow-[var(--deck-seat)]"
        style={tooltipStyle(anchor)}
      >
        <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          Step <span data-figure>{index + 1}</span> of{" "}
          <span data-figure>{guide.steps.length}</span>
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink">
          {step.message}
        </p>

        {onWrongPage && (
          <p className="mt-2 text-[11px] text-ink-faint">Taking you there…</p>
        )}

        {missing && (
          /* Not every control exists all the time — an Approve button needs
             something awaiting approval. Saying so beats highlighting a
             disabled control or an empty list, both of which read as broken. */
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            That control isn&rsquo;t on this screen right now — there may be
            nothing for it to act on yet. The explanation covers how it works.
          </p>
        )}

        <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setIndex((i) => i - 1)}
            className="rounded-full px-3 py-1.5 text-[11px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => (last ? onClose() : setIndex((i) => i + 1))}
            className="rounded-full bg-ink px-3 py-1.5 text-[11px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
          >
            {last ? "Done" : "Next"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-full px-2.5 py-1.5 text-[11px] text-ink-faint transition-colors hover:text-ink"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
