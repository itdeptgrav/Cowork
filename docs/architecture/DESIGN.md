---
name: Cowork
description: A frosted instrument deck over living iridescent material, with dark slabs carrying the measurement.
colors:
  ink: "#0a0a0a"
  ink-muted: "#565656"
  ink-faint: "#5f5f5f"
  slab: "#262626"
  slab-ink: "#f5f5f5"
  slab-ink-muted: "#949494"
  slab-screen: "rgba(0,0,0,0.34)"
  frost-bar: "rgba(250,250,252,0.98)"
  frost-panel: "rgba(240,240,242,0.97)"
  hairline: "rgba(10,10,10,0.12)"
  hairline-slab: "rgba(255,255,255,0.10)"
  c1-execution: "#00b26b"
  c2-goals: "#c3d02e"
  c3-policy: "#c22a9e"
  c4-attendance: "#8e8e8e"
  field-ivory: "#f2e6d2"
  field-gold: "#e6c79c"
  field-rose: "#d9a4b0"
  field-mauve: "#b39cc6"
  field-slate: "#8b9fbc"
  field-deep: "#474c59"
typography:
  display:
    fontFamily: "Geist, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2rem, 4.2vw, 3.25rem)"
    fontWeight: 300
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 2.4vw, 2.125rem)"
    fontWeight: 350
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  wordmark:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.012em"
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.008em"
  figure:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontVariation: "tabular-nums"
  figureLarge:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontVariation: "tabular-nums"
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 450
    lineHeight: 1.2
    letterSpacing: "0.09em"
  caption:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "-0.004em"
rounded:
  shell: "0px"
  band: "8px"
  slab: "8px"
  panel: "8px"
  sheet: "8px"
  control: "5px"
  inset: "5px"
  tag: "3px"
  pill: "9999px"
spacing:
  hair: "4px"
  tight: "8px"
  snug: "12px"
  base: "16px"
  loose: "24px"
  section: "32px"
  deck: "48px"
components:
  topbar:
    backgroundColor: "{colors.frost-bar}"
    textColor: "{colors.ink}"
    rounded: "{rounded.shell}"
    height: "44px"
    padding: "0 16px"
  nav-link:
    textColor: "{colors.ink-muted}"
    typography: "{typography.title}"
    rounded: "{rounded.shell}"
    padding: "0 10px"
  nav-link-active:
    textColor: "{colors.ink}"
    borderBottom: "2px solid {colors.ink}"
  lens-segment:
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
    typography: "{typography.title}"
  lens-segment-active:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
  band:
    backgroundColor: "{colors.frost-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.band}"
    padding: "14px 16px"
  slab-card:
    backgroundColor: "{colors.slab}"
    textColor: "{colors.slab-ink}"
    rounded: "{rounded.slab}"
    padding: "16px"
  status-tag:
    backgroundColor: "rgba(10,10,10,0.06)"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.tag}"
    padding: "2px 6px"
    typography: "{typography.caption}"
  inline-action:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
    typography: "{typography.caption}"
---

# Design System: Cowork

## Overview

**Creative North Star: "Chrome Under Frost"**

Cowork is a set of solid instrument surfaces laid on a slow-moving iridescent ground. Three materials, always in this order: a living chrome field at the back that drifts and never repeats; an opaque deck of bands in the middle that holds navigation and content; and matte dark slabs on top that carry measurement. Depth is honest — the ground is *seen around and between* the deck, at full strength, in real negative space, and it is the only part of the interface that moves on its own.

*Revised.* The deck used to be frosted glass at 20–28% transparency so the field would read through it. That put body text on drifting colour and made every panel the same object. The field was never the problem; the translucency was. Solid surfaces make the chrome **more** present, because the gaps finally belong to it.

The register is instrument, not dashboard. People live here for eight hours, so the deck is quiet, the density is real, and expression is spent on material and silhouette rather than on color-coding every surface. Measurement earns the darkest, most present material in the system because measurement is what this product is for: a dark slab reads as an instrument face, and the four component colors on it read as calibrated channels rather than decoration.

The one liberty this system takes is silhouette. Every slab is cut with a stepped tab along its top edge — the shape the whole identity hangs on, down to the logo. It is the only ornament, and it is load-bearing: the tab is where identity sits (an avatar, a mark), which is why the step exists at all.

**Key Characteristics:**
- Three stacked materials: chrome field → opaque deck → matte dark slab. Never reorder them.
- The field is seen **around** the deck, never **through** a surface carrying text.
- One stepped silhouette, used at every scale from logo to hero card.
- A four-level radius hierarchy — shell `0`, band `8px`, control `5px`, tag `3px`. The capsule is retired; only an avatar stays round.
- Neutral everywhere; saturated color reserved exclusively for the four score components, and never as a large fill — 2px keys and ticks.
- Bands in one composition are never the same height and weight.
- The background is the only thing that moves at rest.
- Tabular figures throughout. Numbers are the content.

## Colors

A fully neutral deck with a six-hue iridescent field behind it and exactly four saturated channels reserved for measurement.

### Primary

- **Measurement Slab** (`#262626`): The matte dark ground for anything carrying a score, a component value, or a person's performance. This is the most present material in the system and its scarcity is what makes it read as an instrument face. Never used for navigation, never used for a container that holds only prose.
- **Deck Ink** (`#0a0a0a`): Near-black for primary text on frosted surfaces, active navigation, and the filled segment of the lens toggle. Never pure `#000`.

### Secondary — the four score channels

These four hues exist to name C1–C4 and nothing else. They are the only saturated color in Cowork.

- **Execution Emerald** (`#00b26b`): C1 · Task Execution.
- **Goal Lime** (`#c3d02e`): C2 · Goals.
- **Policy Magenta** (`#c22a9e`): C3 · Policy. Reserved for the deduction channel. Magenta rather than red because a deduction is an accounting fact, not an alarm.
- **Attendance Grey** (`#8e8e8e`): C4 · Attendance. Deliberately unsaturated — attendance is the system's steady baseline, and giving it a fifth hue would imply a fifth kind of importance. Set at mid grey rather than light: attendance normally sits near the top of its range, so a lighter value made the tallest bar in the band the least meaningful one.

### Tertiary — the iridescent field

Six hues that live in the background field, always seen through frost: **Field Ivory** (`#f2e6d2`), **Field Gold** (`#e6c79c`), **Field Rose** (`#d9a4b0`), **Field Mauve** (`#b39cc6`), **Field Slate** (`#8b9fbc`), **Field Deep** (`#474c59`).

One sanctioned use outside the field: **monogram avatars** tint from this palette, so identity varies without introducing a seventh hue family. Avatar stops are lightened from the field values (none darker than `#93a5bd`) because a monogram is real text and the field's darker stops fail contrast under it. Nothing else — no chip, no status, no chart — may take a field hue.

### Neutral

- **Muted Ink** (`#565656`): Secondary text and idle navigation on frosted surfaces. Holds 5.4:1 against the real frosted composite (~`#dcdcde`).
- **Faint Ink** (`#5f5f5f`): Metadata and column headers on frosted surfaces, at 12px and above. Holds 4.7:1 on the same composite.

**Contrast is measured against the composite, never the swatch.** The frosted panel is translucent, so its effective background is the blend of its own value with whatever the field puts behind it. Earlier values in this file were derived from the flat token and fell to 2.5–4.1:1 in the render. Sample the rendered pixel before trusting a ratio.
- **Slab Ink** (`#f5f5f5`) / **Slab Muted Ink** (`#949494`): Text on the dark slab. The muted value is `#949494` and not a step darker, because `#8a8a8a` falls to 4.38:1 against the slab and fails. Never apply an opacity fraction to it — anything below full strength drops under 4.5:1.
- **Slab Screen** (`rgba(0,0,0,0.34)`): The halftone dot laid over every channel fill. It is a system value rather than a one-off, because it is what makes a bar read as screen-printed instead of flat.
- **Hairline** (`rgba(10,10,10,0.10)`) / **Slab Hairline** (`rgba(255,255,255,0.10)`): Single-pixel dividers. The system separates with hairlines and space, not with borders.

### Named Rules

**The Four Channels Rule.** Saturated color in Cowork means "this is a score component." Four hues, four components, no exceptions. A status, a priority, a chart series, or a brand accent may never borrow C1–C4's hues, because the moment a second meaning attaches to Execution Emerald the component band stops being readable.

**The No Weighting Rule.** The four components render as four independent channels with independent baselines. Never stack them, never draw them as slices of one total, never size them relative to one another. Their weights are an undecided product fact, and any composition that implies a split is asserting something Cowork has not decided.

**The Deduction Hangs Rule.** C3 is deduction-only. It renders filling *downward* from the top of the band while C1, C2, and C4 fill upward from the baseline. Direction carries the semantics, so a large deduction can never be misread as a strong result.

## Typography

**Display / Body / Label Font:** Geist (with `system-ui`, `-apple-system` fallback)

**Character:** One neo-grotesque doing every job, differentiated by weight and tracking rather than by family. Light weights at display sizes with tight negative tracking (`-0.035em`) give the deck its premium, drawn-not-typed feel; mid weights at small sizes keep dense data legible. A second family would be decoration — this system has exactly one voice and spends its variety on scale.

### Hierarchy

- **Display** (300, `clamp(2rem, 4.2vw, 3.25rem)`, 1.02, `-0.035em`): Greeting and the composite score figure. One per view.
- **Headline** (350, `clamp(1.5rem, 2.4vw, 2.125rem)`, 1.1, `-0.03em`): A person's name on a slab card.
- **Wordmark** (500, 17px, 1, `-0.03em`): The lowercase `cowork` logotype beside the mark, and nowhere else. It sits deliberately two points above Title so identity outranks navigation in the same pill without needing a weight change.
- **Title** (500, 15px, 1.3, `-0.012em`): Navigation, panel headings, task names, control labels.
- **Figure** (400, 22px, 1, `-0.025em`, tabular): Every number that is a value rather than prose. Always tabular.
- **Figure Large** (400, 28px, 1, `-0.03em`, tabular): The headline number in a metric-strip cell — the Tasks overview strip and any surface where four or six figures are meant to be compared across a row at a glance. Added in the density correction: at Figure size the strip read as a caption row, and at Headline size the figures competed with the page title. It is a *figure* step, not a heading step, so it never carries prose.
- **Body** (400, 14px, 1.5, `-0.008em`): Prose and list content. Measure capped at 68ch.
- **Caption** (400, 12px, 1.35): Metadata, column headers, secondary stat units.
- **Label** (450, 11px, 1.2, `0.09em`, uppercase): The single tracked kicker in the greeting row, and nothing else.

### Named Rules

**The One Kicker Rule.** Uppercase tracked type appears exactly once per view as a *wayfinding* device, and is otherwise the label of a **metric cell** — a figure's name, not a section's name. A tracked eyebrow above a panel, a list or a form is a defect: those get Title. The distinction is that a metric label is part of a figure and is read with it, while a section eyebrow is decoration standing in for a heading.

**The Tabular Rule.** Every figure carries `font-variant-numeric: tabular-nums`. Numbers in this product sit in columns and change in place; proportional digits make them jitter.

## Layout

A 12-column grid inside a `max-w-[1360px]` container with `clamp(12px, 3vw, 32px)` gutters. The deck is desk-first: the primary composition assumes 1280px and above.

Vertical rhythm runs on the spacing scale (4 / 8 / 12 / 16 / 24 / 32 / 48). Headings take more space above than below: a panel heading sits on `20px` of panel padding above and `12px` below, and a section heading takes `32px` above. Panels group by proximity rather than by rule lines.

**Responsive behavior.** Three states, not five:
- **≥1180px** — full deck. Centered navigation, hero slab at 8 columns with a 4-column companion stack beside it, wide panels below.
- **768–1179px** — navigation collapses to a sheet behind a menu control; the companion stack drops beneath the hero slab; the hero slab spans full width.
- **<768px** — single column. Slab chips wrap beneath the name, stats drop to two columns, and the component band shows channel codes without their labels once a column falls under ~78px. The ambient score pill never hides at any width; the inbox control gives up its place in the bar instead.

**The people strip** is a horizontal scroll-snap rail at every breakpoint. Its neighbors bleed off both edges deliberately — the strip must never resolve into a tidy grid, because the bleed is what communicates that a roster continues.

## Elevation & Depth

Depth comes from **an opaque deck laid on a live ground**, not from a shadow scale and no longer from translucency. The field is the ground; the deck is a set of solid surfaces resting on it; the chrome is seen **around and between** those surfaces, at full strength, in real negative space.

This is a reversal, and it is worth stating why. The system previously made every panel 20–28% transparent so the field would show *through* it. That is what put text on drifting colour, and it is also why nine panels read as one repeated object: they were all the same sheet of glass. Solid surfaces let the field be *more* present, not less, because the gaps between bands are now genuinely the field rather than a wash under everything.

`backdrop-filter` survives at `6px` — enough to soften the edge where a surface meets moving colour, not enough to be a see-through effect. A surface that depends on translucency to look like anything has not been designed.

Shadows exist only to seat a surface on the ground, and every one carries a real vertical offset — the system has no zero-offset halos.

### Shadow Vocabulary

- **Slab seat** (`box-shadow: 0 18px 40px -12px rgba(10,10,10,0.28)`): Under a dark slab card, to lift it off the deck.
- **Band seat** (`box-shadow: 0 2px 10px -4px rgba(10,10,10,0.16)`): Under a solid band on the ground. Shallower than the old deck seat, because an opaque surface no longer needs a shadow to prove it is a separate object — its edge already does that.
- **Deck seat** (`box-shadow: 0 8px 24px -10px rgba(10,10,10,0.14)`): Retained for the top bar.
- **Slab silhouette** (`filter: drop-shadow(0 16px 34px rgba(10,10,10,0.26))`): Applied to the *wrapper* of a stepped card, because a composed silhouette cannot cast a correct `box-shadow`. This is the only place `filter` is used for depth.

### Named Rules

**The Look-Through Rule** *(rewritten — the field is kept, the glass is not)*. The chrome field is seen **around and between** the deck, never **through** a surface that carries text. Its presence is measured in the negative space a composition leaves it — margins, band gaps, the gutters either side of the content column — not in how much of it bleeds up through a panel.

The rule used to read "every frosted surface must have something visibly moving behind it", which made translucency compulsory and made the field a backdrop for body text. Both consequences were wrong. The field is the product's signature and stays at full strength; the surfaces stop borrowing from it. A band that would look like nothing without the chrome showing through it is a band with no material of its own — fix the material, do not thin the surface.

**The Field Is Not A Text Surface Rule.** The chrome field is the back layer. Text sits on the *deck* — a frosted panel or a slab — never directly on the field, with one exception: a page title in full-strength ink.

This is a contrast rule before it is a compositional one, and it was found by measuring rather than by computing. The field is `position: fixed`, so the backdrop under any given text run **changes as the page scrolls**. Sampling the composite under the mauve, slate and deep blobs gave `ink-faint` at 2.98:1 and `ink-muted` at 3.42:1 against the flat body's nominal 4.10 and 4.71 — and where those three blobs overlap, even full ink falls to ~5.3:1. No secondary token in the system survives there, and no re-tuning of the field can rescue one: a ratio that varies with scroll position cannot be certified at all. The fix is therefore **geometry, not colour** — which is why the field can be, and is, restored to full intensity. Nothing composites over it any more.

Consequences, and they are enforceable: **`ink-faint` is a panel-only token.** On the field, secondary text takes `ink-muted` at Body size or larger, and anything smaller moves onto a surface. A caption, a disclosure or a footnote floating on the field is a defect — which is why the dashboard's provisional disclosure lives on the score line beside the figure it qualifies, rather than as an 11px line at the bottom of the page.

**The Field Needs Edges Rule.** The chrome field is built from hue blobs *plus* a specular layer of hard highlight and shadow bands (`repeating-linear-gradient`, `overlay` blend, lightly blurred). Blur stays at ~46px; past roughly 60px the six hues average into one achromatic haze, and frost over a haze has nothing to distort — which makes the deck read grey and fails the rule above. The field is the one place in Cowork where contrast is the point.

## Shapes

Two silhouettes, and the difference between them is meaning.

**The stepped slab** is the signature. Its top edge sits high across the left portion of the card, then steps down through a convex radius and a concave fillet to a lower top edge on the right. The tab is where identity lives — an avatar, a mark — and the step exists to make room for it.

Two sizes, settled by the first build. **Hero:** step at **71%** of the width, tab rising **72px**, corners and inner fillet at **28px**. **Compact** (a card in the people rail): step at **64%**, tab rising **52px**, corners and fillet at **22px**. The proportions hold at every width — the hero silhouette reads correctly down to 390px without moving the step, so there is no breakpoint variant.

It is composed from a body with two pseudo-elements — a tab and a radial-gradient fillet at the junction — never from a fixed `clip-path`, so it holds its true corner radii at any size.

**The band** is an ordinary rectangle at **8px**. Secondary information gets no silhouette; the step is earned by content that carries identity or measurement.

**The radius hierarchy is four levels and it means something.** Radius encodes scale, not decoration: the larger the object, the softer its corner, and nothing borrows a radius from a level it does not belong to.

| Level | Radius | What it is |
|---|---|---|
| **Shell** | `0` | The top bar and the page frame. The deck meets the viewport; it does not float in it. |
| **Band** | `8px` | A major surface — a masthead, a score line, a register, a supporting column. |
| **Control** | `5px` | Buttons, inputs, selects, segmented controls, menu rows. |
| **Tag** | `3px` | Status tags and count markers. The smallest object gets the sharpest corner. |

**The capsule is retired**, with one exception: an avatar, because a face is a circle. A fully rounded rectangle reads as a toy at small sizes and as a lozenge at large ones; it was applied to 109 elements and had stopped distinguishing anything. Buttons, chips, tabs, pills, popovers, search fields and segmented controls all move onto the control or tag step.

### Named Rules

**The Earned Step Rule.** The stepped silhouette is reserved for a card about an entity that carries **both an identity and a measurement** — a *person*, a *score*, or a *project*. A task list, a goal list, a folder and a settings group are frosted rectangles. If everything steps, the step means nothing and the deck reads as novelty.

*Extended in the density correction.* The rule originally said "a person or a score", and on that reading I rejected the stepped project card in `Task_overview` and lost the reference's whole composition. Re-reading the file, the project card there is the same silhouette Cowork already owns: a raised tab holding a circular monogram, over a body carrying a measurement. A project has an owner, a monogram, a progress figure and a health state — it satisfies the same test a person does. The step stays scarce because the test is unchanged; only my reading of what passes it was wrong. Projects use **compact** geometry, never hero: hero is one per view and belongs to the person the view is about.

## Components

### Navigation

- **Style:** A single **docked bar, `44px` tall, square-cornered, spanning edge to edge**, holding the mark at left, links centred, and controls at right. It sits flush to the viewport top under a hairline. It was a 60px floating pill with a gutter above it; at that weight the chrome outranked the work, which is the opposite of what an all-day tool should do.
- **Opacity floor:** The bar is sticky and slabs scroll beneath it, so its frost sits at `0.94` alpha — nearly opaque, which is also what the reference's own bar does. Below roughly `0.9` the composite over `#262626` drops idle links under 4.5:1 and lets C1/C2 channel colour bleed through the navigation, breaking The Four Channels Rule as well as contrast. The panels stay at `0.80` and genuinely translucent; the bar is the one frosted surface that reads as solid, because it is the only one with arbitrary content passing under it.
- **Open state:** The sheet renders inside the `<nav>`, so the radius relaxes to `30px` while open. `rounded-full` on a tall box is an ellipse that clips its own contents.
- **Typography:** Title (500, 15px).
- **States:** Idle `#5c5c5c`; hover raises to `#0a0a0a`; active is `#0a0a0a` over a **2px underline in ink**. The filled active pill is gone with the rest of the capsules — in a bar this slim a filled pill is a lozenge, and an underline states position without adding a shape.
- **Mobile:** Below 1180px the links move into a sheet that expands beneath the bar, retaining the pill treatment per row.

### Lens Toggle (signature component)

The Private / Team switch is the most semantically loaded control in Cowork: it is the boundary between what an individual may see and what a manager may see. It is a two-segment pill on a light track; the selected segment is a solid `#0a0a0a` pill with white text, the unselected is muted ink on transparent.

It is a `radiogroup`, not a checkbox — the two lenses are named alternatives, and the control must announce which lens is active. It always carries a visible label; an unlabeled icon toggle here would hide a privacy boundary behind a glyph.

### Slab Card (signature component)

- **Silhouette:** The stepped slab (see Shapes).
- **Background:** Measurement Slab (`#262626`), with an `inset 0 1px 0 rgba(255,255,255,0.08)` highlight on **both** the tab and the body, so the lit top edge runs continuously across the whole stepped profile. Lighting only the tab leaves the lower edge dead and the step reads as a seam.
- **Shadow:** Slab silhouette, on the wrapper.
- **Padding:** `24px`, with the content column offset below the tab.
- **Recede:** The card supports a recessed state (`0.55` opacity, `0.97` scale, transitioned over 420ms) for browsing contexts. It is deliberately unused by the people rail — see The Comparison Reads Flat Rule.

### Named Rules

**The Comparison Reads Flat Rule.** In any view whose job is comparing people, every card renders at full strength. The reference this system is drawn from dims a carousel's neighbours, which is right for browsing and wrong here: greying four of five scores would make a manager's actual task harder to serve the look. The rail's silhouette and edge bleed carry the character instead.

### Component Band (signature component)

The C1–C4 band is Cowork's most distinctive data component. Four adjacent full-bleed columns share one baseline with no gaps between them, forming a continuous ribbon at the foot of a slab card. Each column carries its channel hue under a 3px halftone dot matrix (`radial-gradient` at `rgba(0,0,0,0.34)`), over a vertical gradient that lifts `rgba(255,255,255,0.14)` at the top and darkens to `rgba(0,0,0,0.30)` at the baseline, finished with an `inset 0 1.5px 0 rgba(255,255,255,0.34)` lit top edge. The gradient is what separates a screen-printed bar from a flat swatch; the dot layer sits above it so the screen gradates with the fill.

Every column also carries a faint `rgba(255,255,255,0.045)` full-height track. Without it a good C3 result — a near-zero deduction — renders as an empty column that reads as missing data rather than as a measured channel.

Below the ribbon, each column drops a `1px` leader hairline to a `6px` channel-hued dot, then states its code-and-label and its value as a Figure. C1, C2, and C4 fill upward; C3 hangs downward per The Deduction Hangs Rule.

**The Full Pairing Rule.** A channel always shows its code *and* its label — `C1 · Task Execution`, never `C1` alone and never `Task Execution` alone. This is a product constraint, not a style preference: the codes are existing organisational vocabulary and PRODUCT.md pins the pairing. Where a column is too narrow for one line, the label wraps to a second line; it is never dropped.

**Alignment.** The band is `items-stretch`, never `items-end`. Label blocks below the ribbon have different heights, and bottom-aligning the columns knocks all four tracks off their shared baseline.

Bars animate their extent once on mount with a staggered exponential ease-out, and render at full extent immediately under `prefers-reduced-motion`.

### Chips

- **Style:** Fully rounded. On a slab, `rgba(255,255,255,0.10)` with Slab Ink text. On the frosted deck, `rgba(10,10,10,0.06)` with Deck Ink.
- **State chips** (task states) are neutral by default. Three states carry a tint: `Rework` (neutral-warm `#b08a63`), `Extension requested` (neutral-violet `#8079a3`), and `At risk` (neutral-cool `#6f8296`). Per The Four Channels Rule none of these is a C1–C4 hue, and per the field rule above none is a field hue either. `On track` and `Done` stay untinted, because a tint on the normal case makes the exceptions invisible.

### Bands

- **Corner:** `8px`.
- **Background:** **Solid** — `rgba(240,240,242,0.97)` light, `rgba(26,26,31,0.95)` dark. Opaque enough that the surface has its own material and its own certifiable contrast at any scroll position.
- **Blur:** `6px`, for the edge only. Not a see-through effect.
- **Border:** A single top-inner hairline to catch the light, plus a `1px` outer ring in dark mode where the band sits on a dark ground.
- **Internal padding:** `14px 16px` — tightened from `20px 24px`. Density comes from padding and leading, not from shrinking type.
- **Rows:** Separated by hairlines, never by nested cards. **A band never contains another band.**
- **Never identical:** bands in one composition must differ in height, density or type scale. Four surfaces of the same size and weight read as one repeated object, which is the failure the Ledger composition exists to correct.

### Named Rules

**The Unequal Bands Rule.** A composition of stacked surfaces must vary them. If every band is the same height with the same internal grammar, the page has no hierarchy and the eye has nowhere to land — it reads as a grid of cards no matter what radius they carry. Primary, secondary and supporting must be distinguishable with the text removed.

### Icons

One set, `16×16` viewBox, `1.5` stroke, round caps and joins, `currentColor` only. Icons never carry colour of their own — a coloured icon in Cowork would read as a score channel. They exist because a seven-item tab bar and a dense row-action menu are materially faster to scan with a leading glyph.

**Concept mapping.** Every primary concept in the product owns exactly one glyph, and no two are near-neighbours. The pairs most at risk of collision are listed with the thing that separates them.

| Concept | Glyph | Built from | Kept distinct from |
|---|---|---|---|
| **Employee** | `user` | One circle head over one shoulder arc. Nothing else. | **Team** — Employee is unmistakably *one* person. |
| **Team** | `team` | Two heads, one full shoulder arc plus a partial second. | **Employee** — plainly plural at 16px; **Meeting** — no table edge. |
| **Task** | `tasks` | Two checkmark-plus-line pairs: a checklist. | **Approvals** — no enclosing circle. |
| **Project** | `projects` | A rounded container holding one tall column and three stacked lines: a compact project board. | **Folder** — no tab, and it has internal structure; **Employee** — no figure at all; **Board** — enclosed rather than three free columns. |
| **Folder** | `folders` | A rounded body with a *raised tab* along its top-left edge. | **Project** — the raised tab is the entire difference, and it is at the silhouette level rather than inside the shape. |
| **Goal** | `goal` | Concentric circles with a centre dot: a target. | **Approvals** — no check inside; **Flag** — flag marks a milestone reached, goal marks a target set. |
| **Meeting** | `meeting` | Two heads above a single table edge running the full width. | **Team** — the table edge; **Calendar** — no grid. |
| **Message** | `chat` | A rounded speech bubble with a tail at the lower left. | **Send** — send is a paper plane, an action rather than an object. |
| **Score** | `score` | Four bars of ascending height on a shared baseline — the C1–C4 band in miniature. | **Board** — bars, not enclosed columns; and score's bars differ in height, which is the point. |
| **Attendance** | `attendance` | A calendar grid with a check mark inside the body. | **Calendar** — plain calendar means "a date"; the check means "a day marked present". |

**Named rule — The One Glyph Rule.** A concept has one glyph and a glyph has one concept. Before adding an icon, place it beside `user`, `projects` and `folders` at 16px in both themes; if a reader would have to think, the icon is wrong, not the reader.

## Do's and Don'ts

### Do:

- **Do** stack the three materials in order — chrome field, frosted deck, dark slab — and make sure something is visibly moving behind every frosted surface.
- **Do** reserve the stepped silhouette for cards about a person or a score, and put identity in the tab. The step must be paying for something.
- **Do** keep saturated color to the four score channels, and give C3 the hanging-downward treatment so a deduction can never read as an achievement.
- **Do** render the four components as independent channels with independent baselines.
- **Do** set `font-variant-numeric: tabular-nums` on every figure.
- **Do** use one tracked uppercase kicker per view, in the greeting row, and separate everything else with hairlines and space.
- **Do** give the background field one slow orchestrated drift and let it be the only thing moving at rest.

### Don't:

- **Don't** stack, total, or proportionally size C1–C4 against each other. Their weights are an undecided product fact.
- **Don't** let a status, priority, or chart series borrow a C1–C4 hue.
- **Don't** apply the stepped silhouette to a task list, a goal list, or a settings group, and don't nest a card inside a card.
- **Don't** build the step with a fixed `clip-path` or a distorting `objectBoundingBox` SVG clip — the corner radii must stay true at every size.
- **Don't** ship a zero-offset colored halo as a shadow, or a frosted panel over a flat backdrop.
- **Don't** introduce a second type family, a serif, or monospace. Geist does every job; mono is not a costume for "technical" here.
- **Don't** underline navigation or use a colored left border on rows, cards, or callouts.
- **Don't** frame any part of this product as AI-driven — that is a binding product constraint, and it extends to labels, empty states, and microcopy.

---

## Themes

Cowork ships **light, dark and system**. Dark is not an inversion, a token swap, or a white-to-black replacement — it is a separately tuned build of the same three materials. The rule that governs every decision below:

> **The Material Order Rule.** Field → frosted deck → measurement slab, in that order, in both themes. What changes between themes is the *values* each material takes, never their order and never their relationship. The slab is the most present material in both, and it earns that by being the deepest surface carrying the brightest content — which in light mode means darker than the deck, and in dark mode means darker still.

### Shared across both themes

Everything non-colour: the type ramp, the spacing scale, radii, the stepped silhouette geometry, motion curves and durations, the 12-column grid, and the three responsive states. A theme switch must never move a single pixel of layout.

### Surface hierarchy

| Level | Light | Dark | Why they differ |
|---|---|---|---|
| Body / field base | `#cfcfcf` / `#b9b9bd` | `#0c0c0e` / `#17171b` | — |
| Frosted panel | `rgba(232,232,234,0.80)` | `rgba(32,32,37,0.72)` | Dark runs *more* translucent so the field still reads through it. The Look-Through Rule holds in both themes. |
| Frosted bar | `rgba(248,248,250,0.94)` | `rgba(24,24,28,0.92)` | Near-opaque in both — it is the one frosted surface with arbitrary content passing under it. |
| Measurement slab | `#262626` | `#121215` | Dark goes *below* the deck rather than above it, preserving the light-mode relationship instead of mirroring it. |

### Text contrast

Measured against the **rendered composite**, never the flat token. The frosted panel is translucent, so its effective background is its own value blended with the field behind it.

| Role | Light | on composite | Dark | on composite |
|---|---|---|---|---|
| Ink | `#0a0a0a` | 17.4:1 | `#f1f1f3` | 13.2:1 |
| Ink muted | `#565656` | 5.4:1 | `#a9a9b0` | 6.1:1 |
| Ink faint | `#5f5f5f` | 4.7:1 | `#9a9aa2` | 5.0:1 |
| Slab ink | `#f5f5f5` | 12.6:1 | `#f7f7f8` | 16.8:1 |
| Slab ink muted | `#949494` | 4.99:1 | `#9e9ea6` | 6.6:1 |

Never apply an opacity fraction to a muted value. Both muted tokens sit close to the 4.5:1 floor by design, and any fraction of them fails.

### Borders, hairlines and lips

| Token | Light | Dark | Note |
|---|---|---|---|
| Hairline | `rgba(10,10,10,0.12)` | `rgba(255,255,255,0.11)` | Tint flips; weight does not. |
| Frosted lip | `rgba(255,255,255,0.45)` | `rgba(255,255,255,0.08)` | **Drops hard in dark.** A 45%-white lip on a dark ground is a glowing outline — the exact "neon border" failure to avoid. |
| Slab lip | `rgba(255,255,255,0.08)` | `rgba(255,255,255,0.14)` | **Rises in dark**, plus a `0.06` ring, because the slab now sits below the deck and needs an edge to stay separate. |

### Elevation

Light gets real shadows because there is somewhere for them to fall. Dark gets almost none — depth comes from the lit top edge and the blur instead, because a heavy shadow on a dark ground reads as a smear rather than a lift.

| Token | Light | Dark |
|---|---|---|
| Deck seat | `0 8px 24px -10px rgba(10,10,10,0.14)` | `0 8px 24px -12px rgba(0,0,0,0.70)` |
| Slab seat | `drop-shadow(0 16px 34px rgba(10,10,10,0.26))` | `drop-shadow(0 14px 30px rgba(0,0,0,0.55))` |

### Interaction surfaces

Light tints with **black**, dark tints with **white**. Hover reading as "pressure into the surface" is a light-mode idiom; on a dark ground the same gesture must lift.

| Token | Light | Dark |
|---|---|---|
| Control | `rgba(10,10,10,0.06)` | `rgba(255,255,255,0.08)` |
| Control hover | `rgba(10,10,10,0.10)` | `rgba(255,255,255,0.13)` |
| Control active / selected | `rgba(10,10,10,0.14)` | `rgba(255,255,255,0.18)` |
| Sunken | `rgba(10,10,10,0.04)` | `rgba(0,0,0,0.24)` |

A selected table row uses **control active** in both themes. It must be unmistakable at a glance in a dense table — this is the single most-checked interaction state in the product.

### The four channels

The hues are semantically load-bearing and their **hue angle never changes**. Lightness lifts slightly in dark so C3 magenta does not sink into a near-black slab.

| Channel | Light | Dark |
|---|---|---|
| C1 · Task Execution | `#00b26b` | `#10c47c` |
| C2 · Goal Attainment | `#c3d02e` | `#cfdc3c` |
| C3 · Conduct & Policy | `#c22a9e` | `#d94ab4` |
| C4 · Attendance | `#8e8e8e` | `#a2a2a9` |

**The halftone screen inverts.** Light lays `rgba(0,0,0,0.34)` dots over the channel fill; dark lays `rgba(255,255,255,0.16)`. A black screen over a near-black slab is invisible, and losing the screen loses the screen-printed character the band depends on.

### Status colours

Six state washes, none of which borrows a C1–C4 hue or a field hue. Each pairs a wash with an ink value tuned per theme, so a tinted chip holds ≥4.5:1 in both.

| State | Light wash / ink | Dark wash / ink |
|---|---|---|
| At risk | `#6f8296` / `#2f3d4a` | `#7c93aa` / `#cfe0ef` |
| Rework | `#b08a63` / `#5b3b1f` | `#c79a6d` / `#f4e2ce` |
| Extension | `#8079a3` / `#3d3757` | `#9a92c4` / `#e3dffa` |
| Blocked | `#97706e` / `#532f2d` | `#b58582` / `#f7dedc` |
| Overdue | `#a35f5f` / `#5a2626` | `#c47575` / `#fbdcdc` |
| Positive | `#5f8a72` / `#24422f` | `#74a88a` / `#d8f0e2` |

The ink values **invert direction** between themes — dark on a light wash, light on a dark wash. A chip whose text stayed dark in dark mode would be the classic muddy-disabled-state failure.

Destructive actions use the **overdue** wash rather than a saturated red. A red button in this system would read as a fifth channel colour.

### Tables and dense data

- Rows separate with hairlines, never boxes or zebra striping.
- Selected row: **control active**. Hover: **control hover**. Both must be distinguishable from each other and from the resting row in both themes.
- Column headers use Label type (11px, `0.09em`, uppercase) in ink-faint.
- Every figure is tabular.
- Dense scroll regions keep a **visible** thumb (`.scroll-slim`). The `.rail` treatment that hides scrollbars is reserved for bleed rails where the bleed itself signals continuation.

### Forms

- Inputs use **surface-raised** with a hairline inset ring, not a border.
- Focus thickens the ring to `1.5px` of deck ink — no glow, no colour shift.
- Placeholder text is ink-faint; it never carries meaning.
- Errors are stated in the state-overdue ink beneath the field, with `role="alert"`.

### Charts

- Series for C1–C4 use their channel hues. **Every other series is neutral ink.**
- Gridlines: `rgba(10,10,10,0.10)` light, `rgba(255,255,255,0.10)` dark.
- The plot ground stays transparent so the field reads behind it.
- The No Weighting Rule applies to charts too: four independent lines, never stacked, never an area chart, never summed.
- The Deduction Hangs Rule applies: C3 plots below a zero rule or on an inverted axis.

### Skeletons and empty states

Skeletons shimmer between **control** and **control hover**, so the animation is visible in both themes — a white shimmer on a light deck is invisible and a black one on a dark deck is a hole. Text-line skeletons take the pill radius; block skeletons take the inset radius. Nothing invents a radius.

### Theme switching

- Preference persists in `localStorage` under `cowork-theme`.
- A blocking inline script in `<head>` resolves and applies the theme **before first paint**, so there is no flash.
- `<html>` carries `suppressHydrationWarning` because that script legitimately changes the attribute set before React hydrates.
- The colour transition (`180ms`) is added one frame *after* mount via a `theme-ready` class, so it never runs during the initial paint.
- The transition covers `background-color`, `border-color` and `color` only. The field is explicitly excluded — animating a blurred 46px gradient stack is expensive and reads as a smear.
- Under `prefers-reduced-motion`, all of it collapses to near-zero.

### Named Rules

**The Separate Tuning Rule.** A theme-specific value is legitimate whenever identical values would cost usability. Frosted-lip opacity, shadow depth, halftone-screen polarity, channel lightness and every status ink pair are all intentionally different. Do not "unify" them.

**The Both Themes Rule.** A component is not complete until it has been read in both themes. Specifically check: selected rows, disabled controls, focus rings, tinted chips, chart gridlines, modal backdrops, and skeletons — these are where an untuned theme fails first.
