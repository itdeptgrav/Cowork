import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

/**
 * Image upload for MRF reference photos (and any other image the app attaches).
 *
 * Two modes, tried in order — the same shape the old app used:
 *   1. SIGNED   — CLOUDINARY_API_SECRET stays server-side; the signature is
 *      computed here so the secret never reaches the browser.
 *   2. UNSIGNED — NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET, which carries its own
 *      permission and needs no secret at all.
 *
 * The fallback matters: a wrong secret fails every upload with "Invalid
 * Signature", and the unsigned preset keeps photos working until it is fixed.
 */

const CLOUD_NAME =
  process.env.CLOUDINARY_CLOUD_NAME ||
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const API_KEY =
  process.env.CLOUDINARY_API_KEY || process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

/** A key pasted into the secret slot can never sign — skip straight to unsigned. */
const secretLooksWrong =
  !API_SECRET || API_SECRET === API_KEY || /^\d+$/.test(API_SECRET);

async function signedUpload(
  buffer: Buffer,
  folder: string,
  filename: string,
  mimeType: string,
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHash("sha1")
    .update(`folder=${folder}&timestamp=${timestamp}${API_SECRET}`)
    .digest("hex");
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], {
      type: mimeType || "application/octet-stream",
    }),
    filename || "upload",
  );
  form.append("api_key", String(API_KEY));
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("signature", signature);
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`,
    { method: "POST", body: form },
  );
  const data = await res.json();
  if (!res.ok || data.error)
    throw new Error(data.error?.message || `signed upload failed (${res.status})`);
  return data;
}

async function unsignedUpload(
  buffer: Buffer,
  folder: string,
  filename: string,
  mimeType: string,
) {
  if (!UPLOAD_PRESET) throw new Error("no unsigned upload preset configured");
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], {
      type: mimeType || "application/octet-stream",
    }),
    filename || "upload",
  );
  form.append("upload_preset", UPLOAD_PRESET);
  if (folder) form.append("folder", folder);
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`,
    { method: "POST", body: form },
  );
  const data = await res.json();
  if (!res.ok || data.error)
    throw new Error(data.error?.message || `unsigned upload failed (${res.status})`);
  return data;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const folder = String(formData.get("folder") || "mrf-products");

    if (!file || typeof file === "string")
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (!CLOUD_NAME)
      return NextResponse.json(
        { error: "Upload not configured", details: "CLOUDINARY_CLOUD_NAME is not set." },
        { status: 500 },
      );

    const buffer = Buffer.from(await file.arrayBuffer());
    const problems: string[] = [];
    let result: { secure_url?: string; public_id?: string } | null = null;

    if (secretLooksWrong) {
      problems.push("signed: CLOUDINARY_API_SECRET is missing or a copy of the API key");
    } else {
      try {
        result = await signedUpload(buffer, folder, file.name, file.type);
      } catch (e) {
        problems.push(`signed: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    if (!result) {
      try {
        result = await unsignedUpload(buffer, folder, file.name, file.type);
      } catch (e) {
        problems.push(`unsigned: ${e instanceof Error ? e.message : "failed"}`);
        return NextResponse.json(
          {
            error: "Upload failed",
            details: `${problems.join(" | ")}. Fix CLOUDINARY_API_SECRET, or set NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET.`,
          },
          { status: 500 },
        );
      }
    }

    if (!result?.secure_url)
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });

    return NextResponse.json({
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      name: file.name,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Upload failed", details: error instanceof Error ? error.message : "" },
      { status: 500 },
    );
  }
}
