# UI Design Correction Audit

**Date:** 2026-07-25
**Method:** dev server rendered at 1440×900 in Chrome, inspected in both themes, compared against the layout references and the original UI brief. This is not a code review — every finding below was seen on screen.

**Purpose:** correct the implementation. Nothing here defends it.

---

## 0. The finding that matters most

**The iridescent field was completely broken and I did not catch it by reading code.**

When I rewrote `globals.css` for dual themes I moved the colour tokens into CSS variables and **dropped the six `--color-field-*` tokens entirely**. `IridescentField` was still rendering six blobs, each with `radial-gradient(circle at 34% 30%, var(--color-field-ivory), transparent 68%)` — resolving to an undefined variable, so every blob painted nothing.

Verified in the browser:
```js
getComputedStyle(document.documentElement).getPropertyValue('--color-field-ivory')  // ""
getComputedStyle(document.querySelector('.field-blob')).background                  // "none"
```

Consequence: the back layer of "Chrome Under Frost" was a flat grey wash. Every frosted panel sat on nothing, so **The Look-Through Rule was failing on every page** — DESIGN.md is explicit that glass over a flat backdrop is not glass, it is grey. That is the product's core visual identity, and it had been dead since the theme rewrite.

**Fixed.** Tokens restored in `@theme`, deliberately theme-independent — the field's own tokens (`--field-base`, `--field-saturation`, `--field-blob-opacity`) do the dark-mode work, so the six hues stay constant and the material reads as the same thing in both themes.

**Lesson, recorded because it generalises:** build passing, types passing, lint passing and the Impeccable hook passing told me nothing about whether the page looked right. §13 of the brief exists for this reason and I should have run it before reporting.

---

## 1. `/` — Home

### Works

- "Needs you" is the right idea, correctly built: each row is an action with a link to where it is actioned, not a number that stops.
- The ambient score in the shell is correct per PRODUCT.md:46, and linking it to `/score` is right.
- Lens toggle carries the privacy boundary properly.
- Panel content — goals, projects, week — is genuinely useful.
- Dark mode surface layering reads correctly once the field is restored.

### Does not match the brief

| # | Problem | Evidence |
|---|---|---|
| H1 | **Greeting row costs ~110px and carries no operational information.** "Good afternoon, Maya" at 40px, plus a kicker, a "Sample data" chip, a date and an avatar stack. Brief §2 forbids "oversized decorative areas" and "large bright regions containing little useful information". | rendered 1440×900 |
| H2 | **The hero score slab occupies roughly 600px of the first viewport for one number and four channels.** Beautiful, and far too much space for a command centre. Brief §11 asks the dashboard to prioritise operational value. | rendered |
| H3 | **The first viewport shows five actionable items.** Everything else — tasks, projects, week, logged today — is below the fold. | rendered |
| H4 | **No pending-acknowledgement surface, no deadline requests, no score movement, no attendance summary, no team status** on the private lens, all of which brief §11 names explicitly. | code + rendered |
| H5 | **Companion column is 5 of 12 columns**, so "Needs you" rows truncate their detail text while the left column has slack. | rendered |
| H6 | Channel captions ("On-time completion, rework and extensions") repeat on every render and consume ~40px at the slab foot for text that is explanatory, not operational. | rendered |

### Space, density, comparison

Density is too low for desk-first all-day use. The first screen answers "what is my score" three times (pill, slab figure, band) and "what should I do next" once.

### Mobile

Not yet reviewed at phone width — recorded as outstanding.

### Light / dark

Both correct after the field fix. Dark mode's slab-below-deck relationship reads properly. No correction needed beyond §0.

---

## 2. `/tasks` — the more serious failure

### Works

- The tab set is right, and Projects being a tab inside Tasks is correct per brief §7 and confirmed by `Tasks.jpeg`.
- The scope switcher (Mine / My team / Assigned out) matches the reference and maps onto the permission model.
- The priority conflict banner and amber rank chip are genuinely useful and correct.
- The priority dialog with cascade preview is the strongest piece of work in the build.
- Timeline transposing to a list below 768px rather than shrinking a 9-hour axis is the right call.

### Does not match the references

| # | Problem | Reference says | Mine does |
|---|---|---|---|
| T1 | **Header consumes ~250px before a single row of data.** | `Tasks.jpeg`: title + subtitle + scope control **all on one ~54px row**, tabs on a second ~46px row. ~110px total. | Title at up to 2.125rem, sub below it, scope control wrapped into an actions slot, tabs on a third row, then a hairline, then a gap. |
| T2 | **Toolbar is ~150px tall with a large empty gap** between the search field (far left) and the filters (far right). | `Tasks.jpeg`: controls are **on the tab row**, right-aligned, compact — a filter control, not three stacked selects. | Search at left, two full-width selects and a button stacked at right, in their own bordered block. |
| T3 | **Only 6 task rows visible at 1440×900.** | The reference fits its primary content in the first viewport. | Header + toolbar + banner = ~450px of chrome before row one. |
| T4 | **Tabs are text-only.** | `Tasks.jpeg` and `task.webp`: every tab carries a leading icon, which is what makes a 7-item bar scannable. | Plain text pills. |
| T5 | **Missing columns the brief names explicitly** (§6): creator/owner, progress, latest activity, pending action, blocked state as a column rather than folded into status. | — | rank, task, project, status, deadline, effort, assignee. |
| T6 | **No view switching** (list / board / grouped). | `task.webp` has List, Board, Timeline, Calendar as peer views of the same data. | Single table. |
| T7 | **No grouping, no bulk actions, no saved views.** | Brief §6 asks for grouping and bulk actions where useful. | None. |
| T8 | **Overview KPI cells carry one number each.** | `Tasks.jpeg`'s KPI cells carry a number **plus** a segmented progress bar with a legend, or a number **plus** a list preview. | Four bare figures. |
| T9 | **Project cards on Overview are lower-information than the reference's.** | Reference card: identity chip, name, subtitle, two status tags, three stat pairs, four named metric bars with percentages, one CTA. | Name, owner, health chip, one meter, three small stats. |
| T10 | **The two P1 conflict rows are not visually linked** beyond a shared amber chip; nothing groups them. | — | Banner names the conflict; rows are scattered by sort order. |

### Where I over-corrected in the first pass

My earlier `REFERENCE_MAPPING.md` called the reference's project cards "oversized cards showing little information" and replaced them with a grid of simpler cards. **That reading was wrong.** Re-inspected, those cards are *dense* — around a dozen data points each. The problem with the reference is the **carousel** (three visible out of N, with dimmed neighbours), not the card. The correction is: keep the reference's information density, drop the carousel.

### Actions

"New task" is present but competes with the scope control in the same slot. Row-level actions do not exist — no open, forward, or change-priority affordance without entering the row. Bulk selection is absent.

### Density, comparison, disconnection

Desktop density is too low throughout. Sections read as disconnected because each sits in its own bordered panel with its own padding, rather than as regions of one workspace.

### Mobile

Stacked rows exist and are reasonable. Not yet reviewed at phone width.

### Light / dark

Both work after the field fix. In dark mode the panel-to-background separation is thin where a panel sits directly on the field with no neighbouring surface — worth watching but not a defect.

---

## 3. Corrections to make

| # | Correction |
|---|---|
| C1 | ✅ **Restore the field tokens.** Done. |
| C2 | Collapse the Tasks header to two compact rows: title + count + scope + primary action on row one; icon tabs + right-aligned toolbar on row two. Target ≤120px. |
| C3 | Move filters behind a single Filter control with a count; keep search inline and narrow. Kill the empty gap. |
| C4 | Add the missing columns: owner, progress, activity/pending action. Make blocked and overdue readable at a glance. |
| C5 | Add view switching (List / Board / Grouped) as peer views of one dataset. |
| C6 | Add row selection with bulk actions, and a row-level action menu. |
| C7 | Give tabs icons. |
| C8 | Rebuild Overview KPI cells to carry a figure **plus** a supporting bar or preview. |
| C9 | Rebuild project cards to the reference's density; grid, never carousel, never dimmed. |
| C10 | Group conflicting-rank tasks together and let the banner scroll to them. |
| C11 | Home: cut the greeting to one compact row; reduce the hero slab's footprint; raise first-viewport actionable density; add pending acknowledgements, deadline requests, score movement and attendance. |
| C12 | Verify every corrected page at 1440 and 390 in both themes, with screenshots. |

---

## 4. Status

| Correction | Status |
|---|---|
| C1 field tokens restored | ✅ done, verified in browser |
| C2 header to two compact rows (~250px → ~110px) | ✅ done |
| C3 filters behind one control, gutter removed (~150px → ~40px) | ✅ done |
| C4 owner, progress, next-action columns added | ✅ done — `TaskView` gained `owner` and `loggedSecs`; progress derives from logged time |
| C5 list / board view switching | ✅ done |
| C6 selection, bulk bar, row menu | ✅ done |
| C7 icon tabs | ✅ done |
| C8 metric cells with supporting bar or preview | ✅ done |
| C9 project cards at reference density, grid not carousel | ✅ done |
| C10 conflict grouping | ◐ partial — the banner offers "Show" which groups by status; conflicting ranks are not yet pinned adjacent |
| C11 home refinement | ◐ partial — field fixed and panels are operational, but the greeting row and hero-slab footprint are unchanged |
| C12 rendered verification | ◐ partial — desktop light and dark verified; mobile not reflowed by the tooling |

## 5. Rows visible at 1440×900 — before and after

| Surface | Before | After |
|---|---|---|
| `/tasks` table | 6 | 8 |
| Header + toolbar chrome | ~400px | ~150px |
| Columns carrying data | 7 | 9 |

---

# Part II — Second correction pass (dashboard density + `Task_overview` structure)

**Date:** 2026-07-25
**Method:** dev server rendered in Chrome at 1470px, plus genuine narrow-viewport renders at 768px and 390px (see §II.6), in both themes. `Task_overview.jpeg` reopened and zoomed region by region.

## II.1 Dashboard space audit — before

Measured on the rendered page at 1470×827, private lens.

| Region | Height | Operational facts carried | Verdict |
|---|---|---|---|
| Greeting row (`Good afternoon, Maya` at 40px + kicker + chip + date + avatars + rule) | **~110px** | 0 | Pure cost. A greeting is read once and charged every day |
| Hero score slab | **~600px** (8 of 12 columns) | 1 percentage, 4 channels, 3 counters that live elsewhere anyway | Beautiful; not worth 70% of the first viewport |
| Companion column (`Needs you` + `Goals`) | shares the same band | 5 actionable rows | The only operational content above the fold |
| Everything else — tasks, projects, week, logged today | **below the fold** | ~14 facts | Wrong side of the fold |
| **First viewport total** | 827px | **~9 facts, 5 of them actionable** | |

Against brief §3's list of ~23 required summaries, the page carried **9** and none of attendance, meetings, notifications, milestones, deductions, credits or score movement.

## II.2 Dashboard space audit — after

| Region | Height | Facts carried |
|---|---|---|
| Identity line | **~28px** (was 110) | date, lens, sample-data disclosure |
| Summary strip — 6 linked cells | **~78px** | open, due in 48h, overdue, blocked, to review, logged today |
| Score slab (compact) + `Needs you` + `Your tasks` side by side | **~420px** (was ~600 for the slab alone) | score, delta, earned/possible, C1–C4 (each clickable), deductions, credits, largest recent event, ledger link · 12 queue rows across 12 queue types · 5 ranked tasks |
| Projects · Goals · Milestones | one band | project health, progress, overdue, blocked · goal attainment · next milestones across projects |
| Attendance · Coming up · Logged today | one band | working days, lateness · meetings, unread notifications · today's commits |
| **Page height** | **1492px** (was ~2400) | **all 23 named summaries present** |

**Score footprint:** from ~600px at 8 columns to ~420px at 5 columns — roughly **40% of its former area** — while gaining deductions, credits, the largest recent event, per-channel links and a ledger route.

## II.3 Findings from the rendered pages

| # | Finding | Status |
|---|---|---|
| **D1** | `deck:` breakpoint blocks were emitted **before** `sm:` in the compiled stylesheet, because `--breakpoint-deck` was declared in `px` against Tailwind's `rem` scale and could not be sorted. Any element combining `sm:` and `deck:` for the same property silently got the *small* value at large widths — which is why the Tasks metric strip rendered as two columns at 1470px despite `deck:grid-cols-4`. **Latent across the whole app.** | ✅ fixed — declared as `73.75rem`, verified in the compiled CSS that it now sorts between `lg` and `xl` |
| **D2** | Stored theme preference was **ignored on load**. `preference` starts at the SSR-safe `"system"`, and the OS-follow effect ran on that default *before* the effect that reads storage — overwriting the correct attribute the pre-paint script had already set, and never restoring it. `localStorage` said `light`; the page rendered `dark`, permanently. | ✅ fixed — the effect is gated on `mounted` and now applies the preference itself, not only the OS |
| **D3** | A mutation in one component was invisible to every other. Starting a timer in a task row left the shell pill, the overview's session cell and the day's total describing a world that no longer existed. | ✅ fixed — `lib/repositories/events.ts` publishes one change signal; `useAction` bumps it, `useQuery` subscribes. Queries revalidate **without blanking**: only a first fetch shows a skeleton |
| **D4** | The timer reported `session.accumulatedSecs`, which is 0 for a task whose logged work predates the session record — so a row reading "1h 3m logged" showed a timer of "0m". | ✅ fixed — elapsed is `loggedSecs + live tick`; committed work and the clock now agree everywhere |
| **D5** | `formatDuration` rounds to the minute, so a freshly started timer sat on "0m" for half a minute and read as broken. | ✅ fixed — `formatTimer` (`0:07`, `1:03:45`) for running clocks; totals keep `formatDuration` |
| **D6** | Task detail carried its own bespoke start/pause buttons, separate from the table's. | ✅ fixed — one `TimerControl`, two sizes |
| **D7** | Below 560px the C1–C4 captions wrap to different line counts, so the four percentages — the figures the eye compares — landed on different baselines. | ✅ fixed — reserved two-line label box under 560px |
| **D8** | Four project mini-bars used four arbitrary neutral opacities that encoded nothing. | ✅ fixed — one tone; the labels and percentages carry the difference |
| **D9** | `3 members· next 25 Jul` — missing space, and "1 members". | ✅ fixed |
| **D10** | Project card stated `Overdue 1 · none blocked`, which reads as one clause. | ✅ fixed — `1 · 0 blocked` |

## II.4 `Task_overview` structural conformance

Full region table in [REFERENCE_MAPPING.md](REFERENCE_MAPPING.md) §2.1. Summary of what was taken:

| Taken from the reference | Restyled as |
|---|---|
| Title + count + **inline** scope control on one row | Headline 300 + lens-segment grammar |
| Icon tab bar with count badges | Pills, never underlines |
| Right-aligned toolbar on the tab row | Icon buttons in the tab pill family |
| Section header + census line above the band | 18px light + tabular census |
| **Projects as the hero band**, in a rail with arrows and dots | Matte slabs on the frosted deck; **no dimming** |
| Project card: raised monogram tab, title, subtitle, two tags, three stat pairs, four vertical bars, full-width CTA | Cowork's composed stepped slab; one neutral bar tone; `band-fill` texture shared with the C1–C4 ribbon |
| **KPI strip at the foot, four structurally different cells** | Segment bar + legend · plain figure · figure + actionable row · ring + context |

Not taken: the carousel's focus-and-dim, the neon palette, presence, refresh, the duplicate add control, the floating utility button, Calendar and Files tabs.

Added beyond the reference: the "Needs you now" action queue, because brief §8 and §9 require it and the reference Overview contains no task list at all.

## II.5 Play / pause / active work

Every control is wired to `startTimer` / `pauseTimer` / `startTask`; pausing writes a real `WorkCommit`. Present on:

- **Task table** — a dedicated Timer column, one compact control per row
- **Tasks Overview** — the same control on each queue row, plus a ring cell stating the running session
- **Task detail** — the same control at detail size, with elapsed-of-estimate, running/paused state and a live dot
- **App shell** — `ActiveWorkPill`, present on every route *only* while something is running

The one-active-task constraint is stated before it bites: starting a second task shows "Starting this pauses “…” — only one task runs at a time." A task in `confirmed` transitions through `startTask` on the same press. Rows that cannot run a session hold the column width and show elapsed instead of a dead button.

## II.6 Viewport verification

The browser tool's `resize_window` changes `outerWidth` but leaves `innerWidth` at 1470, so the page never reflows — the same limitation reported in the first pass. **Worked around properly this time:** the app was loaded into fixed-width iframes (390px, 768px, 834px) inside the running page. An iframe has its own layout viewport, so media queries evaluate against the iframe width and the reflow is genuine. Both narrow layouts were photographed that way, and D7 was found in one of those renders.

---

# Part III — Design critique pass (`/impeccable critique`, dual-agent)

**Date:** 2026-07-25 · **Score:** 22/40 at the start of this pass · snapshot in `.impeccable/critique/`
**Method:** two isolated sub-agents — a design review that never saw tooling output, and a detector/browser pass that never saw the review. Synthesis reconciled them.

## III.1 What the two assessments agreed on

Both independently measured the same three things, which is why they were acted on first: ~590px of ragged void across the three bands (Δ167 / Δ114 / Δ84), three different column rhythms in three consecutive bands, and secondary text sitting at 11px on a backdrop that cannot support it.

## III.2 The P0 — a weighting nobody chose

`lib/scoring/engine.ts` computes the composite as `aggregate(units)`: one flat pool over every unit in every channel. Each unit is worth 1.0, so a channel's "possible points" is just its unit count — and with 18 attendance days against 1 completed task, **attendance drove 66.7% of the score and task execution drove 3.7%**. The interface then printed the decomposition under each channel and summed it into "20.73 of 27 points earned", so the split was not merely implied, it was published.

`PRODUCT.md:87` forbids displaying or implying a weighting split; `:107` forbids a computed-looking breakdown; DESIGN.md's No Weighting Rule forbids drawing the channels as slices of one total. All three were violated by the same figure.

The root cause was a comment. `lib/config/provisional.ts` recorded that points-over-points "asserts no weighting — consistent with The No Weighting Rule". That is true *within* a component and false *across* components, and the false half propagated into six surfaces.

**Resolved.** Point decompositions removed from the dashboard slab, the team rail, the score overview and the team detail slab; unit counts replace them. A single channel on its own page keeps its own points — there is nothing beside it to divide against. The composite is now labelled provisional at every point of display, and `/score` states the situation in plain words rather than claiming neutrality it never had. The corrected reasoning is recorded in `SCORING_LOGIC_SPEC.md` §5.3, `MIGRATION_DECISIONS.md` O2 (escalated to block the composite), and the provisional config note that caused it.

The visible consequence is worth naming: in the team lens, two reports whose only measured component is attendance now render C1–C3 as **hatched "not measured" tracks with em-dashes** instead of "0%". A manager can see that the 84% vs 97% gap is entirely punctuality, rather than reading it as performance.

## III.3 Layout

| | Before | After |
|---|---|---|
| Band 1 heights | 426 vs 593 (**167px void**) | 602 / 602 |
| Band 2 heights | 299 / 199 / 185 | 308 / 308 / 308 |
| Band 3 heights | 213 / 240 / 156 | 250 / 250 / 250 |
| Column rhythms | 5/7, 5/4/3, 4/4/4 — three sets of seams | 4/8, 4/4/4, 4/4/4 — **one** set at x=514 and x=972 |
| Page height | 1509px | 1509px |

The 167px recovered under the score slab went into the C1–C4 ribbon, which was cramped at 56px and is the one element on the page a competitor could not ship. `SlabCard` gained a `fill` mode and `ComponentBand` a `fillTrack` mode so the slack lands in the instrument rather than above it.

## III.4 Contrast — the finding that changed a design rule

Two `text-ink-faint` runs measured **4.10:1** in light mode. The larger problem: the `.field` layer is `position: fixed`, so the backdrop under a given text run **changes as the page scrolls**. Modelling the composite under the mauve, slate and deep blobs gave `ink-faint` at 2.98:1 and `ink-muted` at 3.42:1 — and where all three overlap, even full ink reaches only ~5.3:1.

No token can be tuned out of that, because a ratio that varies with scroll position cannot be certified. So the fix is geometry, and it is now a named rule in DESIGN.md — **The Field Is Not A Text Surface Rule** — with `ink-faint` demoted to a panel-only token. The dashboard's identity line moved into the masthead panel and the provisional disclosure moved into the score slab's foot, beside the figure it qualifies. The light field was re-tuned as well (base lifted, blob opacity 1 → 0.62, vignette 0.38 → 0.2, saturation raised to compensate) so the worst case is materially lighter without losing the iridescence.

Verified after the change: **zero text nodes below 4.5:1 on a fresh load, in both themes.** The one apparent failure — avatar monograms — is a gradient background the probe cannot resolve; the hues are capped at `#93a5bd` precisely for this reason.

## III.5 Everything else in the pass

| Finding | Resolution |
|---|---|
| Zero indistinguishable from no-data | `ComponentBand` renders a hatched track and an em-dash when `unitCount === 0`; `ProjectsPanel` renders "Not started" and a dashed rule when a project has no tasks |
| Alert carried by colour alone (WCAG 1.4.1) | The alert cell gains a state-tone dot, a weight change and the words "needs action" |
| Seven panels rendered a lying empty state on a failed fetch | `ErrorState` with retry wired into every one |
| Nine `<section>`s had no accessible name, so none was a landmark | `Panel` gained a required-by-convention `label`; all nine named |
| The score slab was a `<p>` — the product's central figure unreachable by heading navigation | Now an `<h2>` |
| Home was the only route without a page title; h1 and h2 were byte-identical | `SummaryStrip` became a masthead carrying the page title at Headline scale |
| Team lens showed the manager's own counts under "Your team" | `SummaryStrip` is lens-aware — scope, labels and the logged-time source all follow the lens |
| Lens lost on every refresh; not shareable | Persisted to `localStorage` and mirrored to `?lens=team` via `replaceState` |
| Provisional disclosure absent from the team lens | `ScoreCard` no longer gates the chip on `hero`, so compact team cards carry it |
| Attendance bars encoded nothing true — `35m late` and `26m late` both drew at 88% | Width is now the attended proportion of the scheduled day; the bar is `aria-hidden` since the text already states it |
| People rail: ~700px of empty deck, no bleed, a `tabIndex={0}` container scrolling nothing | Replaced with a wrapping grid — comparison is the manager's job, and the rail form only earns its keep where the set runs long |
| 20 of 41 tap targets under 44×44, worst two at 20×16 | Panel "see all" links given a 32px minimum and a hover surface |
| `min-[560px]:min-h-0` was a viewport query where the constraint was card width | Real container query (`@container` + `@[150px]:`) — the four channel figures now share a baseline at every width, verified at 1460px, 834px and 390px |
| Score card reflowed three times on load | Ribbon space reserved before data lands |

## III.6 Left undone, deliberately

- **The composite still exists on the dashboard.** The critique asked whether it should, given the score is already ambient in the top bar on every route. That is a product question, not a design one.
- **`--breakpoint-deck` is 1180px**, so a non-maximised ~1100px window still gets the single-column stack. DESIGN.md promises a 768–1179px intermediate state that does not exist.
- **`AttentionPanel` is still unsortable and undismissable**, and its row order is a hard-coded array.
- **No keyboard walkthrough, no test framework, no shortcuts.** Heuristic 7 was the weakest row at 1/4 and is largely untouched.
- **`AgendaPanel` notifications still carry no actor, object or timestamp.**
