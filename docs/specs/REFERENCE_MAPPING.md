# Reference Mapping — Layout References → Cowork Routes

**Date:** 2026-07-25
**Source folder:** `/Users/risheeray/Documents/cowork/public/uireferences/layoutreferences`
**Rule (DESIGN.md + brief §1.2):** references contribute **structure only** — composition, panel arrangement, information hierarchy, density, toolbar/filter/action placement. Colour, type, borders, shadows, icon style, decoration and pixel styling come from `DESIGN.md` and the existing Cowork UI, always.

Every file in the folder was **opened and inspected**. Filenames alone were not trusted. `Tasks.jpeg` has since been renamed `Task_overview.jpeg` and the duplicate screenshot removed; §2 was rewritten region by region against the renamed file in the second correction pass, and its earlier reading is superseded.

---

## 1. Inventory

| # | Filename | Type | Inspected content | Primary route | Confidence |
|---|---|---|---|---|---|
| R1 | `Task_overview.jpeg` | JPEG, 1280×667 | Tasks Overview: title + inline scope switcher, icon tab bar, **Projects carousel as the hero band**, four-cell KPI strip anchoring the foot | `/tasks` (Overview tab) | **High** — re-inspected in the second correction pass; see §2 |
| R2 | `task.webp` | WebP, 2048×1536 | Project detail, Kanban board view, sidebar, project tabs | `/tasks/projects/[projectId]` | **High** |
| R3 | `timeline.jpeg` | JPEG, 1280×431 | Timer-sessions-by-person timeline | `/tasks` (Timeline tab) | **Medium-High** |
| ~~R4~~ | ~~`Screenshot 2026-07-25 at 5.33.33 PM.png`~~ | — | Duplicate of R3 at higher resolution | — | **Removed from the folder** since the first pass |
| R5 | `anywhere.png` | PNG, 1712×590 | Multi-series smooth line chart with series-toggle chips | `/score/history` | **Low-Medium** — filename gives nothing |

---

## 2. R1 · `Task_overview.jpeg` → `/tasks` (Overview)

> **Re-inspected 2026-07-25, second correction pass.** The file was previously listed as `Tasks.jpeg`; it has been renamed to `Task_overview.jpeg` (identical 47,513-byte JPEG, 1280×667) and the duplicate `Screenshot 2026-07-25 at 5.33.33 PM.png` has been removed from the folder. The section below **replaces** the earlier reading. That reading was written from notes rather than from the file, and it got four things wrong; each is named at the end of the table.
>
> Method: opened at full size, then zoomed into three regions — the two header rows (0–200), the focused project card (530–900 × 200–590), and the KPI strip (0–1456 × 600–827).

### 2.1 Region-by-region map

Columns are the six the brief requires: **reference region → Cowork equivalent → Cowork data → interaction preserved → practical adaptation → Cowork visual restyling.**

| # | Reference region | Cowork equivalent | Cowork data placed there | Interaction preserved | Practical adaptation | Cowork visual restyling |
|---|---|---|---|---|---|---|
| **R1a** | Title `Tasks` with the subtitle `3 jobs · your reports are doing` **on the same baseline**, then the scope control **inline immediately after it** | `WorkspaceHead` row 1 | "Tasks · 9 assigned to you · 6 across your team" | Scope switching; the three counts are live | Only the primary action is pushed to the far edge. **My earlier build right-aligned the scope control with `ml-auto`, which broke the sentence the reference composes.** Fixed in `Workspace.tsx` | Title at Headline weight 300, not the reference's heavy sans. Scope control reuses Cowork's lens-segment grammar (`bg-ink` + inverted text when active) |
| **R1b** | Primary `+ New task` pill, far right of row 1, accent-filled | Same slot | `/tasks/new` | Click through | Unchanged — the reference's placement is right | Ink-filled pill, not cyan. Cyan sits in C1 territory and would break The Four Channels Rule |
| **R2a** | Seven-item tab bar with **leading icons**, active tab marked with an underline plus an accent, count badge on `Approvals` | `IconTabs` | Overview · Tasks · Projects · Timeline · Approvals · Folders, with live counts | Tab switching; counts | Calendar and Files are dropped — neither is a Cowork v1 surface, and an empty tab is worse than an absent one. Timeline stays | **Pill, never an underline.** Nothing in Cowork underlines; the active tab is a filled `var(--control)` pill |
| **R2b** | Right-aligned toolbar: a toggle, a presence stack (`+5 · 7 online`), a round `+`, a refresh, and a `Filter` pill | Same slot, `toolbar` prop | List/Board view switch on the Tasks tab; Filter, Group and Sort popovers on the table | Every control opens a real popover | Presence, refresh and the duplicate `+` are dropped: presence is not a v1 concept on this surface, refresh is not a user concern when the repository is reactive, and `+` duplicates "New task" | Icon buttons in the same pill family as the tabs |
| **R3** | Section header `Projects` with the sub-line `4 live · 8 jobs between them`, left aligned above the band | Section header in `TasksOverview` | `N live · M jobs between them`, computed | — | Adds a "Compare all projects" link, which the reference gets from its own Projects tab | Headline-adjacent 18px light, tabular figures in the census line |
| **R4** | **Projects band — the page's hero.** A horizontal carousel: three cards visible, centre one focused and enlarged, neighbours dimmed and shrunk; circular prev/next at the extremes; four pagination dots beneath | `Rail` + `ProjectSlab` | Every active and planning project | Horizontal scroll, prev/next paging, dot jump-to — **and native scroll and keyboard**, which the reference's arrows-only affordance does not give | **Every card renders at full strength; nothing is dimmed.** The rail structure is kept, the focus-and-dim device is not: an at-risk project must be as readable at the edge as in the middle, and DESIGN.md's Comparison Reads Flat Rule says so | Matte slab over the frosted deck. Neon fills → one neutral bar tone |
| **R4a** | Card silhouette: a **raised identity tab at top-left holding a circular monogram**, over a lower body | `SlabCard size="compact"` with a monogram tab | Project monogram | — | This is Cowork's own stepped slab. **My earlier reading rejected it on The Earned Step Rule and lost the reference's composition. The rule has been extended — see DESIGN.md → Shapes** | Cowork's composed step (tab + radial fillet), not a clip-path |
| **R4b** | Title, two-line subtitle, and **two stacked tags** at the right | Same | Project name, description, status chip + health chip | Title links to project detail | Unchanged | `SlabChip` on slab ink |
| **R4c** | **Three stat pairs** — label above, large figure with a smaller "of N" beside it | Same | Done *of total*, Open *(N in review)*, Overdue *(N blocked)* | — | Reference's "Over budget" has no Cowork equivalent (Cowork tracks effort, not money) → replaced with Overdue/blocked, which is the same *shape* of fact | Figure scale, tabular |
| **R4d** | **Four vertical bar charts** on a shared baseline, each with a thin bright base line, and beneath each a label, a percentage and a small coloured dot | Same four-column chart | Completion · On time · Milestones · Unblocked | — | The reference gives each bar its own saturated hue. Cowork uses **one** neutral tone: four arbitrary hues would read as score channels, and four different neutral opacities (my first attempt) encoded nothing while making the bars harder to compare. The dots go with the hues | `band-fill` texture — the same material as the C1–C4 ribbon, so the two charts are visibly the same family |
| **R4e** | Full-width CTA `Show these jobs` | `Show these tasks` | Links into the project's task list | Click through | Unchanged | White-10% pill, not cyan |
| **R4f** | *(not in the reference)* | Member count + next deadline foot line | `ProjectView.members`, `progress.nextDeadline` | — | Added: brief §11 names members and next deadline as comparison fields | 11px slab-muted |
| **R5** | **KPI strip anchoring the bottom — four cells that are structurally DIFFERENT from one another** | `TasksOverview` metric strip | see below | Cell 3's row is a link | **This is the reference's most important idea and the one I most clearly missed.** My earlier build had four identical cells, each a bare figure | Frosted panel, hairline cell rules |
| **R5.1** | Big figure `8` + a **multi-segment stacked bar** + a **dot legend** (`1 approval gate`, `5 in progress`) | `SegmentBar` | Open count; segments = in progress / in review / overdue / blocked / not started | — | Legend capped at three entries so it stays one line | Ink and state-palette segments only — never a channel hue |
| **R5.2** | Label `Time logged` + a large plain figure `27h40` | Same | Sum of `loggedSecs`, with estimated remaining beneath | — | Adds the "still estimated" second line so the figure has a denominator | Figure Large (28px), tabular |
| **R5.3** | Label `Awaiting your decision` + figure `4` + **one actionable list row** (tag `COMPLETION`, title, duration) | Same | Count of tasks stalled on a decision by the viewer, plus the top one inline | The row links straight to where the decision is made | The reference shows a duration; Cowork shows the deadline, which is the fact that makes a decision urgent | Sunken pill row, uppercase micro tag |
| **R5.4** | A **ring/donut** + figure `2h00` + a context line `Over budget · Mayfair digital fl` | `Ring` + the live work session | Elapsed on the running task, against its estimate; task title links through | — | The reference's ring is a consumed budget. Cowork's is elapsed-against-estimate, which is the same meaning and simultaneously satisfies brief §9 — *which task is active, and for how long* | Ring in ink; it switches to the overdue tone past 100% rather than wrapping |
| **R6** | *(nothing — the reference Overview carries no task list at all)* | "Needs you now" action queue | Every open task whose next action is the viewer's, with a working play/pause control per row | Start/pause writes a real `WorkCommit` | **Added, not substituted.** Brief §8 requires this page to answer "what requires action now" and §9 requires the running and paused sessions to be operable. The reference has no opinion on either | Standard Cowork row grammar — rank chip, title, project, timer, next action, status chip |
| **R7** | Floating circular utility button, bottom-right | — | — | — | Dropped. It is a settings affordance with no Cowork equivalent on this surface | — |

### 2.2 What the earlier reading got wrong

Recorded because the mistakes were the same kind, and the kind matters:

1. **Band order inverted.** The reference leads with **Projects** and anchors with the metric strip. I had the strip on top, which turns the page into a fragment of a dashboard rather than the project-first overview the file describes.
2. **Cell variety flattened.** Four structurally distinct cells became four identical ones — the low-information block the brief warns against, arrived at by treating "KPI strip" as a component rather than as four decisions.
3. **The stepped project card rejected.** Cited The Earned Step Rule; the rule has been extended rather than ignored, because a project carries both an identity and a measurement, which is what the rule was actually testing for.
4. **Scope control right-aligned.** The reference reads "Tasks · 3 jobs · whose?" as one line. `ml-auto` broke it.

All four were found by reopening the file, not by rereading these notes. That is the point of §6 of the brief.

### 2.3 Styling discarded

Cyan/pink/olive neon accents, glow, the near-black card fills, the pill-shaped bar treatment, the centre-card elevation shadow, the underlined active tab, the presence cluster. **Specifically:** the reference's cyan and magenta sit close to C1/C3 territory — adopting them would break The Four Channels Rule.

### 2.4 Responsive

- **≥1180px** — scope inline with the title; three project cards visible in the rail; KPI strip at four cells
- **768–1179px** — tabs scroll horizontally; two project cards visible with the third bleeding; KPI strip at 2×2
- **<768px** — header wraps to three short rows; one project card per view with the rail still scrollable; KPI strip stacks to one column; the scope control stays visible, because it is a permission boundary

### 2.5 Ambiguity

None material. Verified at 1470px, 834px, 768px and 390px in both themes.

---

## 3. R2 · `task.webp` → `/tasks/projects/[projectId]`

**Inspected:** A project detail screen. Breadcrumb "Project / Apex Branding" with "View All Projects" and "Add New Projects" at top-right. A project header row: mark, title, a "Private Board" visibility badge, member avatar stack with overflow count and an add control, and "Customize". Below it a seven-item tab bar (Overview, List, **Board**, Timeline, Dashboard, Calendar, File) with Filter and overflow at right. The body is a four-column Kanban board (To Do ·3, Working in progress ·2, In Progress ·2, Done ·2), each column header carrying a count, an add control and an overflow menu, each column footed by "Add New". Task cards carry title, two tag chips, a dated row and an assignee stack. The left sidebar shows workspace identity, search with ⌘K, Contacts/Activity/Settings, a MAIN MENU with Projects (expandable to named projects), Messages `23`, Reporting, Task `10`, Users, and a CORE TEAM member list.

### Structure to preserve

| Idea | Why |
|---|---|
| **Project header**: title + visibility badge + member stack + primary action | Answers ownership and membership immediately — brief §8.3 |
| **View tabs within a project** (Overview / List / Board / Timeline / Calendar / Files) | Connected tasks are the core of the page and deserve multiple readings |
| **Board column header** carrying a live count and per-column add | Fast task creation in context |
| **Task card composition**: title → status/priority chips → due date → assignee stack | Dense, scannable, and maps 1:1 onto our `Task` contract |
| **"Add New" as a column footer**, not a floating button | Creation stays where the work is |
| **Breadcrumb with a "view all" escape** | Keeps Projects navigable inside Tasks |

### Structure to reject

| Rejected | Reason |
|---|---|
| **The entire left sidebar** | Cowork's shell is a floating frosted **top pill** (DESIGN.md → Navigation). A persistent left sidebar is a different product. Rejected wholesale. |
| **Projects as a global sidebar item with nested children** | Brief §7 is explicit: Projects lives **inside Tasks**. Adopting this IA would contradict it. |
| **Four columns for what are three real states** | The reference has both "Working in progress" and "In Progress" — an artefact. Our board columns come from the canonical state machine in `TASK_LOGIC_SPEC.md` §10.4 |
| **"Customize"** | No board customisation in v1 |
| **Board as the default view** | Cowork is data-dense and desk-first; **List is the default**, Board is a toggle. Kanban hides deadline and priority ordering, which are load-bearing here |

### Styling discarded

Lime-green primary, pastel tag fills (pink/yellow/blue/mint), the dark card chrome, avatar photography, the rounded-square iconography. Tags become Cowork `Chip`s; the priority tag becomes our rank indicator; the category tag becomes a neutral chip.

### DESIGN.md adaptation

- Columns are frosted panels separated by space, not bordered lanes
- Cards inside are hairline-separated rows or low-chrome inner blocks — **never a card nested inside a card** (DESIGN.md "Don't")
- Member stack reuses `AvatarStack` with field-hue monograms; **no photography** (PRODUCT.md records no real people)
- Priority renders as a rank badge, not a colour-coded pill borrowing a channel hue

### Responsive

- **≥1180px** — board scrolls horizontally with fixed-width columns; List view is a full table
- **768–1179px** — board columns narrow; List drops the logged-hours and project columns
- **<768px** — Board becomes a single-column accordion by status; List becomes stacked rows with title, status, due and assignee only

### Ambiguity

The filename `task.webp` suggests a task view, but the content is unambiguously **project detail**. Content wins. The task-card composition inside it does legitimately inform `/tasks` list rows and the task board card.

---

## 4. R3 + R4 · `timeline.jpeg` and `Screenshot 2026-07-25 at 5.33.33 PM.png` → `/tasks` (Timeline)

**R4 is the same component as R3 at higher resolution** (identical rows — Aroona 1h03, Shaik 2h00, Subhadra 9m, Shared 1h45; only the idle minutes differ by one). Treated as one reference.

**Inspected:** A per-person day timeline. Header: Day/Week/Month segmented control, prev/Today/next navigation, and a right-aligned label "TIMER SESSIONS BY PERSON". Column headers: PERSON, an hour axis 09:00–18:00, TRACKED. Each row: avatar, name, "1 job", an online dot, then a track rendering hatched regions (nothing tracked) against solid blocks (worked), with one highlighted block marked as running now. A separate "Shared / meetings & breaks" row carries Lunch and HOD sync as distinct hatched blocks. A vertical current-time indicator crosses all rows. Right column shows tracked total over idle total. A four-item legend sits at the foot.

### Structure to preserve

| Idea | Why |
|---|---|
| **Person-per-row against a shared time axis** | The clearest possible reading of "who worked on what, when" — directly serves `WorkCommit` and the timer model |
| **Hatched = nothing tracked vs solid = worked** | Encodes absence of data without colour, which matters in both themes |
| **A distinct "running now" treatment** | Live state must be unmistakable |
| **Separate Shared row for meetings and breaks** | Non-task time is real time and must not distort per-person tracking |
| **Current-time indicator** | Anchors "now" in a day view |
| **TRACKED total + idle total per row** | The summary a manager actually needs |
| **Day / Week / Month granularity switch** | One component, three densities |
| **An explicit legend** | Four encodings need naming |

### Structure to reject

| Rejected | Reason |
|---|---|
| **Pink current-time line** | A saturated hue outside the sanctioned palette. Becomes a `#0a0a0a` line in light / `#f5f5f5` in dark, with a dot cap |
| **Cyan "running now" fill** | Sits in C1 emerald's semantic neighbourhood. Becomes a lit neutral block with a subtle pulse |
| **Fixed 09:00–18:00 axis** | Office hours are configuration (`MIGRATION_DECISIONS.md` D31), not a constant |
| **"1 job" as the only per-person context** | Thin. Replaced with active task count + current task name |

### Styling discarded

Neon cyan and pink, the near-black track fill, the specific hatch angle and colour. Hatching is rebuilt as a `repeating-linear-gradient` in neutral ink at theme-appropriate alpha.

### DESIGN.md adaptation

- The whole component is one frosted `Panel`
- Row separation by hairline, never boxes
- Person cell reuses `Avatar` at `sm`
- TRACKED figures on the Figure scale, tabular
- Granularity switch reuses the lens-segment grammar
- The legend uses the same swatch shapes as the track fills

### Responsive

- **≥1180px** — full axis, all rows visible
- **768–1179px** — axis compresses to 2-hour ticks; person cell narrows to avatar + first name
- **<768px** — the timeline **does not** become a squeezed axis. It transposes to a per-person vertical list of sessions with start/end and duration. A 9-hour axis at 360px is unreadable, and brief §2 forbids stretching a desktop grid into a phone.

### Ambiguity

`timeline.jpeg` most plausibly maps to the **Timeline tab of `/tasks`** (R1's tab bar contains "Timeline"). It is equally usable on `/team` for a manager's cross-team read, and it is the natural detail view for `/attendance`. **Recorded as: primary `/tasks?view=timeline`; secondary `/team`. Reused rather than duplicated.**

---

## 5. R5 · `anywhere.png` → `/score/history`

**Inspected:** A wide chart panel. Heading "Summary" followed by a `+` control and five series-toggle chips, each with a coloured dot (Bitcoin, Avalanche, Cardano, Near protocol, Stacks). Y-axis 10k–30k with faint horizontal gridlines; X-axis Jan–Dec with two vertical dividers. Roughly ten smooth splines all converging at a common origin and diverging symmetrically, on a dark ground with a radial glow.

### Reading the filename

`anywhere.png` conveys nothing about placement. Best reading: a **generic chart treatment usable anywhere**. Mapped on **content**, not name.

### Why `/score/history`

The structure is a **multi-series trend over a 12-period axis with per-series toggles**. Cowork has exactly one surface with that shape: score history across C1 · Task Execution, C2 · Goal Attainment, C3 · Conduct & Policy, C4 · Attendance, plus the overall composite. Five series, twelve periods, a shared origin.

### Structure to preserve

| Idea | Why |
|---|---|
| **Series-toggle chips carrying their own colour dot** | Lets a manager isolate one channel; the dot is the legend, so no separate key is needed |
| **Wide, short aspect** | Trend shape over precise value |
| **Faint gridlines, labelled axes** | Readable without chrome |
| **Common origin with divergence** | Matches score history starting from a baseline period |
| **A `+` control for adding a series** | Becomes "compare with…" for a report or a team average |

### Structure to reject

| Rejected | Reason |
|---|---|
| **Ten overlapping splines** | Illegible. Cowork shows at most five series, default two |
| **Heavy spline smoothing** | Misrepresents discrete period values. Uses monotone interpolation that never overshoots a real data point |
| **Radial glow behind the plot** | Decoration that reduces legibility |
| **Arbitrary series colours** | **Critical**: C1–C4 series must use their own channel hues (`#00b26b`, `#c3d02e`, `#c22a9e`, `#8e8e8e`) per The Four Channels Rule. The composite renders in ink. No other hue enters this chart. |

### Styling discarded

Blue/purple/pink/white spline palette, the glow, the dark-only ground, the chip fill treatment.

### DESIGN.md adaptation

- The panel is frosted; the plot ground is transparent so the field reads behind it
- **The No Weighting Rule applies**: four independent channel lines, never stacked, never an area chart, never summed
- **The Deduction Hangs Rule applies**: C3 plots on an inverted axis or below a zero rule so a rising deduction never looks like improvement
- Gridlines at `rgba(10,10,10,0.10)` in light, `rgba(255,255,255,0.10)` in dark
- Tabular figures on axis labels
- Chips reuse the existing `Chip` primitive with a channel dot

### Responsive

- **≥1180px** — full 12-period axis
- **768–1179px** — axis thins to quarter labels
- **<768px** — last 6 periods with horizontal scroll for the rest; toggles wrap to two rows

### Ambiguity — **CONFIRMATION REQUIRED**

This is the **weakest mapping in the set** and is flagged accordingly. The filename gives nothing; the content is a generic finance chart. `/score/history` is the strongest structural fit in the route inventory, but three alternatives are plausible:

1. `/score` overview — as a supporting trend under the component band
2. `/team` — comparative score trend across reports
3. `/attendance/history` — attendance trend over time

**Provisional decision:** implement on `/score/history`, and reuse the same `TrendChart` component on `/team` and `/attendance/history`. Because it is built as one shared component, a re-mapping costs nothing.

---

## 6. Reverse Mapping — Route → Reference

Routes with no reference are designed from `DESIGN.md`, the existing Cowork UI, and the behaviour specs. That is the expected case: five references cannot cover fifty routes.

| Route | Reference | Behaviour source | Visual source | Major regions | Immediate data | On-demand data | Primary actions | Density | Responsive | Unresolved |
|---|---|---|---|---|---|---|---|---|---|---|
| `/`, `/home` | — (existing dashboard) | PRODUCT.md, SCORING §8 | Existing Home | Greeting · hero slab / rail · panels | Composite, C1–C4, next actions, alerts | Drill-through | Resolve conflict, review, open task | Medium | 12→8+4→1 col | O2 weights |
| `/tasks` | **R1** | TASK §1–§10 | DESIGN.md | Scope · tabs · toolbar · table | Title, status, priority, due, assignee | Row expand | New task, filter, bulk | **High** | table→cards | T13 range |
| `/tasks` Overview | **R1** | TASK §1 | DESIGN.md | KPI strip · projects · attention | Counts, project health | — | Jump to queue | Medium | 4→2→1 | — |
| `/tasks` Timeline | **R3/R4** | TASK §4 | DESIGN.md | Granularity · axis · rows · legend | Sessions, tracked totals | Session detail | Change day | **High** | transpose <768 | — |
| `/tasks/projects` | **R1** (grid, not carousel) | Brief §8.2 | DESIGN.md | Toolbar · grid/list | Name, owner, status, progress, health | Members, activity | New project | Medium-high | 3→2→1 | Project perms |
| `/tasks/projects/[id]` | **R2** | Brief §8.3 | DESIGN.md | Header · tabs · tasks · side | Members, progress, milestones, tasks | Activity, files | Add/connect task | **High** | tabs→scroll | §8.4 weighting |
| `/tasks/[taskId]` | **R2** (card grammar) | TASK §4–§10 | DESIGN.md | Header · state rail · tabs · side | Status, priority, deadline, assignees | Chat, history | Confirm, start, submit | High | 8+4→1 | T11, T16 |
| `/tasks/[taskId]/deadline` | — | TASK §3 | DESIGN.md | Timeline of proposals · action | Original/proposed/official | Full chain | Propose, counter, decide | Medium | 1 col | T8, T10 |
| `/tasks/[taskId]/submission` | — | TASK §5 | DESIGN.md | Form · attachments · attempts | Message, files, attempt | Prior attempts | Submit | Medium | 1 col | T17 |
| `/tasks/[taskId]/review` | — | TASK §6 | DESIGN.md | Submission · decision · impact | Work, score impact | Prior reviews | Approve/rework/reject | Medium | 8+4 | **T13** |
| `/tasks/[taskId]/history` | — | ARCH §12 | DESIGN.md | Event stream | Typed events | Payload diff | Filter | High | 1 col | — |
| `/score`, `/score/c1–c4` | — (band exists) | SCORING §5 | Existing ScoreCard | Slab · band · units · ledger | Earned/possible/% | Per-unit events | Drill | Medium-high | 12→1 | O2–O9 |
| `/score/history` | **R5** ⚠ | SCORING §5 | DESIGN.md | Toggles · chart · table | Trend per channel | Period detail | Toggle, compare | Medium | 12→6 periods | R5 mapping |
| `/team`, `/team/[id]/*` | R3 (secondary) | PERMISSIONS §4 | Existing rail | Roster · comparison · detail | Scores in hierarchy | Drill | Review, open | Medium-high | rail→list | O29, O30 |
| `/goals`, `/goals/[id]` | — | SCORING §4.1 | DESIGN.md | List · activities | Progress, components | Reports | Update, submit | Medium | 2→1 | O8 |
| `/attendance`, `/attendance/history` | R5 (chart) | SCORING §5.5 | DESIGN.md | Calendar · day list | Day units, deductions | Event detail | — | High | grid→list | **O5** |
| `/messages`, `/groups`, `/meetings` | — | LEGACY §2.5–2.7 | DESIGN.md | List + detail split | Threads, participants | History | Send, schedule | Medium | split→stack | — |
| `/admin/*` | — | PERMISSIONS §4 | DESIGN.md | Table · editor | Roles, rules, people | Detail | Edit | High | table→cards | O28–O32 |
| `/notifications`, `/settings`, `/profile`, `/docs`, `/privacy`, `/join/[token]` | — | LEGACY §3, §2.1 | DESIGN.md | Varies | — | — | — | Medium | 1 col | — |

---

## 7. Confirmations Requested

| # | Item | Question | Provisional action |
|---|---|---|---|
| **C1** | `anywhere.png` | Is `/score/history` the intended target? The filename gives no signal | Built as a shared `TrendChart`; re-mapping is a one-line change |
| **C2** | `timeline.jpeg` / Screenshot | Intended for the Tasks Timeline tab, `/team`, or `/attendance`? | Primary = Tasks Timeline; component reused on the others |
| **C3** | R1 Projects carousel | Confirm the deliberate replacement with a grid + dense list | Grid implemented; brief §2 and §8.2 support it |
| **C4** | R2 sidebar IA | Confirm rejection of the persistent left sidebar in favour of Cowork's top pill | Rejected; DESIGN.md Navigation is normative |
| **C5** | R2 board default | Confirm List (not Board) is the default view for connected tasks | List default, Board toggle |
| **C6** | Coverage | 5 references cover ~6 of ~50 routes. Are more coming for score, admin, messages, meetings? | Remaining routes designed from DESIGN.md + specs |

---

## 8. Rules Applied Throughout

1. **Content over filename.** Every file was opened. `task.webp` is project detail; `anywhere.png` is a chart, not a page.
2. **Structure in, skin out.** No colour, type, border, shadow, icon or decoration crosses over.
3. **The Four Channels Rule wins.** Where a reference uses cyan/magenta/lime near C1–C4 semantics, the hue is dropped. Only genuine score components carry channel colour.
4. **Density over decoration.** Carousels, oversized cards and focus/dim treatments are replaced where they cost information (brief §2, §21).
5. **Improve, don't transcribe.** A reference that wastes space is corrected, and the correction is recorded above.
6. **Ambiguity is recorded, not resolved silently.** §7 lists every open confirmation.

---

## 9. Second-pass region mapping (2026-07-25, post-correction)

Every reference was reopened and analysed again. The first pass under-read the density of two of them, and that misreading produced the layout the correction audit rejects. Corrections are marked **▲**.

### R1 · `Tasks.jpeg` → `/tasks`

| Reference region | Cowork content | Interaction retained | Practical adaptation | Cowork styling applied |
|---|---|---|---|---|
| Title + inline subtitle + scope control + primary action, **all on one ~54px row** | "Tasks" · assigned counts · Mine/My team/Assigned out · New task | scope switching, create | ▲ **Was three stacked rows costing ~250px; now one row.** Title drops from Display to Headline — a workspace header is wayfinding, not a greeting | Headline type, lens-segment grammar for scope, primary pill |
| Tab bar with **leading icons**, right-aligned toolbar on the same row | Overview · Tasks · Projects · Timeline · Approvals · Folders | tab switching, view toggle | ▲ **Icons added** — a 6-item bar is materially faster to scan with a glyph | Pill tabs, never underline (DESIGN.md); 16px line icons at 1.5 stroke |
| Section header "Projects · 4 live · 8 jobs between them" | Same shape | — | kept verbatim in structure | Title + caption |
| Project card: identity chip, name, subtitle, 2 tags, 3 stat pairs, **4 named metric bars**, CTA | owner avatar, name, reference, health chip, progress meter, 4 stats, 4 metric bars, member stack, Open | open project | ▲ **First pass called these "oversized cards showing little information" — that was wrong.** They carry ~12 data points. The carousel is the defect, not the card. Density restored; carousel replaced by a grid | Frosted panel (not stepped — Earned Step Rule), neutral meters |
| Carousel with arrows, dots, dimmed neighbours | — | — | **Rejected.** Hides most of the roster and dims what a manager needs to compare (Comparison Reads Flat Rule) | responsive grid |
| KPI strip: figure **plus** a segmented bar with legend, or figure **plus** a list preview | Open / Needs you / At risk / Effort open | jump to queue | ▲ **First pass shipped four bare numbers.** Each cell now carries a supporting bar or a two-item preview | Hairline-divided cells in one panel, tabular figures |

### R2 · `task.webp` → `/tasks/projects/[projectId]` and task-card grammar

| Reference region | Cowork content | Interaction retained | Practical adaptation | Cowork styling applied |
|---|---|---|---|---|
| Breadcrumb + "View all" + "Add new" | Tasks / Projects / PRJ-101 + New task | navigate up, create | kept | Compact breadcrumb, ink hover |
| Project header: mark, title, visibility badge, member stack + add, Customize | title, status chip, health chip, restricted chip, target date, member stack, add member, actions | add member, actions | "Customize" dropped — no board customisation in v1 | Headline, chips, AvatarStack |
| View tabs: Overview / List / **Board** / Timeline / Dashboard / Calendar / File | Tasks / Milestones / Activity, with List/Board toggle on the Tasks tab | tab + layout switching | ▲ **List is the default, not Board** — Kanban hides deadline and rank ordering, which are load-bearing here | Pill tabs |
| Board columns with count, per-column add, "Add New" footer | Waiting / Ready / In progress / In review / Done | add in context | Columns come from the canonical state machine — the reference has both "Working in progress" and "In Progress", an artefact of its own data | Frosted columns, hairlines |
| Card: title → chips → dated footer → assignee | title, rank, status chip, blocked icon, due date, next action, assignee | open task | kept; adds the next-required-action line | Chips, tabular dates |
| Persistent left sidebar with nested Projects | — | — | **Rejected wholesale.** Cowork's shell is a floating top pill; adopting a sidebar would contradict DESIGN.md → Navigation and put Projects at top level against brief §7 | — |

### R3 + R4 · `timeline.jpeg` / Screenshot → `/tasks` Timeline

| Reference region | Cowork content | Interaction retained | Practical adaptation | Cowork styling applied |
|---|---|---|---|---|
| Day/Week/Month + prev/Today/next + right-aligned caption | Day/Week segmented, date, "Timer sessions by person" | granularity switch | Month dropped — no data shape for it yet | Lens-segment grammar, tracked kicker |
| PERSON / hour axis / TRACKED columns | avatar + name + session count, 09–19 axis, tracked over idle | — | Axis bounds come from the work calendar, not a constant | Label type, tabular figures |
| Hatched = nothing tracked, solid = worked, highlighted = running | same, encoded by **fill pattern not hue** | hover for task + duration | Cyan "running now" dropped — it sits in C1 emerald's semantic neighbourhood | `.hatch` repeating-linear-gradient in ink |
| Pink current-time line with dot cap | ink line with dot cap | — | ▲ Hue replaced; the marker is structural, not decorative | `bg-ink` |
| Legend | Worked / Nothing tracked / Now | — | kept | Swatches matching the track fills |
| Shared row for meetings and breaks | **Not implemented** — no meeting-time data in the seed | — | recorded as a gap | — |

### R5 · `anywhere.png` → `/score/history` ⚠ mapping still unconfirmed

| Reference region | Cowork content | Interaction retained | Practical adaptation | Cowork styling applied |
|---|---|---|---|---|
| "Summary" heading + series-toggle chips with colour dots | Overall + C1–C4 chips, each with its channel dot | series legend | Ten overlapping splines reduced to five | Chips with a channel dot |
| Y axis with faint gridlines, X axis of periods | −100…100 with a zero rule, quarters | — | ▲ **Zero rule added** so C3 plots below it — The Deduction Hangs Rule applies to charts too | Hairline gridlines, tabular labels |
| Smooth splines from a common origin | polylines with point markers | — | Heavy smoothing rejected — it misrepresents discrete period values | Channel hues for C1–C4, ink for the composite; **no other hue enters the chart** |
| Radial glow behind the plot | — | — | Rejected as decoration | Transparent plot ground so the field reads behind it |

**Ambiguity unchanged.** The filename carries no signal. `/score/history` remains the strongest structural fit, and the chart is built as a reusable component so a re-mapping is cheap. **Confirmation still requested (C1 in §7).**

### Coverage

5 references cover 6 of 49 routes. The other 43 are designed from DESIGN.md, the existing shell and the behaviour specs. If more references exist for score, admin, messages or meetings, they would be welcome — those surfaces were designed without one.
