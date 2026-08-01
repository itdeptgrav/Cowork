"use client";

import { useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { InlineError } from "@/components/ui/Primitives";
import { useAction } from "@/lib/hooks/useRepository";
import { encodeProfilePicture } from "@/lib/people/encodeProfilePicture";
import type { Employee } from "@/lib/domain";

/**
 * Change your own picture, from your own face.
 *
 * ## Why it is the avatar and not a panel
 *
 * The picture is the thing being edited and it is already on screen at the
 * app's largest size. Somebody looking for "change my photo" looks at their
 * photo. A "Profile picture" row in a settings list would be a second place to
 * represent something that is already represented.
 *
 * ## The optimistic preview is the encoded image, not the file
 *
 * What appears the instant a file is chosen is the 160px JPEG this product will
 * actually store — not a blob URL of the original. So the crop, the downscale
 * and the quality are all visible BEFORE the save lands, and a picture that
 * looks right in the preview cannot look different once saved. If the write
 * then fails, the preview is dropped and the reason is shown; nothing is left
 * on screen that is not in the database.
 *
 * ## It is a real control for a keyboard
 *
 * A `label` wrapping a visually-hidden file input, rather than a div with a
 * click handler — so it is focusable, reachable by Tab, and activated by Enter
 * or Space with no key handling written here.
 */
export function ProfilePicture({
  person,
  onChanged,
}: {
  person: Employee;
  onChanged?: () => void;
}) {
  /* The encoded image awaiting a result, or null. Cleared on both outcomes —
     on success the person record carries it, on failure nothing should. */
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const [save, saveState] = useAction((r, dataUrl: string | null) =>
    r.setMyProfilePicture(dataUrl),
  );

  const shown = preview ?? person.profilePictureUrl;
  const busy = saveState.isPending;

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    let encoded: string;
    try {
      encoded = await encodeProfilePicture(file);
    } catch (e) {
      /* The refusals are the rule module's words, which are legacy's words —
         shown exactly as they are so the article describing them matches the
         screen. */
      setError(e instanceof Error ? e.message : "That image could not be read.");
      return;
    }
    setPreview(encoded);
    const result = await save(encoded);
    setPreview(null);
    if (result.ok) onChanged?.();
    else setError(result.message);
  }

  async function remove() {
    setError(null);
    const result = await save(null);
    if (result.ok) onChanged?.();
    else setError(result.message);
  }

  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center gap-1.5">
        <label
          className={`group relative cursor-pointer rounded-full ${
            busy ? "pointer-events-none" : ""
          }`}
          title={shown ? "Change your profile picture" : "Add a profile picture"}
        >
          <Avatar
            initials={person.initials}
            hue={person.hue}
            name={person.displayName}
            size="lg"
            src={shown}
          />
          {/* The affordance. Always present for a keyboard via focus-within, and
              on hover for a pointer — an avatar that only reveals it on hover is
              a control nobody using a keyboard can find. */}
          <span
            aria-hidden
            className={`absolute inset-0 grid place-items-center rounded-full bg-black/55 text-[10px] font-medium tracking-[0.06em] text-white uppercase transition-opacity ${
              busy
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            }`}
          >
            {busy ? "Saving" : shown ? "Change" : "Add"}
          </span>
          <input
            ref={input}
            type="file"
            accept="image/*"
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              /* Cleared, or choosing the same file twice after a failure fires
                 no change event and the control looks dead. */
              if (input.current) input.current.value = "";
            }}
          />
          <span className="sr-only">
            {shown ? "Change your profile picture" : "Add a profile picture"}
          </span>
        </label>

        {person.profilePictureUrl && !busy && (
          <button
            type="button"
            onClick={() => void remove()}
            className="rounded-inset px-1.5 py-0.5 text-[11px] text-ink-faint hover:bg-[var(--control)] hover:text-ink"
          >
            Remove
          </button>
        )}
      </div>

      {error && (
        <div className="max-w-[260px] pt-1">
          <InlineError compact message={error} />
        </div>
      )}
    </div>
  );
}
