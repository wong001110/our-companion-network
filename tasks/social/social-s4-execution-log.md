# Social S4 execution log

- Added immutable `VisitInvitation` and `VisitSession` PostgreSQL models with restrictive Pack/Companion relations and a unique session-per-invitation constraint.
- Implemented consented invitation, readiness, start, end, heartbeat, timeout, session asset, and invalidation flows.
- Added immediate friendship/block/unpublish revocation and superseded Pack pinning.
- Bumped Social protocol defaults to `0.3` / `0.3.0`; `visualVisits` remains `false`.
- Added focused lifecycle/privacy tests and an opt-in PostgreSQL migration verification test.

## S4 closure repair (2026-07-13)

- Previous reviewed baseline: `0b64ab6c1bc3ac2fc4c89dbf62d7bde8a5f37ac1`.
- Closure repair commit: `fa3f9c4` (`fix: close visit pack lifecycle gaps`).
- Follow-up migration: `20260713150000_s4_visit_pack_live_references` preserves `assetPackSnapshotId` for history while retaining nullable, `SetNull` live Pack references only for pending Invitations and non-terminal Sessions.
- Superseded Pack cleanup now checks live Invitation and Session references, avoiding terminal-history Pack pins and deleting-Pack zombies.
- Unpublish locks the Companion row, cancels pending Invitations, ends non-terminal Sessions, and emits participant invalidations. Accept rechecks publication, visibility, Pack identity, and Pack state while locked.
- Invitation snapshots are loaded inside the participant/Companion/Pack lock transaction. Participant row locking is deterministic and a new opt-in PostgreSQL concurrency test uses two Prisma connections to exercise overlapping accept attempts.
- Heartbeat timeout fallback uses lifecycle timestamps instead of treating a missing first heartbeat as epoch zero. Visit list filters and asset file-ID payloads are validated. Visit capability flags are disabled when asset storage is unavailable.
- Verification passed: Prisma generation and validation, Network build, Network unit suite (64 tests), HTTP E2E suite (3 tests), and live private-R2 integration (1 test; isolated objects removed).
- PostgreSQL migration and separate-connection concurrency integration passed with `RUN_POSTGRES_INTEGRATION=1` (3 tests). They create isolated schemas and remove them after verification.
- Two-client S4 smoke test: passed (reported by the tester). No S5 visual Visit work was started.
