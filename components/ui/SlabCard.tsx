import type { ReactNode } from "react";

/**
 * The stepped slab — Cowork's signature silhouette.
 *
 * The top edge sits high across the left portion, then steps down through a
 * convex radius and a concave fillet to a lower top edge on the right. The tab
 * is where identity lives (an avatar, a mark) and the step exists to make room
 * for it: per The Earned Step Rule, this shape is reserved for cards about a
 * person or a score.
 *
 * Composed from a body plus two pseudo-elements rather than a clip-path, so the
 * corner radii stay true at every width instead of distorting with the aspect
 * ratio. The drop-shadow lives on the wrapper because a composed silhouette
 * cannot cast a correct box-shadow.
 */

export type SlabSize = "hero" | "compact";

const geometry: Record<
  SlabSize,
  { stepAt: string; tabRise: string; radius: string }
> = {
  hero: { stepAt: "71%", tabRise: "72px", radius: "28px" },
  compact: { stepAt: "64%", tabRise: "52px", radius: "22px" },
};

interface SlabCardProps {
  /** Sits inside the raised tab. */
  tab: ReactNode;
  children: ReactNode;
  size?: SlabSize;
  className?: string;
  /** Non-focused cards in a rail recede rather than disappear. */
  dimmed?: boolean;
  style?: React.CSSProperties;
  /**
   * Stretch to the height of the grid row. The body becomes a flex column so
   * whichever child claims `flex-1` absorbs the slack — used on the dashboard
   * so a stretched band grows the C1–C4 ribbon instead of opening a void.
   */
  fill?: boolean;
}

export function SlabCard({
  tab,
  children,
  size = "hero",
  className = "",
  dimmed = false,
  style,
  fill = false,
}: SlabCardProps) {
  const g = geometry[size];

  return (
    <div
      className={`slab-wrap transition-[opacity,transform,filter] duration-[420ms] ease-[var(--ease-out-expo)] ${
        fill ? "flex h-full flex-col" : ""
      } ${dimmed ? "scale-[0.97] opacity-55" : "scale-100 opacity-100"} ${className}`}
      style={
        {
          "--step-at": g.stepAt,
          "--tab-rise": g.tabRise,
          "--slab-radius": g.radius,
          ...style,
        } as React.CSSProperties
      }
    >
      <div className={`slab ${fill ? "flex min-h-0 flex-1 flex-col" : ""}`}>
        {/* The tab content is pulled up into the raised region. */}
        <div
          className="slab-content absolute left-0 px-6"
          style={{ top: `calc(${g.tabRise} * -1 + 18px)` }}
        >
          {tab}
        </div>
        <div
          className={`slab-content ${fill ? "flex min-h-0 flex-1 flex-col" : ""}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
