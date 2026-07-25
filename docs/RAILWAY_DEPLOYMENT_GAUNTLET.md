# Railway Deployment — Agent Quality Gauntlet

## Scope

- Docker image for the NestJS Network API.
- Docker image for the React Portal.
- Railway config-as-code files for both services.
- Railway PostgreSQL bootstrap and future migration handling.
- Same-origin Portal reverse proxy over Railway private networking.
- Production variable templates and operator deployment guide.

## Exclusions

- Creating or managing the Railway account/project through an external connector.
- Multi-replica Socket.IO or distributed timer support.
- Redis adapter, autoscaling, multi-region deployment and Portal CDN separation.
- Changes to Companion Social, Visit or Memory behavior.

## Automated checklist

- [x] API binds to `0.0.0.0` and Railway `PORT`.
- [x] API image contains compiled NestJS, Prisma Client, migration tooling and Caretaker CLI.
- [x] Portal image serves SPA routes and proxies `/api` through Railway private DNS.
- [x] Empty database bootstrap is explicit and non-empty unbaselined databases are rejected.
- [x] Existing Prisma migration history remains the path for later deployments.
- [x] Initial Caretaker setup is idempotent when password reset is disabled.
- [x] Secrets remain variable-only and are absent from images and Git.
- [ ] API lint, build, tests, health smoke and Docker build green.
- [ ] Portal QA, health smoke, SPA fallback and Docker build green.
- [ ] Independent deployment diff review complete.
- [ ] Merged to `main` and task branch deleted.

## Manual Railway checklist

- [ ] PostgreSQL, API and Portal created in one Railway project/environment.
- [ ] Services named `Postgres`, `network-api` and `network-portal`.
- [ ] Config file paths point at the checked-in API and Portal Railway JSON files.
- [ ] API kept at one replica.
- [ ] Cloudflare R2 credentials configured and asset capability verified.
- [ ] API and Portal public domains generated.
- [ ] API Portal origin allowlist updated to the exact Portal HTTPS domain.
- [ ] Desktop configured with the API public domain.
- [ ] Two-device Social Visit validation completed.

## Rollback

Roll back each Railway service to its previous image. Database changes are not reverted automatically; use a reviewed forward recovery migration and a PostgreSQL backup for destructive changes.
