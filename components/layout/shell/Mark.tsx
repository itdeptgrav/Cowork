/**
 * The Cowork mark.
 *
 * **This is the real logo, traced from `public/brand/cowork-logo.svg`** — the
 * artwork file, not a likeness of it. What stood here before was an
 * approximation built from a rounded rect, a second rect rotated -7°, and a
 * stroked polyline: close enough to pass at 20px and wrong everywhere else. Its
 * colours were off too (`#F6E3A0` against the real `#fbe6a2`, `#9B82F0` against
 * `#9c82f8`). A logo is not a shape that resembles the logo.
 *
 * Two things to keep true when touching this:
 *
 *  · **The `<style>` block from the source file is deliberately not here.** The
 *    artwork classes it (`.cls-1`, `.cls-2`…) and inlining that into a page
 *    would define those class names GLOBALLY, on a document that already has
 *    its own stylesheet. Each fill is set on its own path instead.
 *  · **The root carries no `fill="none"`.** The dark shape relies on SVG's
 *    default black fill; a `fill="none"` on the root is inherited and erases it.
 *
 * The mark is full-colour and fixed — it does not take `currentColor`, so it
 * reads the same on frost, slab and field. `className` controls only its size.
 * `app/icon.svg` is the same artwork; change one and change the other.
 */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 984.894 1000"
      className={className}
      role="img"
      aria-label="Cowork"
    >
      <defs>
        {/* Trims the sheet and the dark front to the body's silhouette. Both
            overrun it by design — the dark path runs to y=1324 — so without
            this they spill out of the folder. The id is fixed rather than
            generated: two marks on one page produce two identical clip paths,
            and the browser resolving both to the first is harmless. */}
        <clipPath id="cowork-mark-body">
          <path d="M754.783,1000H230.111C103.024,1000,0,896.976,0,769.889V191.568h754.783c127.087,0,230.111,103.024,230.111,230.111v348.21c0,127.087-103.024,230.111-230.111,230.111Z" />
        </clipPath>
      </defs>

      {/* The tab. */}
      <path
        fill="#fbe6a2"
        d="M554.794,149.435H.009v-56.738C.009,41.497,41.505,0,92.706,0h289.583c87.845,0,160.479,64.954,172.505,149.435Z"
      />
      {/* The body. */}
      <path
        fill="#fbe6a2"
        d="M754.783,1000H230.111C103.024,1000,0,896.976,0,769.889V191.568h754.783c127.087,0,230.111,103.024,230.111,230.111v348.21c0,127.087-103.024,230.111-230.111,230.111Z"
      />
      <g clipPath="url(#cowork-mark-body)">
        {/* The lilac sheet. */}
        <path
          fill="#9c82f8"
          d="M871.944,959.134l-796.658-7.09c-42.228-.376-76.07-31.956-76.374-70.544l-2.841-360.501c-.581-73.767,63.595-142.124,146.285-153.07l625.627-82.814c114.498-15.156,216.187,77.848,216.912,169.807l-.621,418.117c.379,48.104-50.554,86.644-112.329,86.094Z"
        />
        {/* The dark front. */}
        <path d="M849.286,1324.047L-73.794,961.753,0,665.786c8.933-81.271,89.657-181.17,209.832-169.279l639.269,90.568c100.441,14.23,159.238,132.693,126.879,255.633l-126.694,481.339Z" />
      </g>
      {/* The check. */}
      <path
        fill="#fff"
        d="M253.955,900.92l-126.475-126.473c-10.464-10.462-10.464-27.428,0-37.89,10.462-10.459,27.425-10.459,37.887,0l88.587,88.589,182.829-182.832c10.462-10.459,27.425-10.459,37.887,0,10.464,10.462,10.464,27.428,0,37.89l-220.716,220.716Z"
      />
    </svg>
  );
}
