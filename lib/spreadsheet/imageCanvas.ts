/**
 * Turning an edit into bytes.
 *
 * The one part of the picture editor that has to touch a canvas. The geometry
 * it relies on lives in `imageEdit.ts` and `imageImport.ts` and is proven
 * there; this file is deliberately thin, because everything in it can only be
 * checked in a browser.
 *
 * **The output is encoded at the size the cell will show it**, not at the
 * source's size. A 4000px photograph shown in a 480px cell would otherwise put
 * 4000px through Drive, down the wire, and into every future load of the sheet,
 * to be thrown away by the browser on the way to the screen.
 */

import { fitImportSize, type ImportFit, type PixelSize } from "./imageImport.ts";
import {
  clampCrop,
  editedSize,
  fullCrop,
  isIdentityEdit,
  normalizeTurns,
  rotatedSize,
  type ImageEdit,
} from "./imageEdit.ts";

export interface RenderedImage {
  blob: Blob;
  /** What the cell should become. */
  size: ImportFit;
}

/** PNG keeps transparency; everything else is better off as a JPEG than as a
    PNG of a photograph, which can be several times the size for no gain. */
function outputType(sourceType: string): { type: string; quality?: number } {
  if (sourceType === "image/png" || sourceType === "image/webp") {
    return { type: sourceType };
  }
  return { type: "image/jpeg", quality: 0.92 };
}

/**
 * Decode a file far enough to know its dimensions and to draw it.
 *
 * **The object URL outlives this call, and the caller must revoke it** — pass
 * `image.src` to `URL.revokeObjectURL` when the image is finished with.
 *
 * Revoking here on load looks tidier and breaks the caller: a decoded
 * `HTMLImageElement` keeps its bitmap, so `drawImage` still works, but the
 * `src` is now a dead address — and the editor shows the very same `src` in an
 * `<img>` for its preview. That preview loaded as a broken image while every
 * measurement around it read correct, which is a hard failure to place.
 */
export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

/**
 * Draw the rotated, cropped, size-limited picture and hand back its bytes.
 *
 * Rotate then crop, matching `imageEdit.ts` — the crop rectangle is in the
 * rotated image's coordinates, because that is the picture somebody drew the
 * box on.
 */
export async function renderEdited(
  source: HTMLImageElement,
  edit: ImageEdit,
  sourceType: string,
  box?: PixelSize,
): Promise<RenderedImage> {
  const natural: PixelSize = {
    width: source.naturalWidth,
    height: source.naturalHeight,
  };
  const rotated = rotatedSize(natural, edit.turns);
  const crop = clampCrop(edit.crop ?? fullCrop(rotated), rotated) ?? fullCrop(rotated);
  const target = fitImportSize(editedSize(natural, edit), box);

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not prepare the image.");

  /* Quality matters here: this is a downscale, often a large one, and the
     default nearest-ish sampling turns fine text in a screenshot to mush. */
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  /* Scale to the target, then move the crop's top-left to the origin, then lay
     the rotated image down in the coordinate space that leaves. Composed in
     that order because each step is expressed in the space the previous one
     established. */
  ctx.scale(target.width / crop.width, target.height / crop.height);
  ctx.translate(-crop.x, -crop.y);

  const turns = normalizeTurns(edit.turns);
  if (turns === 1) {
    ctx.translate(rotated.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (turns === 2) {
    ctx.translate(rotated.width, rotated.height);
    ctx.rotate(Math.PI);
  } else if (turns === 3) {
    ctx.translate(0, rotated.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(source, 0, 0, natural.width, natural.height);

  const out = outputType(sourceType);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, out.type, out.quality),
  );
  if (!blob) throw new Error("This browser could not prepare the image.");
  return { blob, size: target };
}

/**
 * What to upload for a given edit — the original file when nothing was changed
 * and nothing needs shrinking, a re-drawn one otherwise.
 *
 * Handing back the untouched file matters: re-encoding a JPEG that nobody
 * edited costs a generation of quality and discards what the camera wrote into
 * it, in exchange for no visible difference.
 */
export async function prepareForImport(
  file: File,
  source: HTMLImageElement,
  edit: ImageEdit,
  box?: PixelSize,
): Promise<{ file: File; size: ImportFit }> {
  const natural: PixelSize = {
    width: source.naturalWidth,
    height: source.naturalHeight,
  };
  const fit = fitImportSize(editedSize(natural, edit), box);
  if (isIdentityEdit(natural, edit) && !fit.scaled) {
    return { file, size: fit };
  }
  const rendered = await renderEdited(source, edit, file.type, box);
  const ext = rendered.blob.type === "image/png" ? "png" : rendered.blob.type === "image/webp" ? "webp" : "jpg";
  const stem = file.name.replace(/\.[^.]+$/, "") || "image";
  return {
    file: new File([rendered.blob], `${stem}.${ext}`, { type: rendered.blob.type }),
    size: rendered.size,
  };
}
