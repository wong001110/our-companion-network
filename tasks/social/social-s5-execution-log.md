# Social S5 execution log

- Previous baseline: `d09516f2041ffb66c446e63f0e2920aaefaab391`.
- Network implementation SHA: `0443e6424e3263037710175a8bbd9e02733ebec3`.
- Protocol: `0.4` / `0.4.0`; `visualVisits` is capability-gated by private asset transfers.
- Asset contract: creation and acceptance both validate the immutable snapshot Pack for the required S5 animation set. Diagonals remain optional. Missing assets return `VISIT_VISUAL_ASSETS_UNAVAILABLE`.
- No server-side movement or remote AI/private-state synchronization was added.
- Verification: 79 Network unit tests, 3 HTTP E2E tests, Prisma validation, build, and the 3 PostgreSQL migration/concurrency integration tests pass.
- The live R2 integration was not run because it requires explicit authorization to use real external storage credentials.
- Remaining manual verification: approved live R2 integration and the two-client S5 smoke test.

## Automated two-device harness support (in progress)

- Added the flag-gated public cleanup route `POST /api/smoke/cleanup`. It is unavailable unless both `OUR_COMPANION_SMOKE_TEST=1` and `SMOKE_TEST_ALLOW_DESTRUCTIVE_ENDPOINTS=1` are set on a dedicated test Server.
- Network harness SHA: `6a5eeaa9b4bb4da744b164d1cb8b4419bb98fcea`.
- Cleanup validates the current smoke-run namespace, deletes only associated `@example.invalid` test users, Visit records, Pack records, and the exact linked R2 object keys. It is not a general-purpose data endpoint.
- Network unit suite and build pass; the logical two-device live R2 run remains pending dedicated test credentials and database authorization.
