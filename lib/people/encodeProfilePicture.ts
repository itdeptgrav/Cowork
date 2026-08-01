"use client";

import {
  OUTPUT_QUALITY,
  OUTPUT_SIZE_PX,
  pictureRefusal,
} from "@/lib/rules/people/profilePicture";

/**
 * Turn a chosen file into the square this product stores.
 *
 * The arithmetic is legacy's — centre-crop to a square, downscale to 160×160,
 * encode JPEG at 0.75 — because the same field is read by the old application
 * and a different output would give one person two faces of different
 * resolutions depending on which app they used.
 *
 * The DOM work is here rather than in `lib/rules/` because a canvas is not a
 * rule. What IS a rule — which files are accepted, how big the output may be,
 * what the refusals say — lives in `rules/people/profilePicture.ts` and is
 * tested there without a browser.
 *
 * ## Two things legacy gets wrong, fixed here
 *
 * **EXIF orientation.** Legacy loads the file with `new Image()` and draws it
 * as-is. A photograph taken on a phone held sideways carries its rotation in
 * EXIF, so it arrives on the canvas lying down — the picture looks right in the
 * file picker and wrong the moment it is saved. `createImageBitmap` is asked for
 * the oriented image explicitly.
 *
 * **A leaked object URL.** Legacy calls `URL.createObjectURL` and never revokes
 * it, so every attempt holds the whole source file in memory for the life of the
 * page. This releases it on both paths.
 */

/** Named so a caller can tell a decode failure from a refusal. */
export class PictureDecodeError extends Error {
  constructor() {
    super("That image could not be read. Try a different file.");
    this.name = "PictureDecodeError";
  }
}

export async function encodeProfilePicture(file: File): Promise<string> {
  const refusal = pictureRefusal({ type: file.type, size: file.size });
  if (refusal) throw new Error(refusal);

  const source = await decode(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE_PX;
    canvas.height = OUTPUT_SIZE_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PictureDecodeError();

    /* A JPEG has no transparency, so an image with an alpha channel would
       otherwise composite onto black. White is what every avatar in this product
       sits on in light mode and what paper is in print. */
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, OUTPUT_SIZE_PX, OUTPUT_SIZE_PX);
    ctx.imageSmoothingQuality = "high";

    /* Centre crop: take the largest square the image contains, from its middle.
       Fitting the whole image inside the square instead would letterbox every
       portrait photograph, and a face is almost always in the middle. */
    const minSide = Math.min(source.width, source.height);
    const sx = (source.width - minSide) / 2;
    const sy = (source.height - minSide) / 2;
    ctx.drawImage(source, sx, sy, minSide, minSide, 0, 0, OUTPUT_SIZE_PX, OUTPUT_SIZE_PX);

    return canvas.toDataURL("image/jpeg", OUTPUT_QUALITY);
  } finally {
    if ("close" in source && typeof source.close === "function") source.close();
  }
}

type Decoded = ImageBitmap | HTMLImageElement;

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      /* `from-image` is what applies the EXIF rotation. Without it a phone
         photograph is stored on its side. */
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* Fall through. Some formats a browser will render in an `<img>` cannot be
         decoded to a bitmap, and one of those failing is not a reason to refuse
         the picture. */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new PictureDecodeError());
      img.src = url;
    });
  } finally {
    /* Released on both paths. Legacy never does this, so every attempt holds the
       source file in memory until the page goes. */
    URL.revokeObjectURL(url);
  }
}
