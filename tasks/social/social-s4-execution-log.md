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

## S4 heartbeat configuration closure (2026-07-14)

- Previous reviewed baseline: `39b1e483bde555d7bfe6cc03adc890d6fca2eb69`.
- Authoritative heartbeat configuration is `VisitConfigService`; both `VisitService` timeout cleanup and compatibility metadata read the same validated limits.
- Compatibility now returns the additive sanitized `visit` runtime object only while Visit capability is enabled: `heartbeatIntervalSeconds` and `heartbeatTimeoutSeconds`.
- Effective timeout formula: `max(30, configuredTimeout, interval * 2, interval + 5)`. This protects existing protocol 0.3 clients that still send a fixed 15-second cadence.
- Defaults are 15-second interval and 60-second timeout. Invalid values fall back safely; low configured values are clamped to the formula.
- `.env.example` documents the public cadence and effective timeout rule without exposing private configuration.
- Focused heartbeat/config tests passed (22 tests); full Network unit suite passed (76 tests), HTTP E2E passed (3 tests), PostgreSQL integration passed (3 tests), and live R2 integration passed (1 test).
- Remaining manual verification: two-client default, custom 5/30-second, and reconnect heartbeat smoke tests.
