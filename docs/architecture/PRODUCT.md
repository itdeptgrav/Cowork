# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two first-class audiences, weighted equally — the product is not designed primarily around either one:

- **The individual doing the work.** An employee running their day: tasks, projects, meetings, messages, and documents. Their actions are what generate performance signal.
- **The manager.** Oversees team execution and consumes the performance picture that the individual's work produces — including the comparative view across their reports, which the reports themselves never see.

The shell must serve both lenses without either feeling bolted onto the other.

Usage is desk-based and sustained: laptops and desktop monitors are the primary target, and people are expected to work in Cowork for long stretches rather than dropping in occasionally.

## Product Purpose

Cowork is an enterprise productivity and collaboration platform that brings tasks, projects, meetings, communication, documents, and team workflows together into a single workspace.

It is the central operating system for both **work execution** and **performance management** — the place work gets done and the place work gets measured.

## Positioning

Every action taken within Cowork contributes to an employee's performance score. Execution and measurement are not two systems bolted together; they are the same system. A competitor offering a workspace, or offering performance management, could not truthfully claim that the act of working *is* the act of being measured.

Cowork is explicitly **not an AI product**. AI is not the mechanism, not the positioning, and must not become the framing in interface copy or product narrative.

## Operating Context

- All-day use at a desk, on laptops and large monitors. Mobile is a secondary adaptation, not a co-equal target.
- Work spans six domains that must coexist in one workspace rather than living as separate tools: tasks, projects, meetings, communication, documents, and team workflows.
- Because activity across these domains feeds the performance score, actions taken anywhere in the product have consequences beyond their own domain.
- **Goals, policies, and attendance are also first-class product objects.** Three of the four score components (C2, C3, C4) depend on them, so they are not peripheral admin features — they are part of the workspace even though they sit outside the six work domains above. Goals in particular are authored, tracked, and attained by the same people doing the daily work.
- Task lifecycle carries more signal than a binary done/not-done: **deadline extension requests and rework are recorded events**, because C1 depends on them. Any task interface must account for these as real states, not edge cases.

## Capabilities and Constraints

**Confirmed functionality**

- Unified workspace covering tasks, projects, meetings, communication, documents, and team workflows.
- Performance scoring derived from actions taken across the product.
- The performance score is **ambient and persistently present** — an employee sees their score and its trajectory as they work, rather than visiting a separate destination to find it.

**The performance score (confirmed)**

The score is a **percentage: how much could have been achieved versus how much actually was**. It is an absolute measure against the individual's own achievable ceiling, not a ranking.

It is composed of four components. The codes are existing organizational vocabulary and appear in the interface *alongside* descriptive labels — `C1 · Task Execution`, not `C1` alone and not the label alone:

| Component | Covers | Notes |
|---|---|---|
| **C1 · Task Execution** | Task completion quality | Whether work landed within deadline, required rework, or needed a deadline extension |
| **C2 · Goals** | Goal attainment | Entirely goal-related |
| **C3 · Policy** | Policy breaches | **Deduction only** — C3 can never add to a score |
| **C4 · Attendance** | Attendance | — |

- **Component weights are fixed product-wide.** They are part of the product's opinion, identical for every organization and every role. Weighting is not a configurable surface.
- **The score floors at 0% and caps at 100%.** Deductions can zero a score but never drive it negative. The displayed range is always 0–100.
- **C1 measures *how* work was completed, not merely whether it was.** On-time completion, rework, and extension requests are distinct signals — task state alone does not determine C1.

**Score visibility (confirmed)**

- An individual sees **their own score only** — never a peer's, and never their position relative to peers.
- A manager sees the scores of the people reporting to them, **including how those people compare to each other**.
- That comparative view exists only looking *down* the reporting chain. Comparison is never surfaced to the individual being compared.
- Visibility extends further up the chain: skip-level leadership and a designated people-operations role can see scores beneath them.

Recorded as the user stated it. Per Product Principle 5, the *shape* of this model is the durable fact — visibility follows a configurable reporting chain plus a designated people-ops role — while "manager," "skip-level," and "HR" are this organization's titles and must not be hard-coded as product concepts.

**Technical constraints (binding)**

- Next.js (App Router), React, TypeScript, Tailwind CSS.
- Desktop-first; mobile is a secondary adaptation.
- Scalable, component-based architecture: reusable UI components, clean folder structure, maintainable patterns.
- Performance, consistency, and accessibility are stated priorities.

**Deployment**

- Internal to one company today, with the intent to sell it as a product later. Design and architecture must avoid hard-coding this organization's structure, roles, or vocabulary.

**Explicitly undecided**

- **The specific weight values** for C1–C4. The weights are confirmed to be fixed rather than configurable, but the actual numbers are not established. Do not display or imply a weighting split until they are.
- **What qualifies as a C3 policy breach**, and the deduction magnitude per breach type.
- **How C4 attendance is measured** — the input signal and what counts as a shortfall.
- **Whether C2 goal attainment can exceed target**, and if so how that is absorbed given the 100% cap.
- **The scoring period** — whether the percentage is continuous, or resets on a cycle (and the cycle length).
- Multi-tenancy model, when the product is externalized.

## Brand Commitments

- **Name:** Cowork.
- **Identity:** none exists yet. No logo, color system, or typography has been established.
- **Volunteered visual constraint (binding, recorded as stated):** the visual language should remain premium, minimal, and Apple-inspired with subtle glassmorphism — avoiding flashy gradients, excessive animations, or consumer-app aesthetics.
- **Narrative constraint:** Cowork is not an AI product and must not be presented as one.

## Evidence on Hand

None. The repository contains only the unmodified `create-next-app` starter — default page, default `globals.css`, Next.js placeholder SVGs in `public/`. **This is scaffolding, not an incumbent design system**, and carries no visual authority: the Geist fonts, the zinc palette, and the starter's layout are defaults nobody chose for Cowork and should not be preserved out of deference.

There is no real team data, no organizational data, no metrics, no customers, and no prior designs or screenshots available. Future work must use clearly fictional placeholder content and must not fabricate real people, teams, benchmarks, customer names, testimonials, pricing, or performance figures presented as genuine.

**Score-specific caution.** Because weights, breach magnitudes, and the scoring period are undecided, any interface showing a score must use placeholder figures that are self-evidently illustrative and must not present a computed-looking breakdown that implies a weighting the product has not chosen.

## Product Principles

1. **Execution and measurement are one system.** Anything that separates "doing the work" from "being measured on it" contradicts the product's reason to exist.
2. **The score informs; it does not become the job.** It is always present, but its presence must not distort attention away from the work that generates it. Two consequences: a score must always be **decomposable** — a person can trace a number back to the C1–C4 components and the actions beneath them, never a verdict handed down without cause — and C3, being deduction-only, must not license a punitive interface. Showing what was lost is accountability; dramatizing it is not.
3. **Two lenses, one product.** The individual and the manager are both first-class. Neither gets a second-class experience, and the seam between them should not show.
4. **Built for all-day expert use.** People live here. Density, speed, and consistency serve them better than hand-holding or novelty.
5. **Don't hard-code today's company.** Internal use now, product later — structures, roles, and vocabulary stay configurable rather than assumed.

## Accessibility & Inclusion

Accessibility is a stated priority for this product. No specific conformance standard has been formally pinned; WCAG 2.1 AA is the reasonable default to work toward and should be confirmed before it is treated as a contractual requirement.
