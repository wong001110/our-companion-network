# Social S0–S1 execution log

- Baseline: `3dbe059160be70acd952344e97e0c2fa1c66a522` (per implementation directive).
- Protocol: server `0.1.0`, protocol `0.1`; authoritative contract documents are in `docs/social/` and no shared package was created.
- Database: migration `20260712000000_device_sessions` removes insecure plaintext refresh-token records and creates device-scoped, hashed sessions. Existing users must sign in again after migration.
- Security: bcrypt-hashed refresh tokens, rotation with previous-token reuse revocation, device-scoped logout, centralized Socket.IO `auth` authentication, no query-string tokens, socket connection limiting, connection-level disconnect grace, and sanitized REST error envelopes.
- Commands run: `npm run prisma:generate` — passed. `npm run build` — passed. `npx prisma validate` — passed. `git diff --check` — passed. `npm run lint` — unavailable because the prototype has no ESLint configuration. `npm test -- --runInBand` — no tests are currently present.
- Manual verification: not run; no running PostgreSQL service and two client installations were available in this workspace.
- Known limitations: presence remains in-memory and single-instance only. S2–S5 friend UI, public companions, assets, invitations, visits, durable events, and remote AI relay are explicitly deferred.
