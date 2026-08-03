/**
 * Turning a mouse wheel into horizontal movement on a scroll rail.
 *
 * ## The defect this exists for
 *
 * A `.rail` — the tab strips, and the top bar's nav list — scrolls on one axis
 * only. A trackpad reaches it: a two-finger horizontal swipe emits `deltaX` and
 * the browser applies it. **A wheel mouse never does.** It emits `deltaY` and
 * nothing else, and a browser will not spend a vertical delta on a horizontally
 * scrolling box. So the rail was reachable on a laptop and unreachable on a
 * desk, with no cue that the tabs continued at all (`.rail` hides its
 * scrollbar).
 *
 * Shift+wheel has always worked. It is not a discoverable answer to "the tabs
 * are cut off".
 *
 * ## The rule the arithmetic has to get right
 *
 * Redirecting the wheel means taking the gesture away from the page, and the
 * top bar is `sticky` — the pointer sits over it for the whole of a normal
 * read. So the redirect is **conditional on the rail still having somewhere to
 * go in that direction**: at either end the event is left alone and the page
 * scrolls as it always did. Hovering a rail must never trap the page.
 *
 * Nothing here touches the DOM or an event. The caller measures and applies;
 * this decides. Same shape as `dragReorder.ts`.
 */

export interface WheelInput {
  /** `WheelEvent.deltaX`. */
  deltaX: number;
  /** `WheelEvent.deltaY`. */
  deltaY: number;
  /** `WheelEvent.deltaMode` — 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  /** `element.scrollLeft`, which may be negative in a right-to-left rail. */
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

export interface WheelPan {
  /** Pixels to add to `scrollLeft`. `0` means do nothing at all. */
  delta: number;
  /**
   * Whether the caller should call `preventDefault()`.
   *
   * Always false when `delta` is 0, so the two can never disagree — a
   * prevented event that scrolls nothing is a dead gesture, and the page under
   * it stops moving for no visible reason.
   */
  preventDefault: boolean;
}

const NOTHING: WheelPan = { delta: 0, preventDefault: false };

/**
 * A line and a page in pixels.
 *
 * Firefox on Windows reports `deltaMode: 1` (lines) and some configurations
 * report pages. Reading `deltaY` as pixels regardless makes one notch of the
 * same wheel move three pixels in one browser and a hundred in another.
 */
const LINE_PX = 16;

function toPixels(delta: number, deltaMode: number, clientWidth: number): number {
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * clientWidth;
  return delta;
}

/**
 * How far this wheel event should pan the rail, and whether it belongs to the
 * rail at all.
 *
 * Returns `NOTHING` — leave the event alone — in four cases, each of which is a
 * real gesture somebody makes:
 *
 * 1. **The rail does not overflow.** Everything fits; there is nothing to pan.
 *    This is the common case at a wide window and it must cost nothing.
 * 2. **The gesture is already horizontal** (`|deltaX| > |deltaY|`). That is the
 *    trackpad, which the browser handles correctly. Adding our own delta on top
 *    of the native one scrolls twice as far as the fingers moved.
 * 3. **The rail is at the end the gesture points at.** The page takes it, which
 *    is what stops a sticky bar from swallowing the scroll of the page beneath.
 * 4. **The delta rounds to nothing.** A sub-pixel tick is not a scroll.
 */
export function wheelPan(input: WheelInput): WheelPan {
  const { deltaX, deltaY, deltaMode, scrollLeft, scrollWidth, clientWidth } = input;

  const overflow = scrollWidth - clientWidth;
  if (overflow <= 0) return NOTHING;

  /* The trackpad's own axis wins. `>=` rather than `>` on purpose: a purely
     vertical gesture has deltaX 0, so the only thing an equal pair can be is a
     diagonal trackpad swipe, and the browser is already handling its horizontal
     half. */
  if (Math.abs(deltaX) >= Math.abs(deltaY) && deltaX !== 0) return NOTHING;
  if (deltaY === 0) return NOTHING;

  const wanted = toPixels(deltaY, deltaMode, clientWidth);

  /* Clamp against the travel that is actually left, so the last notch before
     the end moves the rail exactly to the end rather than being discarded for
     overshooting. */
  const room = wanted > 0 ? overflow - scrollLeft : -scrollLeft;
  const delta = wanted > 0 ? Math.min(wanted, room) : Math.max(wanted, room);

  if (Math.abs(delta) < 1) return NOTHING;
  return { delta, preventDefault: true };
}
