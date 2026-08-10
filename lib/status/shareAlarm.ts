/**
 * The sound that says a screen share has stopped without anybody meaning it to.
 *
 * **Synthesised, not a file.** Cowork ships no audio assets — the notification
 * sounds under `/sounds/` are referenced and were never added, so every one of
 * them already falls through to a Web Audio beep. A tone generated here needs
 * no request, works offline, and cannot 404 at the one moment it matters.
 *
 * Two descending notes rather than one. A single ping is the vocabulary of a
 * message arriving; this is a state that has gone wrong and the person is being
 * asked to act, so it should not sound like a new task.
 */

/** Kept so a second alert does not open a second audio context. */
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Play the alert. Never throws, and never blocks anything on its outcome.
 *
 * **It may not play at all, and that is expected.** A browser will not start
 * audio in a tab that has had no interaction since it loaded — which is exactly
 * the situation after a reload. So this is the second signal, not the first:
 * the dialog is what actually tells somebody, and a suspended context is
 * resumed on the next gesture the tab receives rather than treated as an error.
 */
export function soundShareLost(): void {
  const audio = context();
  if (!audio) return;
  /**
   * **A reloaded tab has had no gesture, so this is usually refused.**
   *
   * Browsers will not start audio in a page nobody has touched since it loaded,
   * which is precisely the situation this alert exists for. Asking to resume is
   * free and sometimes granted; when it is not, the tone is armed against the
   * next gesture the page receives — so somebody who goes back to scrolling
   * hears it a moment later rather than never.
   */
  void audio.resume?.().catch(() => {});
  if (audio.state === "suspended") {
    armOnNextGesture();
    return;
  }
  play(audio);
}

/**
 * Stop waiting for a gesture to play the tone.
 *
 * Called when the warning has been dealt with. A sound that arrived after
 * somebody had already read the message and acted on it would be startling and
 * would explain nothing.
 */
export function cancelShareLostSound(): void {
  disarm();
}

let armed: (() => void) | null = null;

function armOnNextGesture(): void {
  if (typeof window === "undefined" || armed) return;
  const onGesture = (event: Event) => {
    /**
     * **Not the dialog's own buttons.** `pointerdown` fires before `click`, so
     * dismissing the warning would otherwise ring the alarm about it on the way
     * out. Anything else — scrolling, a key, a click on the page behind — is
     * somebody carrying on with their work, which is exactly who this is for.
     */
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('[role="alertdialog"]') !== null
    )
      return;
    disarm();
    const audio = context();
    if (!audio) return;
    void audio.resume?.().catch(() => {});
    play(audio);
  };
  /* Bounded: an alert about a reload two minutes ago is no longer news. */
  const timer = window.setTimeout(disarm, 60_000);
  armed = () => {
    window.clearTimeout(timer);
    window.removeEventListener("pointerdown", onGesture, true);
    window.removeEventListener("keydown", onGesture, true);
    armed = null;
  };
  window.addEventListener("pointerdown", onGesture, true);
  window.addEventListener("keydown", onGesture, true);
}

function disarm(): void {
  armed?.();
}

function play(audio: AudioContext): void {
  try {
    const now = audio.currentTime;
    for (const [i, hz] of [660, 494].entries()) {
      const at = now + i * 0.22;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      osc.connect(gain);
      gain.connect(audio.destination);
      /* Ramped rather than switched: a square-edged start on a sine is a click,
         and a click is what a broken speaker sounds like. */
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      osc.start(at);
      osc.stop(at + 0.22);
    }
  } catch {
    /* Audio is a courtesy. Nothing about presence depends on it. */
  }
}
