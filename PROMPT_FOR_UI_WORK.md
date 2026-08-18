# Prompt — restyle the Cowork task page (visual only)

Copy everything below the line and give it to Claude.

---

I want you to change **only how the task page LOOKS** — layout position, spacing,
colour, typography, borders, rounding, order of visual blocks. **Do not change
any behaviour, any rule, any calculation, any text that states a rule, or any
data.** This is a restyle, not a refactor.

## The single hard rule

If a change could alter **what the product does or says**, do not make it. Only
change **how it looks**.

Allowed: CSS classes, inline styles, design tokens, spacing, colour, font size
and weight, border radius, shadows, where a block sits on the page, the order of
visual sections, responsive breakpoints, icon choice, panel grouping.

Not allowed, under any circumstances:

- **Any file under `lib/rules/`** — this is the pure logic layer. Every business
  rule lives here. Do not open it to edit.
- **Any file under `lib/repositories/`** — data reads and writes.
- **Any file under `lib/domain/`** — types and shapes.
- **`lib/help/knowledge.ts`** — the product's knowledge base, which the
  in-app assistant answers from. Changing it makes the assistant lie.
- **Anything in `../grav-cms-backend`** — the backend engine. Out of scope.
- Any `useQuery`, `useAction`, `useEffect`, `useState`, or repository call —
  do not add, remove, reorder, or change the dependencies of any hook.
- Any condition that decides **whether** something renders (`x && <Panel/>`,
  ternaries on state). You may restyle both branches; you may not change which
  one is chosen.
- Any user-facing sentence that states a rule, an amount, a date, or a name.
  Restyle the text; do not reword it.

## Why this is stricter than it sounds

This codebase has **86 test files that read component source code as text** and
assert on it. They exist because rules were being quietly changed by edits that
looked cosmetic. Examples of what they check:

- that a hook is called **above** the early `return` statements
- that a total is summed with one specific expression
- that a particular sentence appears in a particular paragraph
- that a `data-help="..."` attribute is still on a specific button

So **moving JSX around can fail tests even when the UI is identical**. That is
working as intended — it is the guard. If a test fails after a purely visual
change, do not edit the test to make it pass. Stop and report it.

Two more traps:

- `data-help="..."` and `data-figure` attributes are load-bearing. Keep them on
  the same elements.
- The file uses **CRLF line endings**. Multi-line find-and-replace with `\n`
  will silently fail to match.

## Where the visual work actually lives

- `components/features/tasks/` — the task page and its panels. Most of your work
  is here. These files mix markup with hook calls; touch the markup only.
- `components/ui/` — the shared primitives (Panel, Button, Chip, IconTabs,
  Workspace). Changing one restyles the whole product, so be deliberate.
- `app/globals.css` — the design tokens (`--ink`, `--surface`, `--state-*`,
  `--control`). **Prefer changing a token over hardcoding a colour.** There is
  no `--attention` token; the existing state tokens are `--state-positive`,
  `--state-overdue`, `--state-rework`, `--state-extension`, `--state-risk`,
  `--state-blocked`, each with a matching `-ink` variant.

The page must stay **theme-aware** (it has light and dark) and **responsive**.
Do not introduce a hardcoded hex colour where a token exists.

## How to verify — run all three before you say you are done

```bash
npx tsc --noEmit
```

```bash
npm test
```

```bash
npx eslint components/ lib/
```

`npm test` must report **0 failures**. Report the pass/fail numbers in your
summary. Do not run `npm run build` — a dev server may be running and sharing
`.next`, and building over it corrupts the route types and causes 404s.

## What to give me back

1. A list of every file you changed, with one line saying what changed visually.
2. Confirmation that `lib/rules/`, `lib/repositories/`, `lib/domain/` and
   `lib/help/knowledge.ts` are untouched — check with `git status`.
3. The test numbers.
4. Anything you wanted to change but did not because it would have altered
   behaviour. Tell me; do not decide for me.

If you are ever unsure whether something counts as logic — **it does. Ask me.**
