"use client";

import { useState } from "react";
import { ImageLightbox } from "./ImageLightbox";

/**
 * Avatars: a monogram by default, a photograph when the person supplied one.
 *
 * **This header used to say the build ships no photography.** That reasoning was
 * sound and is now only half true, so it is restated rather than deleted: the
 * seeded people are invented, and inventing faces for them would present
 * synthetic material as genuine — so the fixture seeds `null` and every demo
 * avatar is still a monogram. Real employees on the engine are a different
 * matter. They have had photographs on `cowork_employees.profilePicUrl` for
 * years, the old application has always drawn them, and this one was discarding
 * the value at the mapper.
 *
 * So: **nothing here generates a face.** A photograph appears only where a real
 * person put one, and the monogram is both the default and the fallback. Hues
 * come from the field palette so identity varies without introducing new colour.
 *
 * A picture that fails to load falls back to the monogram rather than to a
 * broken-image box — and the failed source is remembered rather than a boolean
 * flag, so a person who replaces a broken picture sees the new one immediately
 * instead of staying broken until the page reloads.
 */

/* Field hues, but none darker than ~#93a5bd: the monogram is real text, and the
   original slate pair bottomed out at #5f7794 where black/70 fell to 3.65:1. */
const fieldHues = [
  ["#f2e6d2", "#dcc9ab"],
  ["#e6c79c", "#d6ac7e"],
  ["#d9a4b0", "#c78e9c"],
  ["#c0abd1", "#a690bd"],
  ["#9fb2cb", "#93a5bd"],
  ["#b4bbad", "#9aa393"],
] as const;

const sizes = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-10 w-10 text-xs",
  lg: "h-14 w-14 text-sm",
} as const;

interface AvatarProps {
  initials: string;
  hue: 0 | 1 | 2 | 3 | 4 | 5;
  size?: keyof typeof sizes;
  name?: string;
  className?: string;
  /**
   * Their picture, if they set one. Optional, so no call site is obliged to
   * have a person record — a mail sender is an address, not an employee, and
   * those surfaces keep their monogram honestly.
   */
  src?: string | null;
}

export function Avatar({
  initials,
  hue,
  size = "md",
  name,
  className = "",
  src,
}: AvatarProps) {
  const [from, to] = fieldHues[hue];
  /* The source that FAILED, not a boolean. A person who replaces a broken
     picture would otherwise keep their monogram until the page reloaded. */
  const [failed, setFailed] = useState<string | null>(null);
  const photo = src && src !== failed ? src : null;

  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-medium tracking-tight text-black/85 ring-1 ring-white/40 ${sizes[size]} ${className}`}
      /* The gradient stays behind the photograph, so a data URL that has not
         decoded yet is a monogram-coloured disc rather than a white hole. */
      style={{ background: `linear-gradient(148deg, ${from}, ${to})` }}
      role="img"
      aria-label={name ? `${name} avatar` : undefined}
      aria-hidden={name ? undefined : true}
    >
      {initials}
      {photo && (
        /* A raw `img`: the src is a `data:` URL, which `next/image` cannot
           optimise and would only add a proxy hop to. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          onError={() => setFailed(photo)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}

interface AvatarStackProps {
  people: {
    initials: string;
    hue: 0 | 1 | 2 | 3 | 4 | 5;
    name: string;
    src?: string | null;
  }[];
  overflow?: number;
}

export function AvatarStack({ people, overflow = 0 }: AvatarStackProps) {
  return (
    <div className="flex items-center">
      {people.map((p) => (
        <Avatar
          key={p.name}
          initials={p.initials}
          hue={p.hue}
          name={p.name}
          src={p.src}
          size="sm"
          className="-ml-2 ring-2 ring-white/55 first:ml-0"
        />
      ))}
      {overflow > 0 && (
        <span className="-ml-2 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/[0.09] text-[11px] font-medium text-ink-muted ring-2 ring-white/55">
          +{overflow}
        </span>
      )}
    </div>
  );
}

/**
 * An avatar you can click to see the photograph full size.
 *
 * **Only when there is a photograph.** Somebody showing a monogram has nothing
 * to enlarge, and a button that opens a black screen with two letters on it is
 * worse than no button — so with no `src` this renders exactly what `Avatar`
 * renders, no button, no pointer, no hover state. The affordance appears only
 * where it leads somewhere, which is why a caller can use this unconditionally
 * without checking first.
 *
 * No download control. See the note on `ImageLightbox`'s `downloadUrl`: a face
 * is shown so you know who you are talking to, not handed over as a file.
 */
export function ZoomableAvatar({
  zoomLabel,
  ...props
}: AvatarProps & {
  /** Whose picture this is, for the button and the dialog. */
  zoomLabel?: string;
}) {
  const [zoomed, setZoomed] = useState(false);
  const who = zoomLabel ?? props.name ?? "this person";

  if (!props.src) return <Avatar {...props} />;

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        aria-label={`View ${who}'s profile picture`}
        title={`View ${who}'s profile picture`}
        className="shrink-0 cursor-zoom-in rounded-full transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]"
      >
        <Avatar {...props} />
      </button>
      {zoomed && (
        <ImageLightbox
          url={props.src}
          alt={`${who}'s profile picture`}
          onClose={() => setZoomed(false)}
        />
      )}
    </>
  );
}
