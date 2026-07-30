/**
 * Monogram avatars. This build ships no photography — docs/architecture/PRODUCT.md records that
 * no real people exist in the data, and inventing faces for invented employees
 * would present synthetic material as genuine. Hues come from the field
 * palette so identity varies without introducing new colour.
 */

/* Field hues, but none darker than ~#93a5bd: the monogram is real text, and the
   original slate pair bottomed out at #5f7794 where black/70 fell to 3.65:1. */
const fieldHues = [
  ["#f2e6d2", "#dcc9ab"],
  ["#e6c79c", "#d6ac7e"],
  ["#d9a4b0", "#c78e9c"],
  ["#c0abd1", "#a690bd"],
  ["#9fb2cb", "#93a5bd"],
  ["#b4bbad", "#9aa393"],
] as const;

const sizes = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-10 w-10 text-xs",
  lg: "h-14 w-14 text-sm",
} as const;

interface AvatarProps {
  initials: string;
  hue: 0 | 1 | 2 | 3 | 4 | 5;
  size?: keyof typeof sizes;
  name?: string;
  className?: string;
}

export function Avatar({
  initials,
  hue,
  size = "md",
  name,
  className = "",
}: AvatarProps) {
  const [from, to] = fieldHues[hue];

  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-full font-medium tracking-tight text-black/85 ring-1 ring-white/40 ${sizes[size]} ${className}`}
      style={{ background: `linear-gradient(148deg, ${from}, ${to})` }}
      role="img"
      aria-label={name ? `${name} avatar` : undefined}
      aria-hidden={name ? undefined : true}
    >
      {initials}
    </span>
  );
}

interface AvatarStackProps {
  people: { initials: string; hue: 0 | 1 | 2 | 3 | 4 | 5; name: string }[];
  overflow?: number;
}

export function AvatarStack({ people, overflow = 0 }: AvatarStackProps) {
  return (
    <div className="flex items-center">
      {people.map((p) => (
        <Avatar
          key={p.name}
          initials={p.initials}
          hue={p.hue}
          name={p.name}
          size="sm"
          className="-ml-2 ring-2 ring-white/55 first:ml-0"
        />
      ))}
      {overflow > 0 && (
        <span className="-ml-2 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/[0.09] text-[11px] font-medium text-ink-muted ring-2 ring-white/55">
          +{overflow}
        </span>
      )}
    </div>
  );
}
