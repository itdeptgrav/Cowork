"use client";

import { useRef, useState } from "react";
import type { MrfImage } from "@/lib/domain/mrf";

/** Reference photos on a request line — uploaded to the app's image route. */
const MAX = 5;
const MAX_BYTES = 8 * 1024 * 1024;

async function uploadMrfImage(
  file: File,
  folder = "mrf-products",
): Promise<MrfImage> {
  // 1. Prefer the app's own route (keeps the Cloudinary secret server-side).
  //    Wrapped so a route that is unreachable — e.g. the dev server has not
  //    picked it up yet — falls through to the direct path instead of failing.
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("folder", folder);
    const res = await fetch("/api/cloudinary/upload", {
      method: "POST",
      body: form,
    });
    if (res.ok) {
      const data = await res.json();
      if (data.url) return { url: data.url, name: data.name ?? file.name };
    }
  } catch {
    /* Route unreachable — try a direct unsigned upload below. */
  }

  // 2. Direct unsigned upload to Cloudinary — no server route needed.
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  if (!cloud || !preset)
    throw new Error(
      "Image upload is not configured (set the CLOUDINARY values in .env.local, then restart).",
    );
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", preset);
  form.append("folder", folder);
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/upload`,
    { method: "POST", body: form },
  );
  const data = await res.json();
  if (!res.ok || !data.secure_url)
    throw new Error(data.error?.message || "Upload failed");
  return { url: data.secure_url, name: file.name };
}

export function MrfPhotoUploader({
  images,
  onChange,
  folder = "mrf-products",
}: {
  images: MrfImage[];
  onChange: (next: MrfImage[]) => void;
  folder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async (files: FileList | null) => {
    const chosen = Array.from(files ?? []);
    if (!chosen.length) return;
    setError("");
    const room = MAX - images.length;
    if (room <= 0) {
      setError(`Up to ${MAX} photos.`);
      return;
    }
    setBusy(true);
    const uploaded: MrfImage[] = [];
    const failed: string[] = [];
    // One at a time, so a single failure never discards the others.
    for (const f of chosen.slice(0, room)) {
      if (!f.type.startsWith("image/")) {
        failed.push(`${f.name} (not an image)`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        failed.push(`${f.name} (over 8 MB)`);
        continue;
      }
      try {
        uploaded.push(await uploadMrfImage(f, folder));
      } catch (e) {
        failed.push(`${f.name} (${e instanceof Error ? e.message : "failed"})`);
      }
    }
    if (uploaded.length) onChange([...images, ...uploaded]);
    if (failed.length) setError(`Could not add: ${failed.join(", ")}`);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {images.map((im, i) => (
          <span key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={im.url}
              alt={im.name ?? "Reference photo"}
              className="h-11 w-11 rounded-md object-cover"
            />
            <button
              type="button"
              aria-label="Remove photo"
              onClick={() => onChange(images.filter((_, x) => x !== i))}
              className="absolute -top-1.5 -right-1.5 grid h-4 w-4 place-items-center rounded-full bg-ink text-[10px] text-[var(--body-bg)]"
            >
              ×
            </button>
          </span>
        ))}
        {images.length < MAX && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="grid h-11 w-11 place-items-center rounded-md border border-dashed border-hairline text-[10px] text-ink-muted hover:text-ink disabled:opacity-60"
          >
            {busy ? "…" : "Add"}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => pick(e.target.files)}
        />
      </div>
      {error && (
        <p className="mt-1 text-[11px] text-[var(--state-rework-ink)]">{error}</p>
      )}
    </div>
  );
}
