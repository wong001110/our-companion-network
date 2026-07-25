# Social Visit MVP — Agent Quality Gauntlet

## Scope lock

- Two authenticated friends and two published Companions.
- Existing invitation, Ready, heartbeat and visual Visit lifecycle remains authoritative.
- One user-approved Discovery copy per Visit.
- Alternating Companion turns, visitor owner starts, maximum 12 turns.
- Deterministic Shared Moment after a terminal Visit.
- Server stores only the approved share copy, bounded turns and Shared Moment.

## Explicit exclusions

- Group Visits, public matchmaking and user-to-user chat.
- Offline personality simulation.
- Server-side Companion Brain, API keys, private Notebook, vector data or raw local Memory.
- Arbitrary attachments and unbounded transcript storage.

## Automated delivery checklist

- [x] Existing friendship, block and participant checks reused.
- [x] Share envelope is field-limited and sanitized.
- [x] Turn order, idempotency and 12-turn cap are deterministic.
- [x] Social state is participant-scoped.
- [x] Shared Moment contains no private Reflection.
- [x] Database migration added with session cascade cleanup.
- [x] Policy unit tests cover sanitization, first-speaker, alternation and limit invariants.
- [ ] CI build, lint, unit and e2e jobs green.
- [ ] Independent diff review complete.
- [ ] Merged to `main` and task branch deleted.

## Adversarial cases

- Non-participant reads or writes a session.
- Host attempts the first Companion turn.
- Same participant sends twice.
- A client replays the same `clientTurnId`.
- A turn is submitted after the limit or after the session ends.
- Friendship is removed or either user blocks the other mid-Visit.
- Share fields attempt to carry arbitrary Memory, prompts or credentials.

## Rollback

Revert the feature commit and apply a follow-up migration that drops `VisitSharedMoment`, `VisitTurn` and `VisitShareEnvelope`. Existing Visit invitation/session tables are unchanged.
