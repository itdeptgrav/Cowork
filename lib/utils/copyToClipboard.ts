import { driveImageSources } from "@/lib/rules/media/driveUrls";
import type { CopyPlan } from "@/lib/rules/media/copyMessage";

/**
 * Put a message's caption AND its picture on the clipboard in one write.
 *
 * The I/O half of `lib/rules/media/copyMessage.ts`: that module decides what
 * should be copied, this one fetches the bytes and hands them to the platform.
 * The split is the usual one — the decision is pure and tested directly, the
 * network and the clipboard live out here where they can be stubbed.
 *
 * ## Both representations, one item
 *
 * `ClipboardItem` maps a MIME type to bytes, and the paste target picks the one
 * it understands. A document gets the picture, a plain-text box gets the
 * caption, and neither had to know which the person meant. Writing two separate
 * items instead is supported almost nowhere, and writing the image first and
 * the text second simply loses the first.
 *
 * ## Why the blobs are passed as promises
 *
 * Safari requires the `ClipboardItem` to be constructed inside the user gesture
 * that triggered it — awaiting a fetch first and constructing afterwards is
 * refused as "not a user gesture". `ClipboardItem` accepts a `Promise<Blob>`
 * for exactly this: the item is built synchronously and the bytes arrive later.
 */

/** PNG, because it is the one raster type every clipboard implementation takes. */
const CLIPBOARD_IMAGE_TYPE = "image/png";

/**
 * Where to fetch a picture's bytes from, most likely to succeed first.
 *
 * **Deliberately the reverse of the render order.** `driveImageSources` puts
 * Google's CDN first because a rendered `<img>` should spend Google's bandwidth
 * rather than ours. A `fetch` has a different constraint: it needs CORS, and the
 * backend proxy is our own origin-allowed route while the CDN's headers are
 * Google's to change. One copy is not worth the bandwidth argument, so the
 * proxy leads and the CDN is the fallback.
 */
export function copySourcesFor(input: {
  fileId?: string | null;
  url?: string | null;
  apiBase?: string | null;
}): string[] {
  const all = driveImageSources({
    fileId: input.fileId,
    url: input.url,
    apiBase: input.apiBase,
  });
  const proxies = all.filter((s) => s.includes("/cowork/media/view/"));
  const rest = all.filter((s) => !s.includes("/cowork/media/view/"));
  return [...proxies, ...rest];
}

/** The first source that answers with image bytes. */
async function fetchImageBlob(sources: readonly string[]): Promise<Blob> {
  let lastError: unknown = null;
  for (const src of sources) {
    try {
      const r = await fetch(src, { mode: "cors", credentials: "omit" });
      if (!r.ok) continue;
      const blob = await r.blob();
      if (blob.size > 0) return blob;
    } catch (e) {
      /* A cross-origin refusal throws rather than returning a status, so the
         next source gets its turn instead of the whole copy failing here. */
      lastError = e;
    }
  }
  throw lastError ?? new Error("No source returned image bytes.");
}

/**
 * Anything an `<img>` can draw, as PNG bytes.
 *
 * A JPEG or WebP straight off the wire is refused by Chrome's clipboard, which
 * takes PNG and little else, so everything that is not already PNG goes through
 * a canvas. An image that is already PNG is passed through untouched — decoding
 * and re-encoding it would cost time and could only lose quality.
 */
async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === CLIPBOARD_IMAGE_TYPE) return blob;

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context for the conversion.");
    ctx.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, CLIPBOARD_IMAGE_TYPE),
    );
    if (!png) throw new Error("The image could not be converted.");
    return png;
  } finally {
    /* Frees the decoded frame immediately rather than at the next collection —
       a full-size photograph is tens of megabytes decoded. */
    bitmap.close();
  }
}

export type CopyOutcome =
  | { ok: true; copied: "text" | "image" | "both" }
  | { ok: false; message: string };

/**
 * What to tell somebody, naming what actually reached the clipboard.
 *
 * One sentence per outcome rather than a single "Copied." — a person who copied
 * a screenshot and a caption is about to paste into something that takes one or
 * the other, and "Message and image copied." is what tells them the paste will
 * carry the picture. Shared by both threads so the two never word it
 * differently for the same action.
 */
export const COPIED_NOTICE: Record<"text" | "image" | "both", string> = {
  text: "Message copied.",
  image: "Image copied.",
  both: "Message and image copied.",
};

/**
 * Run a plan. Returns what actually reached the clipboard rather than throwing,
 * so the caller can say so precisely.
 */
export async function runCopyPlan(
  plan: CopyPlan,
  apiBase: string | null | undefined,
): Promise<CopyOutcome> {
  if (plan.disabled) {
    return { ok: false, message: plan.reason ?? "There is nothing to copy." };
  }

  const text = plan.text;

  /* No picture, or a browser without the rich clipboard: the caption alone,
     exactly as before. `writeText` is available in every context `write` is and
     several where it is not, so this is also the fallback path below. */
  const textOnly = async (): Promise<CopyOutcome> => {
    if (!text) return { ok: false, message: "There is nothing to copy." };
    await navigator.clipboard.writeText(text);
    return { ok: true, copied: "text" };
  };

  if (!plan.image) {
    try {
      return await textOnly();
    } catch {
      return { ok: false, message: clipboardRefused() };
    }
  }

  const rich =
    typeof ClipboardItem !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function";

  if (!rich) {
    /* An older browser still gets the caption. Saying which half arrived is the
       honest outcome — reporting a plain "Copied." would have somebody paste
       into a document and find the picture missing with no explanation. */
    try {
      const out = await textOnly();
      return out.ok
        ? { ok: true, copied: "text" }
        : { ok: false, message: "This browser cannot copy images." };
    } catch {
      return { ok: false, message: clipboardRefused() };
    }
  }

  const sources = copySourcesFor({
    fileId: plan.image.fileId,
    url: plan.image.url,
    apiBase,
  });

  /* Built synchronously — see the note on user gestures above. */
  const png = fetchImageBlob(sources).then(asPng);

  const parts: Record<string, Promise<Blob> | Blob> = {
    [CLIPBOARD_IMAGE_TYPE]: png,
  };
  if (text) {
    parts["text/plain"] = new Blob([text], { type: "text/plain" });
  }

  try {
    await navigator.clipboard.write([new ClipboardItem(parts)]);
    return { ok: true, copied: text ? "both" : "image" };
  } catch {
    /* The picture could not be fetched, converted or written. The caption is
       still worth having, so it goes on its own rather than the whole action
       failing — and the message says the picture did not make it. */
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
        return { ok: false, message: "Text copied — the image could not be." };
      } catch {
        /* falls through to the shared refusal below */
      }
    }
    return { ok: false, message: "The image could not be copied." };
  }
}

function clipboardRefused(): string {
  return "This browser would not let Cowork use the clipboard.";
}
