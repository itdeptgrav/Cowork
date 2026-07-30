# Working on Cowork

## The Help knowledge base is product logic

`lib/help/knowledge.ts` is part of the product, not documentation that trails it.

**Any change to user-facing behaviour ships with its help update, in the same
piece of work.** That covers UI fields, workflows, permissions, roles, approval
logic, task states, scoring rules, settings and employee-status logic.

Why it is a hard rule rather than a nicety: the assistant answers from this
corpus. An article describing behaviour that no longer exists is worse than a
missing one — a reader cannot tell a stale answer from a current one, and a
confident wrong answer about who approves their work, or about what makes them
Online, sends them to argue with a system that is behaving correctly.

### Every feature is four things

1. **Code** — the behaviour.
2. **UI** — including any contextual copy that restates the same rule. Two
   places stating one rule is two places to update.
3. **Help knowledge** — the affected articles' `answer`, `keywords` and
   `examples`. Quote the message people actually see rather than paraphrasing
   it; a help article that describes a refusal in different words than the
   refusal itself is hard to match against the screen.
4. **Tests.**

### Before calling a feature done

- Name the user-facing behaviour that changed. If none did, say so and move on.
- Update the affected articles. Search `lib/help/knowledge.ts` for the old
  vocabulary, not just the new — a renamed concept leaves the old name behind.
- Check no article still explains the old behaviour.
- Every article carries a `source` field naming where its rule lives. Use it: if
  you changed that file, the article is a candidate.

### What the tests hold, and what they cannot

`lib/help/coverage.test.ts` fails the build when the product grows a user-facing
concept the corpus does not explain — a new task status, a deadline model, a
permission-denial reason, an admin surface. It also fails on named removals, so
an article describing deleted behaviour is caught.

It **cannot** catch a rule that changed while its vocabulary stayed the same:
"managers can approve this" quietly becoming "managers cannot". Nothing
mechanical will catch that. It belongs in the review of the change that made it.
