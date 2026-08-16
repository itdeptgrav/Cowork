---
version: 1
slug: "app-tasks-page-tsx"
primary_target: "app/tasks/page.tsx"
related_targets: ["components/features/tasks/TasksArea.tsx","components/features/tasks/TaskTable.tsx","components/features/tasks/TasksOverview.tsx","components/features/tasks/TaskBoard.tsx","components/ui/Workspace.tsx"]
---

**Mode: Operate.** The visitor completes a task. Scanability, consistency and
the real usage scene outrank expression. Brand lives in precise details.

This brief records the Tasks surface **as built**, so it can be rebuilt from
the brief alone without losing a wire. It is subordinate to
`docs/architecture/DESIGN.md` for the global world (three materials, four
channels, tabular figures) but it **overrides it on radius and on the type
ramp**, where the shipped page and the document have drifted apart — see
*Drift against DESIGN.md* at the foot.

---

## 1. What the surface is

One route, five views, selected by a query parameter.

```
/tasks?view=overview   TasksOverview   default, and the fallback for any unknown value
/tasks?view=tasks      TaskTable | TaskBoard   layout toggle lives in the toolbar
/tasks?view=timeline   TasksTimeline
/tasks?view=approvals  Approvals   labelled "Actionable" in the tab
/tasks?view=workload   Workload    permission-gated
```

`app/tasks/page.tsx` is a five-line server shell: `<Suspense fallback={<SkeletonRows rows={8} />}>` around `<TasksArea />`.
Everything else is client. The fallback shape is part of the design — the page's
first paint is eight skeleton rows, not a spinner.

**The Unknown View Rule.** `VIEWS` is a whitelist and anything outside it falls
back to `overview`. `?view=folders` was a real linked URL once; a page that
renders chrome over an empty body reads as broken rather than as moved.

---

## 2. Page geometry

Inherited from the shell (`components/layout/shell/ShellFrame.tsx`), not
declared by this surface:

| | |
|---|---|
| Container | `mx-auto max-w-[1360px]` |
| Gutters | `px-[clamp(12px,3vw,32px)]` |
| Top / bottom | `pt-[clamp(14px,2vw,22px)]` · `pb-[clamp(32px,5vw,64px)]` |
| Above | `TopBar` — 44px, `frost-bar`, square, edge to edge |
| Behind | `.field` — `position: fixed; inset: -20%; z-index: -1` |

**Breakpoints actually used on this surface: two.** `sm` (640px) and `deck`
(73.75rem = 1180px). Nothing here uses `md`, `lg` or `xl`. `deck` is declared in
rem on purpose so Tailwind sorts it between `lg` and `xl`; as `1180px` it
emitted before `sm` and `deck:grid-cols-4` lost to `sm:grid-cols-2`.

**The Two-Step Responsive Rule.** Every layout on this page has exactly two or
three states — full deck at `deck`, an intermediate at `sm` where the strip
halves, and a stacked single column below. Below `deck` the table does not
scroll sideways; it is replaced by `NarrowRow`. A table you must scroll to reach
the status column is slower than a card.

---

## 3. Type

**One family: Geist** (`--font-geist-sans`, loaded via `next/font/google`, with
`system-ui, -apple-system, sans-serif` behind it). No second family, no serif, no
mono. Body carries `letter-spacing: -0.008em` globally.

The ramp **as this page uses it**:

| Role | Value | Where |
|---|---|---|
| Page title | `clamp(1.375rem, 2vw, 1.75rem)` / 300 / `leading-none` / `-0.03em` | `WorkspaceHead` h1 — "Tasks" |
| Section head | `18px` / 300 / `leading-none` / `-0.025em` | "Projects" on Overview |
| Panel head | `17px` / 500 / `-0.02em` | `PanelHead` (shared; unused by Tasks' own panels) |
| Strip figure | `28px` / 400 / `leading-none` / `-0.03em` / tabular | the four KPI cells |
| Band head | `14px` / 500 | "Needs you now", "Approvals", board column names |
| Body | `14px` / 400 | task titles, row content, menu items |
| Control | `14px` / 500 / `-0.012em` | tabs, tool buttons, segmented options, buttons |
| Caption | `12px` / 400 | deadlines, counts, toolbar tallies |
| Micro | `11px` / 400 | row metadata, next-action line, badge counts |
| Column label | `11px` / `0.09em` / uppercase | table header, group header, metric labels |

**The One Weight-Jump Rule.** Hierarchy on this page is made from *size and
tracking*, not weight. Only two weights appear: 300 for the two headings that
are display-scale, 500 for controls and band heads. Everything else is 400.

**The Tabular Rule.** Every figure carries `data-figure`, which the base layer
maps to `font-variant-numeric: tabular-nums`. Numbers here sit in columns and
change in place. This includes counts inside chips and badges — a tab count that
jitters between 9 and 10 is the failure.

**The Column-Label Rule.** `11px / 0.09em / uppercase / ink-faint` is the label
of a *column or a metric*, never a section eyebrow. It appears in exactly four
places: the table's column header, the group header, the KPI cells' metric
names, and the approval sub-group strips. A heading gets Band head (14px/500)
instead.

**The Metadata Dot Rule.** Secondary facts under a title run as one 11px
`ink-faint` line joined by ` · `, in fixed order and omitted when absent —
never wrapped in parentheses, never on their own lines:

```
TSK-1042 · Project · 3 subtasks · Website revamp · 2 rework · 💬 4
```

---

## 4. Colour on this surface

The deck is fully neutral. This page introduces **no colour of its own**.

- **Text:** `ink` (primary), `ink-muted` (secondary, and *anything sitting on
  the raw field*), `ink-faint` (metadata — panel interiors only).
- **Interaction:** `--control` (hover / resting badge), `--control-hover`,
  `--control-active` (selected row, selected tool button, meter track),
  `--surface-sunken` (segmented track, search field, idle-tab hover).
- **State washes only, for state.** `color-mix(in srgb, var(--state-X) 18–30%, transparent)`
  with the paired `--state-X-ink` on top.

**The Field Is Not A Text Surface Rule** (inherited, and this page is where it
bites). The `WorkspaceHead` count line and the Overview section census sit on
the raw field, so they take `ink-muted` — never `ink-faint`. `ink-faint` is a
panel-only token here.

**The No Channel Colour Rule** (inherited). C1–C4 hues never appear on this
page. Status, priority, progress and the composition bar are all ink or state
washes. The `Meter` fill is `bg-ink/70`; the `Ring` is `--color-ink` and flips
to `--state-overdue` only past 100%.

**Status tone table** (`components/features/tasks/statusMeta.ts` — the first true
condition wins, and the order is the design):

| Condition | Label | Tone |
|---|---|---|
| `isBlocked` | Blocked | `blocked` |
| `isOverdue` | Overdue | `overdue` |
| `deadline.state === "extension_pending"` | Extension requested | `extension` |
| `reworkCount > 0 && in_progress` | Rework / Rework ×N | `rework` |
| `completed` | Completed | `positive` |
| `pending_approval` · `deadline_negotiation` · `in_review` | — | `extension` |
| `assignment_rejected` | Assignment rejected | `overdue` |
| everything else | — | `neutral` |

**The Untinted Normal Rule.** `Assigned`, `Confirmed`, `In progress`,
`Cancelled` and `Draft` stay neutral. A tint on the normal case makes the
exceptions invisible.

---

## 5. Shape

Radius encodes scale. Four steps are in use on this page, and the capsule is
**not** retired here — it is the control language.

| Radius | Token | What takes it |
|---|---|---|
| `22px` | `rounded-panel` | the table's own frosted container |
| `18px` | `rounded-card` | `Panel` — every band on Overview and the inbox |
| `14px` | `rounded-inset` | board cards, banners, empty-column placeholders |
| `9999px` | `rounded-full` | **every control**: buttons, tabs, chips, badges, search, segmented, menu rows, avatars, meters, icon buttons |

**The Capsule Is The Control Rule.** If a person can click it, it is fully
rounded. If it holds content, it takes 14 / 18 / 22 by size. There is nothing
square on this page and nothing invents a fifth radius.

**Separation is hairlines and space, never boxes.** `divide-y divide-hairline`
between rows; `border-b border-hairline` under headers; `border-t border-hairline`
between KPI cells. No zebra striping, no nested cards, no coloured left borders.

---

## 6. Elevation

Two materials, and this page only ever uses one of them.

`frost-panel` — `--color-frost-panel`, `backdrop-filter: blur(24px) saturate(1.4)`,
`box-shadow: var(--shadow-deck-seat), inset 0 1px 0 var(--frost-lip)`.

**The stepped slab appears exactly once on this surface**, inside `ProjectSlab`
in the Overview rail. Per The Earned Step Rule a project carries both an
identity and a measurement, so it earns the step. The task list, the inbox and
the board are frosted rectangles. Do not step them.

---

## 7. Chrome — the two-row header

`components/ui/Workspace.tsx :: WorkspaceHead`. Target height ≤120px for both
rows; an earlier build spent ~250px reaching the same place and pushed real data
below the fold.

**Row 1** — `flex flex-wrap items-center gap-x-4 gap-y-2`

```
Tasks   3 assigned to you · 11 across your team   [Mine|My team|Assigned out|…]        [+ New task]
└ h1                └ 14px ink-muted, data-figure   └ Segmented size="sm"        └ ml-auto, Button primary sm
```

**The Title Reads As A Sentence Rule.** Title, count and scope sit inline and
are read as one phrase — "Tasks, 3 jobs, whose?". Only the primary action is
pushed to the far edge. Right-aligning the scope control breaks the reading; an
earlier pass did it and it had to be reverted.

**Row 2** — `mt-3 flex items-center gap-3 border-b border-hairline pb-2`

`IconTabs` (flex-1, `rail`, horizontally scrollable) then a right-aligned
toolbar (`shrink-0 gap-1.5`) that is **present only on `view=tasks`**, where it
carries the List / Board toggle.

Tab anatomy: `rounded-full px-3 py-1.5 text-sm font-medium tracking-[-0.012em]`,
active `bg-[var(--control)] text-ink`, idle `text-ink-muted` with the icon at
`opacity-70` and `hover:bg-[var(--surface-sunken)] hover:text-ink`. Count badge
is `rounded-full px-1.5 text-[11px]`, shown only when `> 0`. Transition
`180ms var(--ease-deck)` on colour and background only.

**Nothing in this system underlines.** Tabs are pills.

---

## 8. Component grammar

### Overview — `flex flex-col gap-5`

**The Four Anatomies Rule.** The KPI strip's four cells are deliberately *not*
alike. Each uses the visualisation its data wants:

1. **Composition** — 28px figure + `open of N` + `SegmentBar` with dot legend.
2. **Duration** — 11px uppercase label + 28px figure + an 11px qualifier.
3. **Queue** — label + figure + *one actionable row* (a pill link carrying a
   truncated title, an uppercase verb tag and a date), or "Nothing is stalled on you."
4. **Session** — a 44px `Ring` + 28px elapsed figure + a running/paused line.

Four identical cells is the low-information block this exists to avoid.

Separators inside the strip are **written per cell**, not with `divide-*`:
`border-t border-hairline` + `sm:border-t-0 sm:border-l` + `deck:border-t-0 deck:border-l`
as each cell requires. `divide` draws on DOM order and a 2×2 arrangement then
puts a vertical rule at the start of the second row.

The projects rail: `Rail` with `w-[300px] deck:w-[340px] shrink-0 snap-start`
cards, staggered `delay={i * 70}`ms. Neighbours bleed off both edges — the rail
must never resolve into a tidy grid, and every card renders at full strength (The
Comparison Reads Flat Rule).

### Table — `frost-panel overflow-hidden rounded-panel`

Eleven columns, one literal grid string, shared by the header and every row:

```
grid-cols-[28px_92px_minmax(0,1fr)_78px_146px_86px_74px_62px_78px_76px_30px]
  ☑    P    Task              People Status·next Progress Deadline Budget Timer Activity ⋯
```

Priority is 92px and not the 38px a bare "P1" needs, because two of the four
things it renders are longer: `Was P3` on a closed task and `P1 to accept` on
work whose hours are not agreed.

- Header: `border-b border-hairline px-3 py-1.5` + column-label type.
- Row: `px-3 py-2 gap-2 items-center`; hover `bg-[var(--control)]`; selected
  `bg-[var(--control-active)]`; dragging `opacity-40`; drop target
  `outline outline-1 -outline-offset-1 outline-ink/40`.
- Row menu: `opacity-0 group-hover:opacity-100 focus-visible:opacity-100`.
- Two lines per row: title at 14px ink, metadata at 11px ink-faint.

**The Group Is A Gap Rule.** Grouping renders as sections, not tinted strips:
`mt-8 first:mt-0` between groups (32px), `mb-4` from a group header to its rows
(16px), row spacing untouched. The header is a full-width button —
`border-b border-hairline px-3 pb-2` carrying a 6px `ink-faint` dot, the
uppercase label, a dimmed count and a chevron. The earlier tinted-strip version
made four statuses read as one continuous list with marks in it.

Default grouping is **by status**, into four triage buckets in fixed order:
`Needs action · In progress · Waiting · Completed`. Not raw status labels —
"Assigned", "Confirmed" and "Deadline pending" are three names for one situation.

Toolbar: `mb-2 flex flex-wrap items-center gap-1.5` — search, Filter popover,
Group popover, Sort popover, then `ml-auto` a 12px ink-faint tally. Search is
`h-8 w-[176px] rounded-full bg-[var(--surface-sunken)]` with a leading icon,
widening to `w-[240px]` on focus over 180ms.

### Board

`scroll-slim -mx-1 flex gap-3 overflow-x-auto px-1 pb-2`. Five fixed columns
from the state machine — `Waiting · Ready · In progress · In review · Done` —
at `w-[264px]`, becoming `deck:w-[calc((100%-48px)/5)]`. Column header:
`text-sm font-medium` + 11px count + an `ml-auto` 24px `+` link. Cards are
`frost-panel rounded-inset px-3 py-2.5`, title `line-clamp-2`, then a chip row,
then a `border-t border-hairline pt-2` footer carrying date, next action and the
assignee avatar at `ml-auto`. An empty column shows
`rounded-inset border border-dashed border-hairline … "Nothing here"`.

**Board uses `scroll-slim`, the rail uses `rail`.** A dense scroll region keeps
a visible thumb; hiding it removes the only cue that content continues. The
`rail` treatment is reserved for bleed rails where the bleed itself signals it.

### Inbox (`view=approvals`, labelled "Actionable")

`flex flex-col gap-4` of `Panel padded={false}` sections in fixed order:
**Needs your action → Approvals → Reviews**. Each section header is
`border-b border-hairline px-4 py-2` with a 14px medium title, a 12px count and
an 11px hint that wraps to its own line below `sm`. **A section with zero items
renders nothing at all** — no empty section headers. Approvals sub-group by kind
(`Cross-department · Upward assignment · Time budget · Self-assignment`) under
`bg-[var(--surface-sunken)]` column-label strips.

### Shared primitives this surface depends on

`Panel` · `Chip` · `Button` · `Segmented` · `Meter` · `Ring` · `SegmentBar` ·
`EmptyState` · `ErrorState` · `QueryError` · `SkeletonRows` (all
`components/ui/Primitives.tsx`); `WorkspaceHead` · `IconTabs` · `ToolButton` ·
`Popover` · `MenuItem` · `MenuLabel` · `MenuDivider` (`components/ui/Workspace.tsx`);
`Avatar` · `Icon` · `Rail`.

---

## 9. States

Every list on this page can be empty **and** can fail, so both answers are
available at the same place — a failed read rendering as emptiness tells someone
they can stop looking, falsely.

| State | Treatment |
|---|---|
| Loading | `SkeletonRows` — 8 rows page-level, 5 inbox, 6 board/workload, 3 project rail |
| Error | `ErrorState` / `QueryError` with a retry that refetches every failed query |
| Empty, filtered | "No tasks match" + "Try a different search, or clear the filters." + a **Clear filters** button |
| Empty, unfiltered | "No tasks here" + "Tasks assigned to you appear here." + a **New task** primary button |
| Empty inbox | "Nothing waiting on you" |
| Permission | `PermissionDenied` — a boundary, not a failure |

Copy is plain, sentence case, and never frames anything as AI-driven.

---

## 10. Motion

- Colour and background transitions: `180ms var(--ease-deck)`. Nothing else moves on hover.
- Search width: `180ms`.
- Project slabs: `.rise` — 620ms `--ease-out-expo`, staggered 70ms.
- Skeleton shimmer: 1400ms, between `--control` and `--control-hover`.
- The field's drift is the only thing moving at rest.

---

## 11. Accessibility contract

Not decoration — these are wired and must survive a rebuild.

- `IconTabs` is `role="tablist"` / `role="tab"` / `aria-selected`.
- `Segmented` is a `radiogroup` with roving tabindex and Arrow/Home/End keys.
- Group headers carry `aria-expanded`; the fold chevron carries a full label
  naming the task and its subtask count.
- Board columns are `<section aria-label={column}>`.
- `Meter` / `Ring` are `role="meter"` with min/now/max.
- The tree elbow is `aria-hidden` — the relationship is carried in words by the
  "Subtask" mark, so a screen reader gets the fact, not a drawing of it.
- Selection checkboxes name their task: `aria-label={`Select ${title}`}`.
- Focus is `outline: 2px solid var(--color-ink)` at `2px` offset, following each
  element's own radius. Never restate a radius on the outline.
- `Popover` closes on outside `mousedown` and on `Escape`.

---

## 12. The connection map

### Inbound

- Global nav — `lib/utils/nav.ts:18` → `/tasks`, matching prefix `/tasks`.
- Sub-nav tab list is duplicated at `lib/utils/nav.ts:93-97`. **Two sources for
  one tab set** — change both or delete one.

### Outbound links

| From | To |
|---|---|
| Header action | `/tasks/new` |
| Tab: Projects | `/tasks/projects` |
| Overview "Compare all projects" | `/tasks/projects` |
| Overview "All tasks" | `/tasks?view=tasks` |
| Overview decision cell | `action.href ?? /tasks/{id}` |
| Overview running-timer line | `/tasks/{taskId}` |
| Queue row title, table title, board card, narrow row, inbox row | `/tasks/{id}` |
| Inbox review rows | `i.href` (supplied by the repository) |
| Row menu | `/tasks/{id}` · `/tasks/{id}/deadline` · `/tasks/{id}/history` |
| Board column `+` | `/tasks/new` |
| Empty state action | `/tasks/new` |

Detail sub-routes that exist and are reachable from the detail page rather than
here: `chat · deadline · files · history · meetings · reports · review · roadmap · submission`.

### Data

| Query | Feeds |
|---|---|
| `listTasks({scope})` ×6 | the header count and every scope option's badge (`mine`, `team`, `assigned_out`, `self_assigned`, `submitted`, `all`) |
| `listTasks({scope, projectId, search, status, sort, overdueOnly, blockedOnly, assigneeId, includeSubtasks})` | the table |
| `listTasks({scope, projectId, sort:"rank", includeSubtasks:!!projectId})` | the board |
| `listActionable()` | **both** the Actionable tab's count and the inbox list |
| `listProjects({status:["active","planning"], sort:"health"})` | the Overview rail |
| `getCurrentEmployee` · `getActiveTimer` · `listTimers` | the session cell and `TimerControl` |
| `listPriorityConflicts` / `normalizePriorities` | the conflict banner and its Fix button |
| `listEmployees` · `listTeamMonitoring` | Workload |
| `getViewer` | who may reorder whom |

**The One Count Rule.** The badge counts the same list the tab renders.
`listActionable()` is the single source. It previously counted `listReviewQueue`,
so an approval waiting on you was absent from the number on the tab whose stated
job is "what is waiting on me".

**The No Duplication Rule.** Nothing in the inbox is repeated in Tasks. Tasks
answers "what is the state of the work"; the inbox answers "what is waiting on
me". Showing the same rows in both taught people to check one and distrust the
other. This is why there is no "Needs you" scope pill.

### Permissions

`usePermissions().scopeFor("task.view")` returns `self | direct_reports | hierarchy | organisation`.

- **Workload tab** renders only above `self`. Showing an individual contributor a
  view of one person reads as a broken team, not an absent permission.
- **Scope options** appear only where reach exists: `Mine` and `Assigned out`
  always; `My team` above `self`; `Everyone` only at `organisation`. `Self tasks`
  and `Submitted` carry no role condition — each is defined by the viewer's own
  relationship to the task.
- `task.priority.change`, resolved per assignee through `reorderableAssignees`,
  decides whether the priority cell is a button or a span. **A row never offers
  a control that would be denied.** Not-interactive is a `<span>`, not a disabled
  button — disabling dims a figure the reader still needs and announces it as
  disabled.

### Reuse — do not break

`TaskTable` and `TaskBoard` are also mounted by
`components/features/projects/ProjectDetail.tsx` with a `projectId`. That prop
hides the project column, turns on `includeSubtasks`, and supplies `onUnlink`,
which adds a **Remove from project** danger item to the row menu. Any rebuild
must keep both props working.

### Walkthrough anchors — load-bearing

`lib/help/targets.ts` spotlights these by `data-help` id. Removing or renaming
one silently breaks a walkthrough:

| Anchor | Element |
|---|---|
| `task-scope-switch` | the `Segmented` scope control |
| `new-task-button` | the primary header action |
| `task-approvals-tab` | the "Needs your action" section title |
| `review-queue-list` | the "Reviews" section title |

Per `CLAUDE.md`, any user-facing behaviour change here ships with its
`lib/help/knowledge.ts` update in the same piece of work.

---

## 13. Drift against DESIGN.md — record, do not silently repair

Three places where `docs/architecture/DESIGN.md` no longer describes the shipped
page. **This brief follows the code.** Reconciling the two is its own task.

1. **Radius.** DESIGN.md documents `shell 0 / band 8 / control 5 / tag 3` and
   states "the capsule is retired". The build ships
   `--radius-slab: 28 / --radius-panel: 22 / --radius-card: 18 / --radius-inset: 14`
   with `rounded-full` on every control. The code is the reality.
2. **Type scale.** DESIGN.md's Title is 15px and its navigation is 15px; this
   surface's controls and tabs are 14px, and its page title is
   `clamp(1.375rem, 2vw, 1.75rem)` against DESIGN.md's headline
   `clamp(1.5rem, 2.4vw, 2.125rem)`. `WorkspaceHead` is a deliberately tighter
   variant of `PageHead`.
3. **Frost values.** DESIGN.md's frontmatter carries
   `frost-panel: rgba(240,240,242,0.97)`; `globals.css` ships
   `rgba(232,232,234,0.80)` in light and `rgba(32,32,37,0.74)` in dark, and its
   own Themes table agrees with the CSS rather than with its frontmatter.

---

## 14. Rebuild checklist

- [ ] Two-row header, ≤120px, title·count·scope inline, action at `ml-auto`.
- [ ] Toolbar exists only on `view=tasks`.
- [ ] Whitelisted views; anything else falls back to `overview`.
- [ ] Eleven-column literal grid string shared by header and rows — never built at runtime.
- [ ] Groups separated by 32px of gap, not by tint.
- [ ] Four KPI cells with four different anatomies; per-cell borders, no `divide-*`.
- [ ] `data-figure` on every number, including badge counts.
- [ ] `ink-muted` for anything on the field; `ink-faint` inside panels only.
- [ ] No C1–C4 hue anywhere; state washes only.
- [ ] Every control `rounded-full`; containers 14 / 18 / 22.
- [ ] Below `deck`: stacked `NarrowRow`, never a sideways-scrolling table.
- [ ] Empty **and** error states on every list.
- [ ] All four `data-help` anchors present.
- [ ] `projectId` and `onUnlink` still work for `ProjectDetail`.
- [ ] Read in both themes: selected row, tinted chips, focus rings, skeletons.
