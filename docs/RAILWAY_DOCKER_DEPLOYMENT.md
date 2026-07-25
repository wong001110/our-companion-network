# Railway Docker Deployment — Network API and Portal

This guide deploys the current MVP as three Railway services in one project:

- `Postgres`: Railway PostgreSQL.
- `network-api`: NestJS, Socket.IO, Prisma and Cloudflare R2 coordination.
- `network-portal`: the React Portal served by Caddy, with same-origin `/api` requests reverse-proxied to `network-api` over Railway private networking.

Keep `network-api` at **one replica**. Presence connection ownership and Visit cleanup timers are currently process-local.

## Repository deployment files

| Service | Dockerfile | Railway config | Variable template |
| --- | --- | --- | --- |
| Network API | `Dockerfile.api` | `/deploy/railway/api.railway.json` | `deploy/railway/api.env.example` |
| Portal | `Dockerfile.portal` | `/deploy/railway/portal.railway.json` | `deploy/railway/portal.env.example` |

## 1. Prepare Cloudflare R2

Create or select the R2 bucket used for published Companion assets. Create an R2 S3 API token limited to that bucket and record:

- Cloudflare Account ID
- bucket name
- access key ID
- secret access key
- endpoint in the form `https://<account-id>.r2.cloudflarestorage.com`

Do not put these values in GitHub.

## 2. Create the Railway project and PostgreSQL

1. Create a new Railway project.
2. Add **Database → PostgreSQL**.
3. Rename the database service to `Postgres` so the checked-in reference variable remains valid.
4. Do not expose PostgreSQL publicly unless external administration is required.

The API variable `DATABASE_URL=${{Postgres.DATABASE_URL}}` uses Railway private networking.

## 3. Add the Network API service

1. Add the GitHub repository `wong001110/our-companion-network` to the same project.
2. Rename the service to `network-api`.
3. In **Settings → Config as Code**, set the config file path to:

   ```text
   /deploy/railway/api.railway.json
   ```

4. In **Variables → Raw Editor**, copy `deploy/railway/api.env.example`.
5. Replace every `replace-me` value.
6. Generate two independent JWT secrets, for example:

   ```bash
   openssl rand -base64 48
   openssl rand -base64 48
   ```

7. For the first deployment, temporarily set:

   ```text
   PORTAL_ORIGINS=https://placeholder.invalid
   CORS_ORIGIN=https://placeholder.invalid
   ```

8. Confirm `PORT=3001` and one replica.
9. Deploy the service.
10. Under **Settings → Networking**, generate a public domain. This is the URL that Our Companion Desktop will use.

### API database bootstrap

The API pre-deploy stage runs, in order:

```text
node scripts/railway-migrate.mjs
node dist/src/admin/initial-superadmin.cli.js
```

Database behavior:

- A completely empty database is created from the current Prisma schema, then all checked-in historical migrations are recorded as the initial production baseline.
- A database with Prisma migration history receives only pending migrations.
- A non-empty database without Prisma migration history is rejected rather than modified automatically.

Caretaker behavior:

- The configured `INITIAL_SUPERADMIN_*` account is created on the first deployment.
- Later deployments keep the account as `SUPERADMIN` without resetting its password when `INITIAL_SUPERADMIN_RESET_PASSWORD=false`.
- Set the reset flag to `true` only for an intentional password reset, deploy once, then return it to `false`.

Do not manually run `prisma db push` against the Railway production database.

## 4. Add the Portal service

1. Add the same GitHub repository again as a second Railway service.
2. Rename it to `network-portal`.
3. In **Settings → Config as Code**, set:

   ```text
   /deploy/railway/portal.railway.json
   ```

4. In **Variables → Raw Editor**, copy `deploy/railway/portal.env.example`:

   ```text
   PORT=8080
   API_ORIGIN=http://${{network-api.RAILWAY_PRIVATE_DOMAIN}}:3001
   ```

5. Deploy the Portal.
6. Generate a public domain for `network-portal`.

The browser talks only to the Portal origin. Caddy forwards `/api/*` and `/socket.io/*` to the API using Railway private DNS, so no API URL is baked into the Vite bundle.

## 5. Finalize Portal origin security

After the Portal public domain exists, replace the two temporary API variables with:

```text
PORTAL_ORIGINS=https://${{network-portal.RAILWAY_PUBLIC_DOMAIN}}
CORS_ORIGIN=https://${{network-portal.RAILWAY_PUBLIC_DOMAIN}}
```

Keep:

```text
PORTAL_COOKIE_SECURE=true
PORTAL_COOKIE_SAME_SITE=strict
```

Redeploy `network-api` after changing these variables.

## 6. Configure Our Companion Desktop

In the Desktop Network settings, use the API public URL generated for `network-api`, including `https://` and without a trailing `/api` path.

Example:

```text
https://network-api-production.up.railway.app
```

The Desktop connects directly to this public API for REST and Socket.IO. The Portal uses the private reverse proxy described above.

## 7. Deployment verification

### API

Open:

```text
https://<network-api-domain>/api/meta/health
https://<network-api-domain>/api/meta/protocol
https://<network-api-domain>/api/meta/client-compatibility
```

Expected:

- health succeeds;
- protocol is `0.4`;
- `socialVisits`, Visit and asset capabilities are reported consistently with the configured R2 credentials.

### Portal

Open:

```text
https://<network-portal-domain>/healthz
https://<network-portal-domain>/login
```

Expected:

- `/healthz` returns `ok`;
- direct navigation to `/login` and other SPA routes loads the Portal;
- the configured initial Caretaker can sign in;
- login cookies are Secure and HttpOnly where applicable;
- browser requests remain on the Portal domain and use `/api/...` paths.

### Social Visit

Use two accounts and two isolated Desktop profiles:

1. Register or log in to both accounts.
2. Publish one Companion and Asset Pack per account.
3. Add the accounts as friends.
4. Confirm Presence updates over Socket.IO.
5. Complete the Social Visit checklist in `our-companion/docs/SOCIAL_VISIT_MVP_CHECKLIST.md`.

## 8. Operational checklist

- [ ] `network-api` has exactly one replica.
- [ ] PostgreSQL and API are in the same Railway project and environment.
- [ ] `DATABASE_URL` is a Railway reference variable, not a copied public URL.
- [ ] JWT access and refresh secrets are different and stored only in Railway.
- [ ] R2 credentials are bucket-scoped and stored only in Railway.
- [ ] Initial Caretaker credentials are unique and the password-reset flag is `false` after setup.
- [ ] Portal origin variables exactly match the generated HTTPS Portal origin.
- [ ] API health check and Portal health check are green.
- [ ] API and Portal public domains use HTTPS.
- [ ] Desktop connects to the API public domain.
- [ ] No API key, local Memory, Notebook, vector data or Private Reflection appears in Network logs or PostgreSQL.
- [ ] Railway PostgreSQL backups and usage alerts are configured before broader testing.

## Rollback

Railway retains previous deployments. Roll back the API and Portal independently from each service deployment history.

Database changes are forward-only. Before applying future destructive migrations, create a PostgreSQL backup and document a corresponding recovery migration.
