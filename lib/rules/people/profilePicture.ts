/**
 * A person's profile picture.
 *
 * ## This is a port, not a new feature
 *
 * The old app already does all of this, and the values below are its values:
 * `app/coworking/settings/page.js` centre-crops the chosen file to a square,
 * downscales it to 160×160, encodes it as JPEG at quality 0.75, and writes the
 * resulting data URL to `cowork_employees/{employeeId}.profilePicUrl`. Its own
 * task list, assignee stacks and headers read that field today.
 *
 * Reproducing the numbers matters more than improving them: a picture set here
 * and a picture set there are the same field on the same document, and a
 * different output size would mean the same person's face arrives at two
 * different resolutions depending on which app they happened to use.
 *
 * ## Why the image lives IN the document
 *
 * There is no storage bucket in this deployment and no upload route on the
 * engine. A 160px JPEG at 0.75 is six to twelve kilobytes — small enough to sit
 * on the employee record, be read with the directory, and never need a second
 * fetch to draw an avatar. That is why the old app chose it, and it is the
 * reason not to introduce a bucket for one small square.
 *
 * The ceiling below is what keeps that true. Firestore refuses a document over
 * 1 MiB, and the directory read pulls EVERY employee — so an unbounded picture
 * would not merely bloat one record, it would slow every screen that draws a
 * name.
 */

/** What the file picker accepts, and what the refusal is measured against. */
export const ACCEPTED_TYPE_PREFIX = "image/";

/** Legacy's own cap on the file somebody chooses, before it is re-encoded. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

/** Legacy's output: a square this many pixels on each side. */
export const OUTPUT_SIZE_PX = 160;

/** Legacy's JPEG quality. */
export const OUTPUT_QUALITY = 0.75;

/**
 * The largest stored value this will write or trust.
 *
 * Twelve times what the encoder actually produces, so it can never refuse a
 * genuine picture — it exists to stop something that is not one. A value this
 * size would still leave a seventeen-person directory read under two megabytes.
 */
export const MAX_STORED_BYTES = 128 * 1024;

/**
 * Why this file cannot be used, or null.
 *
 * The two sentences are legacy's, verbatim. An article describing a refusal in
 * different words from the refusal itself is hard to match against the screen,
 * and both apps are showing the same person the same rule.
 */
export function pictureRefusal(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith(ACCEPTED_TYPE_PREFIX))
    return "Please select an image file.";
  if (file.size > MAX_SOURCE_BYTES) return "Image must be under 10MB.";
  /* An empty file passes both tests above and then fails to decode, which
     surfaces as the generic "could not be read". Named here instead, because
     "the file is empty" is something the person can act on. */
  if (file.size === 0) return "That file is empty.";
  return null;
}

/**
 * Is this a value we are willing to render?
 *
 * Data URLs are what this product writes. `https:` is accepted on READ and never
 * produced — so that if the picture ever does move to a bucket, the mapper and
 * every avatar already understand the new shape and only the writer changes.
 *
 * Everything else is refused, including `http:` (which would be a mixed-content
 * image on an https page) and `javascript:`.
 */
export function isRenderablePicture(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith("data:image/")) return byteLengthOfDataUrl(value) <= MAX_STORED_BYTES;
  return value.startsWith("https://");
}

/**
 * Roughly how many bytes a data URL occupies.
 *
 * Base64 carries three bytes in every four characters, and the payload is what
 * counts — the `data:image/jpeg;base64,` preamble is not stored twice. Rounded
 * rather than exact because it is compared against a ceiling, not billed.
 */
export function byteLengthOfDataUrl(value: string): number {
  const comma = value.indexOf(",");
  if (comma === -1) return value.length;
  const payload = value.length - comma - 1;
  return Math.ceil((payload * 3) / 4);
}

/**
 * Why this value cannot be stored, or null.
 *
 * Checked at the write as well as at the picker, because the picker is one
 * caller: the size that matters is the ENCODED one, and a picker cannot know it
 * until the canvas has run.
 */
export function storedPictureRefusal(value: string): string | null {
  if (!value.startsWith("data:image/"))
    return "A profile picture has to be an image.";
  if (byteLengthOfDataUrl(value) > MAX_STORED_BYTES)
    return "That picture is too large to store. Try a smaller one.";
  return null;
}

/**
 * Read a stored value, or null.
 *
 * Tolerant, because this comes back from Firestore untyped and because the old
 * app is writing the same field. Anything unrenderable reads as "no picture"
 * rather than as an error: a broken value should leave somebody with their
 * monogram, not with a broken screen.
 */
export function readProfilePicture(value: unknown): string | null {
  return isRenderablePicture(value) ? value : null;
}

/**
 * The initials a monogram falls back to.
 *
 * Legacy's rule: first letter of each word, at most two, uppercased, and a
 * question mark when there is no name at all — which happens for a person who
 * exists in the reporting tree but not in the directory.
 */
export function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/u)
    .map((word) => word[0])
    .filter((ch): ch is string => !!ch && /\p{L}|\p{N}/u.test(ch))
    .join("");
  return letters.slice(0, 2).toUpperCase() || "?";
}
