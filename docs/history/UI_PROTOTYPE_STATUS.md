# UI Prototype Status

**Date:** 2026-07-25 (correction pass)
**Build:** ✅ 49 routes · **Types:** ✅ 0 errors · **Lint:** ✅ 0 problems · **Impeccable hook:** ✅ clean
**Rendered verification:** ✅ performed in Chrome — and it caught a defect that four green checks had missed.

---

## 1. The correction, in one line

The previous pass reported green on build, types, lint and the design hook while **the entire iridescent field was dead** — I had dropped the `--color-field-*` tokens in the theme rewrite, so every blob painted nothing and every frosted panel sat on flat grey. Rendering the app found it in the first screenshot. Full detail in [UI_DESIGN_CORRECTION_AUDIT.md](UI_DESIGN_CORRECTION_AUDIT.md) §0.

---

## 2. Routes

**49 of 49 exist and return 200.** No dangling internal links. Per-route detail in [UI_ROUTE_INVENTORY.md](UI_ROUTE_INVENTORY.md).

| Group | Routes | Status |
|---|---|---|
| Home | `/`, `/home` | ✅ |
| Tasks | `/tasks` (6 views), `/tasks/new`, `/tasks/[taskId]` + 5 children | ✅ |
| Projects (inside Tasks) | `/tasks/projects`, `/new`, `/[projectId]` | ✅ |
| Score | `/score`, `/c1`–`/c4`, `/history` | ✅ |
| Team & people | `/team`, `/team/[id]` + 3 children, `/people`, `/people/[id]` | ✅ |
| Admin | `/admin/people`, `/roles`, `/scoring-rules`, `/settings` | ✅ |
| Goals & attendance | `/goals`, `/goals/[id]`, `/attendance`, `/attendance/history` | ✅ |
| Collaboration | `/messages` ×2, `/groups` ×2, `/meetings` ×3, `/join/[token]`, `/notifications` | ✅ |
| User & support | `/settings`, `/profile`, `/docs`, `/privacy` | ✅ |

**Stated gaps inside complete routes** (each disclosed on the page itself): the timeline has no shared meetings/breaks row (no seed data); meeting rooms, recording and transcription are not wired; notification preferences are read-only.

---

## 3. What was redesigned

### `/tasks` — rebuilt

| Before | After |
|---|---|
| ~250px of header before any data | **~110px**, two compact rows, matching `Tasks.jpeg` |
| Toolbar ~150px with a large empty gutter | **One 40px row**, filters behind a popover with a count |
| 6 rows visible at 1440×900 | **8 rows**, with denser chrome |
| 7 columns, missing owner / progress / next action | **9 columns** incl. owner→assignee, status + next action, real progress, logged-of-estimated effort |
| Text-only tabs | **Icon tabs** |
| No grouping, selection, bulk actions or view switching | **All four**, plus a per-row action menu |
| Bare-number KPI cells | Figure **plus** a supporting bar or a two-item preview |
| Project cards below reference density | Rebuilt at reference density — 12+ data points, grid not carousel, never dimmed |

**Progress is now derived from logged time against the estimate**, not a status lookup table. `TaskView` gained `owner` and `loggedSecs` so the table stops guessing.

### `/` — refined
Kept its identity; the correction was the field fix plus the operational panels. The greeting row and hero-slab footprint remain a known cost — see §7.

### New surfaces
Task detail (split view, next-action-first, score impact traceable), deadline negotiation, submission, review, history, chat, forwarding, task creation, all three project routes, and every route in §2.

---

## 4. Workflows now operable in the UI

| Workflow | Screen |
|---|---|
| Task creation, all 6 types | `/tasks/new` — type-first, progressively disclosed |
| Priority change + cascade preview + blocking acknowledgement | Table row, task detail, shell |
| P1 conflict detection | Banner + amber rank chip |
| Deadline propose / decide / counter / respond | `/tasks/[id]/deadline` |
| Extension request + waiver decision | Same, with the scored-vs-working deadline shown |
| Confirm, start, timer, work commits | Task detail |
| Submit and resubmit | `/tasks/[id]/submission` |
| Review: approve / rework / reject, second stage | `/tasks/[id]/review` — score consequence stated before commit |
| Forwarding with live budget | Forward dialog |
| Project create / link / **unlink without delete** / members / milestones / archive | Project routes |
| Score → ledger traceability | `/score/*` |
| Notifications | `/notifications` |

Every action goes through the repository interface. No component imports the mock store.

---

## 5. Themes

Light, dark and system all working, persisted, no flash, no hydration mismatch. Dark is separately tuned — full token table in DESIGN.md → Themes.

**Verified in browser:** shell, nav, tabs, tables, panels, slab, component band, chips, buttons, popovers, dialogs, meters, skeletons, empty/error states, field.

---

## 6. Validation

| Check | Result |
|---|---|
| `npm run build` | ✅ 49 routes |
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm run lint` | ✅ 0 problems |
| Impeccable design hook | ✅ clean — 5 findings raised across the pass (radius, four font sizes), all **fixed**, none suppressed |
| React 19 lint rules | ✅ 7 real errors found and fixed properly (ref-during-render, setState-in-effect) |
| All routes return 200 | ✅ 49/49 |
| Rendered review, desktop 1440×900 | ✅ light and dark |
| Rendered review, mobile device width | ❌ **not achieved** — see §7 |
| Contrast audit against rendered pixels | ❌ not performed |
| Keyboard walkthrough | ❌ not performed |
| Component / workflow tests | ❌ none — no test framework installed |

---

## 7. Honest gaps

1. **Mobile was not photographed at device width.** The browser tool's window resize changed `outerWidth` but the page kept `innerWidth: 1470` and never reflowed. I verified responsive behaviour *structurally* instead — both the desktop and narrow branches exist in the DOM and are correctly gated on the deck breakpoint (`deckMatches: true`, desktop branch `display: block`, narrow branch `display: none`). That is not the same as seeing it, and I am not claiming mobile is visually verified.

2. **Contrast figures in DESIGN.md are computed, not sampled.** DESIGN.md itself warns that composites must be sampled from a render. Still outstanding.

3. **No keyboard pass and no tests.** Focus states, roving tabindex and ARIA roles are implemented throughout, but nobody has walked the app with a keyboard and there is no test framework.

4. **`/` still spends its first viewport generously.** The greeting row and the hero slab remain large. The field fix and the operational panels were the priority; a further density pass on home is the obvious next correction.

5. **`anywhere.png` mapping is still unconfirmed** — see REFERENCE_MAPPING.md §7 C1.

---

## 8. Provisional rules

32 unresolved owner decisions remain typed in `lib/config/provisional.ts` and are now **browsable in the product** at `/admin/scoring-rules`, grouped by decision id, each showing the placeholder, what legacy did, and why it is not approved. `ProvisionalBadge` marks every derived figure at its point of display.

The one the owner explicitly withheld — **O4, the rejection deduction** — is called out by name on the review screen rather than applied silently.

---

## 9. Ready for backend integration?

**Closer, but not yet.** The surfaces now exist and exercise the full repository interface, which is what makes the data contract real rather than theoretical. What still stands between here and integration:

- the nine blocking scoring decisions (O1–O9), especially the missing `CW-DEV-PMP-01` spec;
- a real contrast and keyboard pass;
- a test framework, so the scoring invariants are enforced rather than asserted in prose.

---

# Second correction pass — 2026-07-25

**Build:** ✅ 49 routes · **Types:** ✅ 0 · **Lint:** ✅ 0 · **Impeccable hook:** ✅ clean · **Rendered:** ✅ desktop, tablet and phone widths, both themes

## What changed

**Dashboard** — same visual language, different proportions. Greeting row 110px → a 28px identity line; hero score slab ~600px → a compact slab at ~420px carrying deductions, credits, the largest recent event, clickable C1–C4 and a ledger link; a new six-cell summary strip; page height 2400px → 1492px with all 23 summaries the brief names now present.

**Tasks Overview** — rebuilt region for region against `Task_overview.jpeg`: Projects is the hero band, the metric strip anchors the foot, and its four cells are four different anatomies. Full mapping in REFERENCE_MAPPING.md §2.1.

**Play / pause** — a single repository-wired `TimerControl` on task rows, the overview queue, task detail and the app shell.

**Icons** — a distinct Project glyph (a container with internal structure), a refined single-person Employee glyph, and a new Team glyph. The full 10-concept mapping is in DESIGN.md → Components → Icons and is rendered for inspection at `/docs`.

## Defects found by rendering, not by reading

Four of the ten were invisible to the type checker, the linter, the design hook and the build:

1. **`--breakpoint-deck` declared in `px`** sorted before Tailwind's `rem` breakpoints, so `sm:` beat `deck:` at large widths across the whole app.
2. **The stored theme preference was discarded on load** — `localStorage` said light, the page rendered dark.
3. **Mutations were invisible across components** — a timer started in one place did not exist anywhere else.
4. **The timer double-counted or under-counted** depending on whether a session record predated the work commits.

Detail in UI_DESIGN_CORRECTION_AUDIT.md Part II §II.3.

## Still outstanding

1. **Contrast figures in DESIGN.md remain computed, not sampled** from a render.
2. **No keyboard walkthrough and no test framework.** Focus states and ARIA are implemented throughout; nobody has walked the app with a keyboard.
3. **The rest of the product has not yet been re-fitted** to the corrected Tasks structure — deliberately, per the brief's instruction not to propagate until this correction is approved.
4. **`anywhere.png` mapping is still unconfirmed** — REFERENCE_MAPPING.md §7 C1.
5. **The nine blocking scoring decisions (O1–O9) are unchanged**, including the missing `CW-DEV-PMP-01` spec.
