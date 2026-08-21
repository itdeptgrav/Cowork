/**
 * How many labels a time axis can actually show, per screen width.
 *
 * A twelve-week axis has twelve dates to print. On a desktop card that is
 * comfortable; in a 330px-wide card on a phone each one gets 27px and the whole
 * row degrades into "15 J…, 29 J…, 13 J…" — an axis of ellipses, which is
 * worse than fewer labels because it neither names the weeks nor leaves the
 * space clean.
 *
 * The existing rule was one breakpoint deep: hide every second label below the
 * wide layout. That halves twelve to six, and six into 330px is still 55px a
 * label — enough for "1 Jun" and not for "15 Jun", so the truncation stayed on
 * exactly the dates that were two characters longer.
 *
 * So the thinning is per breakpoint, and it is expressed as the STRIDE between
 * the labels that survive: every fourth on a phone, every second on a tablet,
 * all of them on the wide layout. The first and last always survive whatever
 * the stride — an axis that does not say where it starts and ends is not an
 * axis — and a short series is never thinned at all.
 *
 * Returns Tailwind visibility classes rather than a boolean, because the answer
 * differs per breakpoint and only CSS knows which breakpoint is live: the same
 * markup is a phone and a desktop in two different windows.
 */

/** Below this many points nothing is thinned — they all fit anywhere. */
const THIN_ABOVE = 5;

/**
 * The visibility classes for label `index` of `count`.
 *
 * `""` means always visible. Otherwise the label starts hidden and returns at
 * whichever breakpoint has room for it, so nothing is permanently lost — a
 * wider window shows the whole axis.
 */
export function axisLabelVisibility(index: number, count: number): string {
  if (count <= THIN_ABOVE) return "";
  const isEdge = index === 0 || index === count - 1;
  if (isEdge) return "";
  /* Strides are measured from the START of the series so the surviving labels
     are evenly spaced, and each wider breakpoint is a superset of the narrower
     one — a label never appears at `sm` and vanishes again at `deck`. */
  const onPhone = index % 4 === 0;
  const onTablet = index % 2 === 0;
  if (onPhone) return "";
  if (onTablet) return "invisible sm:visible";
  return "invisible deck:visible";
}
