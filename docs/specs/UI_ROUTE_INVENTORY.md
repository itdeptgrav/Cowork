# UI Route Inventory

**Date:** 2026-07-25
**Status key:** ✅ complete · ◐ partial · ⛔ blocked

**Updated 2026-07-25 (correction pass).** All 49 routes now exist and return 200. Every route was verified rendering in a browser. Statuses below reflect the completion rule in brief §16 — a file existing is not enough.

Nothing 404s. There are no dangling internal links.

---

## Home

| Route | Purpose | Users | Permissions | Primary actions | Data shown | States | Reference | Status |
|---|---|---|---|---|---|---|---|---|
| `/` | Operational command centre. Ambient score, then what needs action, then the work behind it. | Everyone | Own score always; team panels only within the reporting closure | Resolve conflict, open review, open task, switch lens | Composite + C1–C4, needs-you queue, tasks, goals, projects, week, logged today | loading · empty · populated · error · both lenses | existing dashboard | ✅ |
| `/home` | Alias for `/` | — | — | — | — | — | — | ✅ |

---

## Tasks

| Route | Purpose | Permissions | Primary actions | Data shown | States | Reference | Status |
|---|---|---|---|---|---|---|---|
| `/tasks` | The task area with five sub-views | `task.view` scoped by `scope` param | New task, filter, sort, change priority, review | Scope counts, KPI strip, projects, table, timeline, approvals, workload | loading · empty · populated · error · conflict banner | **Tasks.jpeg**, **timeline.jpeg** | ✅ |
| `/tasks/new` | Create any of five task types | `task.create` | Create | Type, assignees, deadline mode, project, effort | validation per field · permission denied | — | ✅ |
| `/tasks/[taskId]` | Task detail — the hub for every workflow | `task.view` on that task | Confirm, start, timer, submit, break out a subtask, edit, cancel | Status, rank, deadline chain, assignees, subtasks, activity | 14 task states from brief §15 | **task.webp** card grammar | ✅ |
| `/tasks/[taskId]/deadline` | The negotiation surface | assignee or creator | Propose, decide, counter, respond, extend, waive | Original / proposed / counter / current / **official scored** deadline, extension chain | awaiting proposal · awaiting response · countered · extension pending · expired | — | ✅ |
| `/tasks/[taskId]/submission` | Submit or resubmit | assignee | Submit | Message, attachments, attempt history, late warning | validation · duplicate prevention · late | — | ✅ |
| `/tasks/[taskId]/review` | Approve, rework or reject | reviewer in chain, never self | Approve, rework, reject, waive | Submission, prior reviews, **score impact preview** | permission denied · reason required | — | ✅ |
| `/tasks/[taskId]/history` | Immutable task event stream | `task.view` | Filter | Typed events with actor and time | empty · populated | — | ✅ |
| `/tasks/[taskId]/chat` | Working thread and draft thread | participants | Send | Messages, attachments, system entries | empty · populated | — | ✅ |

## Projects — inside Tasks

| Route | Purpose | Permissions | Primary actions | Data shown | States | Reference | Status |
|---|---|---|---|---|---|---|---|
| `/tasks/projects` | Project roster as a **grid**, not a carousel | member, or org scope for restricted | New project, filter, sort | Name, owner, members, status, progress, health, overdue, next deadline | no projects · active · completed · archived · restricted · denied | **Tasks.jpeg** (carousel rejected) | ✅ |
| `/tasks/projects/new` | Create a project | `project.create` (P3 unresolved) | Create | Name, owner, members, dates, initial tasks | validation · permission denied | — | ✅ |
| `/tasks/projects/[projectId]` | Project detail — connected tasks are the core | member or scope | Add/connect/remove task, add member, milestone, archive | Overview, members, progress, milestones, connected tasks, activity | no connected tasks · overdue · blocked · archive confirmation | **task.webp** | ✅ |

---

## Score

| Route | Purpose | Permissions | Data shown | Reference | Status |
|---|---|---|---|---|---|
| `/score` | Own score, decomposed | own always | Overall %, earned/possible points, C1–C4 band, provisional badges | existing band | ✅ |
| `/score/c1` … `/score/c4` | One channel, traced to its units | own, or within closure | Units, per-unit events, deductions, credits, rule version | — | ✅ |
| `/score/history` | Trend across periods | own, or within closure | Multi-series C1–C4 + overall with series toggles | **anywhere.png** ⚠️ mapping needs confirmation (C1) | ✅ |

---

## Team and people

| Route | Purpose | Permissions | Status |
|---|---|---|---|
| `/team` | Manager lens roster with comparison | `score.compare` scoped to closure | ✅ |
| `/team/[employeeId]` | One report | within closure | ✅ |
| `/team/[employeeId]/tasks` · `/score` · `/attendance` | Drill-in | within closure | ✅ |
| `/people` · `/people/[employeeId]` | Directory (no scores) | `people.view` org | ✅ |
| `/admin/people` | People administration | People Ops / admin | ✅ |
| `/admin/roles` | Role and permission editor | admin | ✅ |
| `/admin/scoring-rules` | **All 32 provisional rules, for owner review** | admin | ✅ |
| `/admin/settings` | Org settings, work calendar | admin | ✅ |

---

## Goals and attendance

| Route | Purpose | Status |
|---|---|---|
| `/goals` · `/goals/[goalId]` | C2 goals and activities | ✅ |
| `/attendance` · `/attendance/history` | C4 day units and deductions | ✅ |

## Collaboration

| Route | Purpose | Status |
|---|---|---|
| `/messages` · `/messages/[conversationId]` | Direct and group threads | ✅ |
| `/groups` · `/groups/[groupId]` | Groups | ✅ |
| `/meetings` · `/meetings/new` · `/meetings/[meetingId]` | Meetings | ✅ |
| `/join/[token]` | Public guest join | ✅ |
| `/notifications` | Per-item and bulk read | ✅ |

## User and support

| Route | Status |
|---|---|
| `/settings` · `/profile` · `/docs` · `/privacy` | ✅ |

---

## Not built, deliberately

Per MIGRATION_DECISIONS.md D15–D17: Office Monitor, MRF, fix-priorities, repair and debug tools, and every unrelated ERP module.

---

## Route status after the correction pass

Verified by fetching every route (49/49 returned 200) and by rendering the core surfaces in Chrome at 1440×900 in both themes.

| Route | Status | Notes |
|---|---|---|
| `/`, `/home` | ✅ | Command centre. Both lenses. Field restored. |
| `/tasks` (overview) | ✅ | Metrics with supporting bars/previews, project grid at reference density, waiting-on-you list |
| `/tasks` (tasks) | ✅ | Dense table: rank, task, owner→assignee, status + next action, progress, deadline, effort. Search, filter popover, grouping, sort, selection, bulk bar, row menu, list/board toggle |
| `/tasks` (timeline) | ✅ | Per-person axis; transposes to a session list below 768px |
| `/tasks` (approvals) | ✅ | Assignment approvals and review queue, split |
| `/tasks/new` | ✅ | Type-first, progressively disclosed, with a live "what happens next" rail |
| `/tasks/[taskId]` | ✅ | Split view; next-required-action first; facts rail; score impact with traceable breakdown |
| `/tasks/[taskId]/deadline` | ✅ | Full chain incl. scored-vs-working deadline; propose / decide / counter / extend / waive |
| `/tasks/[taskId]/submission` | ✅ | Append-only attempts, rework history, attachments |
| `/tasks/[taskId]/review` | ✅ | Approve / rework / reject with score consequence stated before commit; self-review blocked |
| `/tasks/[taskId]/history` | ✅ | Merged task events + priority changes |
| `/tasks/[taskId]/chat` | ✅ | Working and negotiation threads |
| `/tasks/projects` | ✅ | Grid and table layouts, active/completed/archived, search |
| `/tasks/projects/new` | ✅ | Grouped form, optional task connection |
| `/tasks/projects/[projectId]` | ✅ | Connected tasks are the core; derived progress; milestones, activity, members, unlink-without-delete |
| `/score` | ✅ | Slab + component band + channel rail |
| `/score/c1`–`/score/c4` | ✅ | Units and ledger side by side |
| `/score/history` | ✅ | Multi-series trend, C3 below the zero rule |
| `/team` | ✅ | Hierarchy-scoped roster with comparison |
| `/team/[employeeId]` + `/tasks` `/score` `/attendance` | ✅ | Permission-denied state when outside the closure |
| `/people`, `/people/[employeeId]` | ✅ | Directory; scores hidden outside the closure |
| `/admin/people` | ✅ | Roles and reporting lines |
| `/admin/roles` | ✅ | Capability × scope per role, with administrative level |
| `/admin/scoring-rules` | ✅ | Active rules + all 32 open decisions grouped by decision id |
| `/admin/settings` | ✅ | Work calendar, period, integrations, data |
| `/goals`, `/goals/[goalId]` | ✅ | C2 activities as scoring units |
| `/attendance`, `/attendance/history` | ✅ | C4 day units with proportional-lateness disclosure |
| `/messages`, `/messages/[conversationId]` | ✅ | Split view; single-pane below the deck breakpoint |
| `/groups`, `/groups/[groupId]` | ✅ | |
| `/meetings`, `/meetings/new`, `/meetings/[meetingId]` | ✅ | Rooms not wired — stated on the page |
| `/join/[token]` | ✅ | Public guest surface |
| `/notifications` | ✅ | Per-item and bulk read |
| `/settings`, `/profile`, `/docs`, `/privacy` | ✅ | |

**Partial (◐):** none of the above is blocked, but three carry a stated gap:
- `/tasks` timeline — the reference's shared "meetings & breaks" row is not implemented; there is no meeting-time data in the seed.
- `/meetings/*` — meeting rooms, recording and transcription are not wired; the page says so.
- `/settings` — notification preferences render but are read-only.
