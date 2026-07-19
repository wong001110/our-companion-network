# Our Companion Network

A secure, event-driven platform for Companion-to-Companion interactions.

## Prerequisites

- Node.js 18+ (LTS recommended)
- PostgreSQL 15+
- Redis 7+ (optional, for rate limiting)
- Docker & Docker Compose (optional)

## Quick Start

### 1. Start Database (Docker)

```bash
docker compose up -d
```

Or manually install PostgreSQL and Redis.

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Copy `.env.example` to `.env` and update the values:

```bash
cp .env.example .env
```

### 4. Run Database Migrations

```bash
npx prisma migrate dev
```

### 5. Start Development Server

```bash
npm run start:dev
```

The server will be running at `http://localhost:3001`.

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register new user |
| POST | /api/auth/login | Login |
| POST | /api/auth/refresh | Refresh access token |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/me | Get current user |

Browser Portal authentication uses the same account and `DeviceSession` identity
through `/api/portal/auth/login`, `/refresh`, `/logout`, and `/session`. Tokens
are returned only as Secure, HttpOnly, SameSite cookies. Browser mutations must
send the non-HttpOnly `oc_csrf` cookie value in `X-CSRF-Token`, and their exact
`Origin` must appear in `PORTAL_ORIGINS`. Desktop bearer-token behavior is
unchanged.

### Portal and Caretaker APIs

Owner-scoped Portal routes are under `/api/portal` and include summary, profile,
Companions and Pack history, publication, friends, requests, blocks, Visits,
devices, revocation, and password changes. Their list responses use bounded
stable pagination.

Caretaker routes are under `/api/admin`. They re-check the current database role
on every request and expose bounded account, Companion, Asset Pack, invitation,
session, overview, health, audit, and storage-cleanup views. State-changing
routes require a reason and write the append-only audit log.

### Friends

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/friends/lookup/:code | Lookup by friend code |
| POST | /api/friends/request | Send friend request |
| GET | /api/friends/pending | Get pending requests |
| PATCH | /api/friends/request/:id/accept | Accept request |
| PATCH | /api/friends/request/:id/reject | Reject request |
| GET | /api/friends | List friends |
| DELETE | /api/friends/:id | Remove friend |
| POST | /api/friends/block/:id | Block user |
| DELETE | /api/friends/block/:id | Unblock user |

### Visits

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/visits | Send visit |
| GET | /api/visits/inbox | Get inbox |
| GET | /api/visits/outbox | Get outbox |
| GET | /api/visits/history | Get history |
| GET | /api/visits/pending | Get pending visits |
| PATCH | /api/visits/:id/accept | Accept visit |
| PATCH | /api/visits/:id/dismiss | Dismiss visit |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/notifications | Get notifications |
| GET | /api/notifications/unread-count | Get unread count |
| PATCH | /api/notifications/:id/read | Mark as read |
| PATCH | /api/notifications/read-all | Mark all as read |
| DELETE | /api/notifications/:id | Delete notification |

### Community

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/community/profile/:userId | Get public profile |
| PATCH | /api/community/profile | Update profile |
| POST | /api/community/discoveries | Share discovery |
| GET | /api/community/discoveries | List discoveries |
| GET | /api/community/discoveries/me | My discoveries |
| DELETE | /api/community/discoveries/:id | Delete discovery |

## WebSocket Events

### Client → Server

| Event | Description |
|-------|-------------|
| presence:update | Update presence status |
| visit:send | Send visit |
| visit:accept | Accept visit |
| visit:dismiss | Dismiss visit |

### Server → Client

| Event | Description |
|-------|-------------|
| presence:updated | Friend presence changed |
| presence:friends_online | List of online friends |
| visit:received | Visit received |
| visit:status_updated | Visit status changed |
| notification:new | New notification |

## Project Structure

```
src/
├── common/           # Guards, decorators, interceptors, filters
├── prisma/           # Prisma service and module
├── identity/         # Authentication and user management
├── friend/           # Friend system
├── presence/         # Online presence tracking
├── visit/            # Companion visits
├── notification/     # Real-time notifications
└── community/        # Public profiles and discoveries
```

## Development

### Network Portal

The user Portal and SUPERADMIN Caretaker Desk live in `portal/` and talk only
to the NestJS `/api/portal/*` and `/api/admin/*` session APIs.

For local browser authentication, copy `.env.example` to `.env`. The example
allows the Vite origin at `http://localhost:4173` and intentionally sets
`PORTAL_COOKIE_SECURE=false` because local development uses HTTP. Production
must use HTTPS, list the deployed Portal origin in `PORTAL_ORIGINS`, and set
`PORTAL_COOKIE_SECURE=true`.

Run the API and Portal in separate terminals:

```bash
npm run start:dev
npm run portal:dev
```

Portal verification:

```bash
npm run portal:typecheck
npm run portal:lint
npm run portal:test
npm run portal:build
npm run portal:test:e2e
npm run portal:qa
```

### Run Tests

```bash
npm test
npm run test:e2e
```

### Generate Prisma Client

```bash
npx prisma generate
```

### Manage Superadmins

For a new local database, create the first Caretaker account explicitly:

```bash
npm run admin:setup-initial
```

The command creates the configured account when absent, or promotes the existing
active account with the same email. It reads `INITIAL_SUPERADMIN_EMAIL`,
`INITIAL_SUPERADMIN_USERNAME`, and `INITIAL_SUPERADMIN_PASSWORD` from the
environment. Development defaults are listed in `.env.example`; production
requires explicit strong values. Set `INITIAL_SUPERADMIN_RESET_PASSWORD=true`
only when deliberately resetting an existing account password.

Role changes are available only through the local CLI. The command displays the
resolved account and requires its exact UID plus an audit reason.

```bash
npm run admin:promote -- --uid OC-ABCDEFGH --confirm OC-ABCDEFGH --reason "Initial caretaker setup"
npm run admin:demote -- --uid OC-ABCDEFGH --confirm OC-ABCDEFGH --reason "Caretaker rotation"
```

When a current Superadmin is acting, add `--actor-uid OC-ADMINUID`. Production
also requires both of these action-specific confirmations:

```bash
--environment production
--confirm-production PRODUCTION-PROMOTE-OC-ABCDEFGH
```

Use `PRODUCTION-DEMOTE-<UID>` for demotion. The CLI serializes role changes,
refuses to demote the last Superadmin, and writes each change to the append-only
admin audit log.

### Open Prisma Studio

```bash
npx prisma studio
```

## License

MIT
