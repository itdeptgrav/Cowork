/**
 * A short tone for a score change — generated, so there are no audio files to
 * ship or 404.
 *
 * A cut FALLS (bright to dark), a credit RISES (dark to bright), so the two are
 * told apart with the ears shut. Kept quiet and brief; it is a grace note on the
 * popup, never the thing that carries the message.
 *
 * **Browsers gate audio behind a user gesture.** Played on page load, before
 * any click, it may be suppressed by the autoplay policy and simply stay silent
 * — the popup and toast still do the work. Everything is wrapped so a blocked or
 * unsupported context never throws.
 */
export function playPtsSound(kind: "debit" | "credit"): void {
  try {
    if (typeof window === "undefined") return;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";

    if (kind === "debit") {
      osc.frequency.setValueAtTime(494, now);
      osc.frequency.exponentialRampToValueAtTime(233, now + 0.34);
    } else {
      osc.frequency.setValueAtTime(392, now);
      osc.frequency.exponentialRampToValueAtTime(784, now + 0.28);
    }

    /* A soft attack and a tail, so it is a chime rather than a click. */
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

    osc.start(now);
    osc.stop(now + 0.55);
    osc.onended = () => {
      try {
        void ctx.close();
      } catch {
        /* already closed */
      }
    };
  } catch {
    /* A sound is a nicety; never let it break the notice. */
  }
}
