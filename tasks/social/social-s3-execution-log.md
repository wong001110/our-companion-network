# Social S3 execution log

- Baseline: `6f9d9c3b7dd556a957c8032118ceecd2de5e0379`.
- Complete uses one `{ assetPack, companion }` response envelope for upload, verification, and active retry paths.
- An already-active completion retry returns that envelope before checking current R2 readiness.
- Cleanup claims retired packs as `deleting` and expired uploads as `abandoning` before object deletion. A deletion failure remains claimed and is retried safely later.
- Per-object R2 bulk-delete errors are treated as deletion failures, not successful cleanup.
- Reactivation accepts only `active` and `superseded`; claimed deletion states cannot be reactivated.
- R2 retention reads validated `R2_SUPERSEDED_PACK_RETENTION_DAYS`.

## Verification

- Prisma generation and schema validation passed.
- Network build passed.
- Full unit suite: 9 suites passed, 36 tests passed; one opt-in integration suite skipped in the normal run.
- E2E meta contract: 1 suite / 1 test passed.
- Live private R2 integration: 1 suite / 1 test passed (upload, metadata HEAD, download/hash, manifest, deletion).

## Manual verification

- Two-client desktop smoke test passed: the owner and friend completed the online publish/download flow successfully on separate devices. No credentials, tokens, signed URLs, keys, or local paths are recorded here.

## Follow-up social polish

- `01c191b` returns `hasPublishedCompanion` with each friend. It is true only for the friend’s active `friends_only` Companion with a published asset pack; the protected Companion endpoint remains the final authorization check.
- Friend Code has a database uniqueness constraint and registration now retries a rare Friend Code collision before creating the account.
- Current full Network unit regression: 9 suites passed / 40 tests passed; the opt-in R2 integration suite remains skipped in the ordinary run.

## Final concurrency and Presence repair

- Previous reviewed baseline: `0982e8be199a35e4a5690861b01f682725e86bed`.
- Implementation commit: `10ef2c761153162307880840bd72401b1ec450f2`.
- Asset Pack activation re-reads the Pack inside its transaction. Only `superseded → active` can claim with `updateMany`; an already-current active Pack is idempotent, while `deleting` and every other non-eligible state return `ASSET_PACK_STATE_CHANGED`.
- Completion claims `uploading → verifying` with compare-and-swap and refreshes the verification timestamp. Final activation separately claims `verifying → active`, so cleanup cannot revive or activate an `abandoning` Pack.
- Expired-upload cleanup uses `createdAt` for uploading Packs and `updatedAt` for verifying Packs; a freshly claimed verification is not considered stale. Existing cleanup claim rules remain `superseded → deleting` and stale upload `→ abandoning`.
- Presence disconnect grace is restored to a safe default of 45 seconds. `0` remains an explicit immediate-offline setting; invalid values safely fall back to 45 seconds. `.env.example` documents both choices.

## Final verification

- Focused lifecycle and Presence suites: 2 suites / 19 tests passed.
- Prisma generation and schema validation passed.
- Full unit suite: 9 suites passed / 51 tests passed; the opt-in R2 suite is skipped in the ordinary run.
- E2E meta contract: 1 suite / 1 test passed.
- Live private R2 integration: 1 suite / 1 test passed (private upload, HEAD metadata, download/hash, manifest write, deletion, and cleanup).
- The prior two-client S3 smoke test remains valid; no Client protocol or runtime code changed here.
- S4 and S5 remain deferred.

## Single active Asset Pack final closure

- Previous reviewed baseline: `5bd7abb80f0157a1d30312daf7333833234a08c9`.
- Implementation commit: `7b499cfa21a94afbbb30d22a053c1ab5bdf18e4f`.
- Migration: `20260713100000_s3_one_active_asset_pack_per_companion` creates the PostgreSQL partial unique index `CompanionAssetPack_one_active_per_companion` on active Pack rows per Companion.
- Before creating the index, the migration keeps the pointer-preferred active Pack, supersedes duplicate active rows, repairs pointers to the selected active Pack, and clears pointers with no active Pack.
- Both Complete and manual activation use the shared transactional activation helper. It locks the `NetworkCompanion` row with `FOR UPDATE`, supersedes every other active Pack, conditionally activates the target, and then writes the authoritative pointer.
- Active-Pack reuse now checks the Companion pointer. An orphan active Pack returns `requiresActivation: true` and activation repairs it under the same lock.
- A partial-index unique conflict retries the locked activation once, then maps a repeated conflict to `ASSET_PACK_STATE_CHANGED`.

## Single active Asset Pack verification

- Focused Companion lifecycle suite: 1 suite / 14 tests passed, including shared-lock, orphan-repair, cleanup, and unique-conflict cases.
- PostgreSQL migration/invariant integration: 1 suite / 1 test passed using transaction-local temporary tables. It executed the real migration SQL, normalized duplicate active rows and invalid pointers, rejected a second active Pack for the same Companion, and allowed another Companion’s Pack.
- Full Network unit suite: 9 suites passed / 54 tests passed; 2 opt-in integrations skipped in the ordinary run.
- E2E meta contract: 1 suite / 1 test passed.
- Live private R2 integration: 1 suite / 1 test passed (private upload, metadata HEAD, download/hash, manifest write, and cleanup).
- Invariant confirmed: each Companion has zero or one active Asset Pack, and the pointer matches that Pack. The existing two-client S3 smoke test remains valid. S4 and S5 remain deferred.
