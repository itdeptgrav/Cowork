/**
 * Hand a URL to the browser to download natively.
 *
 * The browser streams it to disk on its own — with its own progress bar, and
 * without ever holding the whole file in memory. This is the right path for a
 * LARGE file: the alternative (`downloadFile`, which `fetch`es the bytes into a
 * Blob before saving) pulls the entire file into RAM first, so a 380 MB PDF sat
 * on a spinner with nothing visible until all of it had arrived.
 *
 * It works cross-origin because the server answers the target with
 * `Content-Disposition: attachment` — which tells the browser to SAVE rather
 * than navigate, and carries the real filename. The `download` attribute is
 * only a same-origin hint (ignored cross-origin), so the header is what matters;
 * the target must be a URL that sets it (the media proxy's `?download=1`).
 */
export function browserDownload(url: string, filename?: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = url;
  if (filename) a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
