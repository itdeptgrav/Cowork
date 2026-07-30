---
target: the dashboard, its layout structure and all
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-07-25T15-28-03Z
slug: components-home-home-tsx
---
Method: dual-agent (A: a8f4ab0c8e247d9b0 design review · B: a81683126d759dc4c detector + browser evidence), run sequentially, neither shown the other's output.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Skeletons, delta arrows and a live "Running now" sub-label all present; clean load with zero console errors and 21/21 successful requests. But `ScoreSummary` mounts the C1–C4 ribbon, the provisional chip and the biggest-event pill conditionally on `data`, so the hero card reflows ~56px three times after load. |
| 2 | Match System / Real World | 2 | `C3 · Conduct & Policy` reads `−20%` and `0.8 / 1.0 pts` at once — one says "you lost", the other "you earned 80%". `↓15 vs last period` asserts a scoring period PRODUCT.md lists as undecided. `Compensation review · 0% · 0/0 tasks` renders "not started" as failure. |
| 3 | User Control and Freedom | 2 | The lens is `useState` only — no URL param, no persistence. A manager cannot bookmark, share or refresh into the Team view. Nothing on the page is sortable, filterable or dismissible; `AttentionPanel`'s order is a hard-coded array. |
| 4 | Consistency and Standards | 2 | H1 and H2 are byte-identical (`text-[15px] font-medium tracking-[-0.012em]`); Home is the only route in the product without the 28px `PageHead`. Seven phrasings of the same "see all" link. Goals separates rows with `space-y`, its two neighbours with hairlines. Offset by a genuinely uniform token/component layer — the deterministic scan is clean across ~30 files. |
| 5 | Error Prevention | 2 | The summary strip's only alert affordance is a colour swap on the figure (`#5a2626` maroon). No icon, no weight change, no label change — "Overdue 1" and "Blocked 0" are near-indistinguishable. Zero-vs-no-data is unresolvable: a report with no tasks renders `C1 0% · 0.0/0.0 pts`, which reads as "failed everything". |
| 6 | Recognition Rather Than Recall | 3 | Labels are explicit, `C1 · Task Execution` pairing honoured, heading outline clean (one h1, eight h2, no skipped levels). But the slab's most prominent pill reads `+1 Document every score component surfac…` with no label saying what it is, truncated at every width including 1440. |
| 7 | Flexibility and Efficiency | 1 | 41 focusable elements in `<main>`, zero keyboard shortcuts, no density control, no saved layout, nothing dismissible. All 9 `<section>`s lack an accessible name, so they are not exposed as landmarks — even landmark navigation cannot shortcut a panel. Worst row on the table for an all-day desk tool. |
| 8 | Aesthetic and Minimalist Design | 3 | The material system is disciplined and genuinely distinctive. It loses points for ~590px of ragged void across three bands (measured Δ167 / Δ114 / Δ84), the score appearing twice in one viewport, and "Logged today 3h 3m" appearing three times. |
| 9 | Error Recovery | 2 | `ErrorState` with retry is wired into `TasksPanel` only. `AttentionPanel`, `ProjectsPanel`, `GoalsPanel`, `WeekPanel`, `AgendaPanel`, `MilestonesPanel`, `LoggedTodayPanel` and `ScoreSummary` destructure only `data`/`isLoading` — a failed fetch renders an empty state that lies ("No goals set") with no retry. |
| 10 | Help and Documentation | 2 | The provisional-rules link is good. But `title` attributes are the only explanation of the privacy boundary (invisible to touch and to most screen readers), and nothing explains what a "scoring unit" is or what "27 possible points" means. |
| **Total** | | **22/40** | **Acceptable — significant improvements needed** |

## Design Specificity Verdict

**The design system is unmistakably Cowork's. The dashboard composition mostly is not — and the one element carrying all the specificity is currently asserting a product opinion the product has explicitly refused to form.**

Own-world and unliftable: the stepped slab plus the C1–C4 halftone ribbon with C3 hanging downward; the Private/Team lens as a composition switch rather than a filter; the `Provisional rules` chip and footnote.

Category-interchangeable, by name: the six-cell summary strip (delete "Cowork" and this is Jira, Linear, Asana, Monday); `TasksPanel`; `ProjectsPanel`; `GoalsPanel` — which is the C2 evidence surface and should be the *least* generic panel on the page; `AgendaPanel`; `WeekPanel`, which is C4 evidence rendered as a generic HR widget.

The deeper failure: the product thesis is "working and being measured are one surface." The layout renders them as two surfaces stacked — the slab measures, eleven panels work, and nothing crosses. Not one row anywhere says *this task moved your score*.

**Deterministic scan:** `detect.mjs --json` over `components/home`, `components/shell`, `components/ui`, `app/page.tsx`, `app/layout.tsx` returned `[]` with **exit 0** — genuinely clean, verified with a canary file that correctly returned `bounce-easing` and exit 2. No suppression config exists. The static scan is structurally blind to computed font size, painted contrast and rendered geometry, which is where every real finding lives.

**Browser overlay (injected `detect.js`, both lenses):** Private lens surfaced 4 anti-pattern nodes — `tiny-text` ×3 (11px), `low-contrast` 4.1:1 (needs 4.5:1), `line-length`. Team lens surfaced only `overused-font`/`single-font` on `body`. Live server on port 8400 was started, injected and stopped (`kill 61132`, confirmed dead).

## Overall Impression

The visual language is the best thing here and it is not the problem. The problem is that the composition never commits: three bands with three different column rhythms, six ragged voids totalling ~590px, eleven panels at identical visual weight, and 41 undifferentiated ways forward. The single biggest opportunity is not styling — it is that the score card publishes an arithmetic breakdown that says attendance is worth 18 of 27 points and task execution is worth 1.

## What's Working

**1. The C1–C4 component band is genuine invention.** Four independent baselines with C3 filling downward means a large deduction is structurally incapable of reading as a strong result — the semantics live in the geometry, not in a legend. Combined with the halftone screen it reads as a screen-printed instrument face rather than a chart-library default.

**2. `AttentionPanel` is designed around actions, not metrics.** Every row is `[count] [queue] [example] →` linking to where the thing is resolved, and it models extension-requested, counter-to-answer, in-rework and deadline-to-decide as first-class queues. PRODUCT.md is emphatic that those are recorded events, not edge cases, because C1 depends on them. This is the only panel that takes that seriously.

**3. `ComparisonPanel` names the privacy boundary out loud** — "Visible only looking down the reporting chain" is the right sentence in the right place. Paired with a `radiogroup` lens that announces which mode is active, it treats a privacy boundary as a boundary.

**4. Accessibility fundamentals are better than expected.** All 6 `role="meter"` elements carry complete ARIA; all 3 `role="img"` have labels; the heading outline is clean with no skipped levels; a global `:focus-visible` outline applies with zero uncompensated `outline-none`; no horizontal overflow; dark theme passes contrast everywhere.

## Priority Issues

### [P0] The composite score is a flat pool across all four components, which substitutes an accidental count-based weighting for the one the product has not decided

**What.** `lib/scoring/engine.ts:250` computes the composite as `aggregate(units)` — one flat pool over every unit in every channel. Each unit is worth 1.0, so a channel's `possiblePoints` is just its unit count. Live values: C1 `1.0/1.0`, C2 `3.0/7.0`, C3 `0.8/1.0`, C4 `15.9/18.0`, summed and displayed as `20.73 of 27 points earned` in `ScoreSummary.tsx:84`, with the per-channel split printed under each ribbon column by `ComponentBand.tsx:131`.

This is not only a display defect. Pooling units means **attendance drives 66.7% of the composite because there are 18 attendance days**, and task execution drives 3.7% because there is one completed task. The weighting is emergent from data volume.

**Why it matters.** PRODUCT.md:87 — *"Do not display or imply a weighting split until they are [established]."* PRODUCT.md:107 — *"must not present a computed-looking breakdown that implies a weighting the product has not chosen."* DESIGN.md's No Weighting Rule — *"never draw them as slices of one total, never size them relative to one another."* All three are violated by the same figure. And PRODUCT.md:61 confirms real fixed weights are coming, so the current number is not merely ambiguous — it will be wrong.

Human cost: a designer who completed 100% of her task execution is shown 77%, with arithmetic on the card explaining that her actual job is worth 3.7% of her performance. In the Team lens both report cards resolve to attendance-only (`C1 0.0/0.0` on both), so a manager's comparison view is an attendance leaderboard labelled "performance."

**Fix.** Three parts. (a) Stop summing across channels: either surface the composite only once weights exist, or label it explicitly as an unweighted provisional pool at the point of display. (b) Remove `X / Y pts` from `ComponentBand` and `X of Y points earned` from `ScoreSummary`/`ScoreCard`; replace decomposability with per-channel *unit counts* ("measured across 14 tasks", "3 of 7 goals") plus a ledger link. (c) Keep the four channel percentages — those are per-channel and assert nothing. The existing `7 deductions · 5 credits` already does traceability correctly, by events rather than by points.

**Suggested command:** `/impeccable clarify`

### [P1] Zero and no-data are visually identical, and the only alert signal is colour alone

**What.** Three instances of one class of defect. Report cards render `C1 · Task Execution 0%` with `0.0 / 0.0 pts` — "this person has no tasks" and "this person failed every task" render identically. `ProjectsPanel` renders `Compensation review · 0% · 0/0 tasks` with a 0% meter, and because a 0% meter has no fill, the `tone="overdue"`/`tone="risk"` health colour is invisible at exactly 0% — the case where health matters most. `SummaryStrip`'s alert is `text-[var(--state-overdue-ink)]` on the figure only: `#5a2626` at 22px on frost, with no icon, weight change or label change.

**Why it matters.** In a product that feeds compensation and promotion conversations, a manager mistaking "no data" for "scored zero" is a career-affecting misread with no recovery path. WCAG 1.4.1 requires that colour not be the sole carrier of meaning; here it is, on the dashboard's only at-a-glance "something is wrong" signal.

**Fix.** (a) When a channel has no measured units, render `Not measured` — a dashed track and em-dash figure, never `0%`. (b) `ProjectsPanel`: when `totalTasks === 0`, render `Not started` rather than a 0% meter. (c) Give the alert cell a second non-colour channel — a state-tone dot before the figure and a label change to `Overdue · needs action`.

**Suggested command:** `/impeccable harden`

### [P1] Three bands, three column rhythms, ~590px of ragged void

**What.** Measured at 1460px viewport. Band 1 is 5/7 with panel heights 426 and 593 — a **167px void** under the score slab. Band 2 is 5/4/3 with heights 299/199/185. Band 3 is 4/4/4 with heights 213/240/156. Bands 1 and 2 share interior edges at x=607/623; band 3's interior edges land at 493/509 and 951/967, aligning with nothing above them. Meanwhile Projects gets 5 columns (557px) for 3 rows and a 1px meter stretched across ~500px, while Next milestones gets 3 columns and truncates its rows.

**Why it matters.** In Operate mode the deck's job is to be scannable and to feel calibrated. In dark mode that 167px void is a black rectangle in the centre-left of the first viewport — the most conspicuous element on the page after the score itself. Ragged bottom edges on every band read as unfinished, which undermines the "premium instrument" claim more than any single component could. And the allocations are inverted: the panels with the most to say are the ones being squeezed.

**Fix.** (a) Make band 1 `items-stretch` and let the slab fill to 593px, spending the recovered 167px on the next meeting — which also lifts a time-bound commitment above the fold. (b) Re-allocate band 2 to 4/4/4 so all three bands share seams at x=499 and x=957, giving the page one vertical rhythm. (c) Apply `grid-auto-rows: 1fr` per band so bottom edges align.

**Suggested command:** `/impeccable layout`

### [P1] Light-mode contrast fails, and the iridescent field can drop it to ~3:1 anywhere on the page

**What.** Two `text-ink-faint` instances measure **4.10:1** against the flat body (`#5f5f5f` on `#cfcfcf`): the date "Saturday 25 July" (12px) and the page footnote (11px). Both fail 4.5:1, independently confirmed by the injected detector. Dark theme passes everywhere.

The larger finding: `body` is flat `#cfcfcf`, but a fixed `.field` layer paints six blurred radial blobs (opacity 0.55–0.9, `blur(46px)`, colours from `rgb(242,230,210)` to `rgb(71,76,89)`) beneath any text sitting on the page background. Because the layer is **fixed**, the backdrop under a given text run **changes as the user scrolls**. Modelling the falloff gives a composited range of **2.98:1 to 5.03:1** for `#5f5f5f`. Twelve distinct 11px classes exist on the page.

**Why it matters.** This is the exact gap DESIGN.md itself warns about — contrast figures are computed against tokens, not sampled from a render, and the field is precisely the thing that invalidates a token-level calculation. A ratio that varies with scroll position is not a ratio you can certify.

**Fix.** (a) Raise `--ink-faint` in light theme until it clears 4.5:1 against the *darkest* composited backdrop, not the flat body. (b) Stop using `text-ink-faint` at 11px on the page background — either lift those runs onto a frosted panel (which is opaque enough to be certifiable) or move them to `ink-muted`. (c) Sample real pixels from a render at several scroll positions and replace the computed table in DESIGN.md.

**Suggested command:** `/impeccable audit`

### [P2] The Team lens shows the manager's own figures under a team heading, and the lens does not survive a refresh

**What.** `LensContext.tsx:27` is `useState<Lens>("private")` — no URL param, no `localStorage`. Separately, `SummaryStrip` is lens-agnostic: it hard-codes `scope: "mine"` and `employeeId === "e-01"`. In Team lens the header reads **"Your team · overview"** and directly beneath it sits `Open 8 · Due in 48h 2 · Overdue 1 · Blocked 0 · To review 1 · Logged today 3h 3m` — all the manager's own counts, byte-identical to Private lens. The Team lens also drops the `Provisional rules` chip and the provisional footnote.

**Why it matters.** A manager who lives in Team lens re-selects it on every page load and cannot bookmark or share it. Worse, the strip is an IA lie: the largest, topmost figures on a page headed "Your team" describe one person, and a manager will read "Overdue 1" as one overdue item across the team. And the disclosure that these are provisional rules disappears exactly where the numbers describe someone else's career.

**Fix.** (a) Persist lens to `localStorage` and mirror to `?lens=team`. (b) Make `SummaryStrip` lens-aware — aggregate across `viewer.hierarchyIds` and relabel; if the aggregate is unavailable, hide the strip in Team lens rather than show personal figures under a team heading. (c) Carry the provisional chip and footnote into Team lens.

**Suggested command:** `/impeccable harden`

## Persona Red Flags

**Alex (impatient power user)** — 41 focusable elements in `<main>` and zero keyboard shortcuts; reaching "Logged today" costs ~40 Tab presses. All 9 `<section>`s lack an accessible name, so they are not landmarks and even landmark navigation cannot skip a panel. Nothing is sortable, filterable or dismissible — `AttentionPanel`'s order is the literal array order in `Panels.tsx:71-168`, and at 8+ queues it prints "1 more queue not shown" with no way to see it. The count column currently renders `1 1 1 1`, spending horizontal budget on zero information while pushing the identifying text into 11px `ink-faint`. Score appears twice in one viewport; "Logged today 3h 3m" three times.

**Sam (keyboard, screen reader, contrast)** — The 77% score slab, the product's entire premise, is a `<p>` with no heading and no region label; the heading list jumps from "Maya · overview" straight to "Needs you". The six-cell summary strip is six links in a bare `<div>` with no group label. Two `text-ink-faint` runs fail 4.5:1 in light mode and the field can drive that to ~3:1. Twenty of 41 interactive elements are under 44×44 CSS px, the worst being two **20×16 "All ›"** links, which are both undersized and non-descriptive as link text. `AttendancePanel`'s bars encode nothing true — `35m late` and `26m late` both render at `width: "88%"`, and the bar has no role and is not `aria-hidden`, so it is decorative clutter that also lies. The lens toggle — described in DESIGN.md as the most semantically loaded control in Cowork — is hidden below 640px into the hamburger sheet.

**The manager comparing reports (project-specific, from PRODUCT.md)** — The comparison is an attendance leaderboard: both report cards render `C1 0.0/0.0`, `C2 0.0/0.0`, `C3 0.0/0.0`, `C4 15.18/18.0` and `17.43/18.0`, so the entire 13-point gap between 84% and 97% is punctuality. Zero versus unmeasured is unresolvable. The same two people appear twice 300px apart — once as 320px stepped slabs, once as 12px rows with an 80px meter inside a 557px panel. The people rail leaves ~890px of empty deck and, with two reports, has no bleed and nothing to scroll, so the design system's own justification for the rail form does not apply. "Team task load" shows a `P8` rank on row 1 and no rank on the other five, and row 1 is assigned to the manager themselves.

## Minor Observations

- Detector-confirmed: `overused-font`/`single-font` (Geist) fires on `body`. **False positive** — DESIGN.md commits to one voice differentiated by weight and tracking. Dismissed.
- `line-length ~247 chars` on the footnote. **False positive** — the detector measures container width; the text wraps well before that.
- Six `divide-y` containers report an 8px inner overflow. **False positive** — the deliberate `-mx-2 … px-2` hover-bleed pattern, contained by panel padding, no page overflow.
- **Real bug found only by measurement:** `ComponentBand.tsx:114` uses `min-h-[2.5em] … min-[560px]:min-h-0`, but `min-[560px]` is a *viewport* query while the constraining dimension is the card's own width. At 1460px viewport the min-height is dropped while Team-lens cards render 61px label columns, so `C3 · Conduct & Policy` wraps to three lines and pushes its figure **15px below** the other three in both cards. The same root cause produces the 390px misalignment. This needs a container query or a taller unconditional reservation.
- `ScoreSummary` reflows three times on load — `{data && <ComponentBand/>}`, `{data?.hasProvisionalRules && <SlabChip/>}` and `{biggest && <Link/>}` all mount late. Reserve the space.
- `C3` reads in two directions at once: `−20%` and `0.8 / 1.0 pts`.
- The biggest-event pill truncates at every width including 1440, and carries no label saying what it is.
- `Deadline pending` and `to review` both use the neutral-violet `extension` wash, which DESIGN.md assigns to "extension requested" — three distinct C1 signals collapsed into one colour.
- Four state washes in four consecutive `Needs you` rows at 24–26% opacity establish no severity order.
- Panel padding differs inside band 1: `AttentionPanel` is `padded={false}` (rows at `px-4`), `TasksPanel` is `px-6` — an 8px optical misalignment down the shared right column.
- `AgendaPanel`'s notification rows are content-free: "Work submitted", "Deadlines shifted", "Approval needed" — no actor, no object, no timestamp.
- `Goals` lists a completed goal (`4/4 components`, full meter) as open, with no Done state.
- Below 560px the `pts` line is `hidden`, so the traceability the code comment argues for disappears exactly where the layout is hardest to read.
- Dark mode weakens the material argument: at `#121215` the measurement slab and the `rgba(32,32,37,0.72)` frosted panels read as nearly the same surface, so "measurement earns the darkest, most present material" is largely lost in the theme a desk-first audience most likely uses.
- Latent trait: `ThemeProvider` gates mount on `requestAnimationFrame`, so the theme toggle stays a skeleton in a background tab until first paint.
- Console and network are clean: zero errors, zero warnings, 21/21 requests at 200/304, one font file.

## Questions to Consider

1. If you deleted the score slab entirely, would this dashboard still be recognisably Cowork? Right now, no — which means the score is a widget *on* the dashboard, not the material it is made of. What would it take for a task row to carry its own C1 contribution inline?
2. Why does the dashboard have a composite score at all, when the score is already ambient in the top bar on every route? PRODUCT.md's point is that a person shouldn't visit a destination to find it — the slab makes Home that destination.
3. Is the dashboard blocked on a product decision rather than a design one? A decomposable score may require weights by definition. If so, the honest move is to stop decomposing until the weights exist.
4. Three bands, three column rhythms — was the 12-column grid ever a compositional decision, or only an arithmetic one?
5. `--breakpoint-deck` is 1180px, so a non-maximised Chrome window at ~1100px gets the phone stack. For a product whose stated context is all-day desk use, is that the right place for the cliff?
6. Would you show this dashboard to a person whose bonus depends on it? The card says she executed 100% of her tasks and scored 77%, and prints the arithmetic explaining why.
