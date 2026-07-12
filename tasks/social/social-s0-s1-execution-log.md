# Social S0–S1 execution log

## Live local integration follow-up

- Local PostgreSQL database `our_companion_network` was created and synchronized with the Prisma schema using `npx prisma db push --skip-generate`.
- Starting the full Network Server exposed two pre-existing Nest dependency-injection failures in `VisitGateway`: an unused `JwtService` constructor dependency and an unexported `PresenceGateway`. The unused dependency was removed and `PresenceGateway` is now exported from `PresenceModule`; `npm run start` then served `GET /api/meta/health` successfully on port 3001.
- A live client-to-server lifecycle probe against the local server registered a fresh account, authenticated a Socket.IO connection, rotated the refresh token, fetched `/api/auth/me`, recreated the authenticated socket to simulate restart recovery, verified rejected reused refresh tokens revoke REST and Socket access, logged in again, logged out, and verified REST, refresh, and socket reuse are all rejected after logout.
- The first live probe revealed that a consumed refresh token could be accepted. `IdentityService.refreshToken` now checks the consumed-token hash before the active hash and immediately revokes that device session. Regression coverage was added; `npm test -- --runInBand` passed with 2 suites and 4 tests.
- Live lifecycle result: passed for register, socket connection, token rotation, account restore, restart-style socket reconnect, consumed-refresh-token revocation, device-session REST/socket invalidation, and logout revocation. The direct probe used distinct device identities against the real Electron-main HTTP and Socket contract; it did not drive the desktop GUI or simulate a server process outage through the rendered UI.
- Final verification after the live fixes: `npm run build` passed; `npm test -- --runInBand` passed (2 suites, 4 tests); `npm run test:e2e` passed (1 suite, 1 test); `git diff --check` passed.

## Closure repair (after `a1b3c4c2703ac83abc1eff2c4b80673baf0bbf2e`)

- Fixed logout contract: `LogoutDto` accepts only `deviceId`; the access-token device ID must match or the server returns `DEVICE_SESSION_MISMATCH`. A successful logout revokes the matching active device session.
- Access-token validation now requires an active, non-revoked, non-expired `DeviceSession`, applying the same device-session revocation rule to protected REST and sockets.
- Introduced `ProtocolConfigService` as the single protocol/version/features source for metadata and socket authentication. Rate-limit maps now remove expired entries and cap retained keys; deployment policy documents the required future shared limiter/trusted-proxy boundary.
- Tests added: `src/common/protocol-config.service.spec.ts`, `src/identity/identity.service.spec.ts`, and HTTP `test/meta.e2e-spec.ts`. Added `test/jest-e2e.json` so the documented E2E command is executable.
- Commands: `npm run prisma:generate` passed; `npx prisma validate` passed; `npm run build` passed; `npm test -- --runInBand` passed (2 suites, 3 tests); `npm run test:e2e` passed (1 suite, 1 HTTP contract test); `git diff --check` passed.
- Manual integration: not run. Docker is not installed and no reachable PostgreSQL/Network Server was available. Full device-session/socket lifecycle verification remains required before S1 is closed.
- Deferred unchanged: S2–S5 friends, publishing, assets, visits, durable events, and remote AI remain out of scope.

- Baseline: `3dbe059160be70acd952344e97e0c2fa1c66a522` (per implementation directive).
- Protocol: server `0.1.0`, protocol `0.1`; authoritative contract documents are in `docs/social/` and no shared package was created.
- Database: migration `20260712000000_device_sessions` removes insecure plaintext refresh-token records and creates device-scoped, hashed sessions. Existing users must sign in again after migration.
- Security: bcrypt-hashed refresh tokens, rotation with previous-token reuse revocation, device-scoped logout, centralized Socket.IO `auth` authentication, no query-string tokens, socket connection limiting, connection-level disconnect grace, and sanitized REST error envelopes.
- Commands run: `npm run prisma:generate` — passed. `npm run build` — passed. `npx prisma validate` — passed. `git diff --check` — passed. `npm run lint` — unavailable because the prototype has no ESLint configuration. `npm test -- --runInBand` — no tests are currently present.
- Manual verification: not run; no running PostgreSQL service and two client installations were available in this workspace.
- Known limitations: presence remains in-memory and single-instance only. S2–S5 friend UI, public companions, assets, invitations, visits, durable events, and remote AI relay are explicitly deferred.
