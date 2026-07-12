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

### Run Tests

```bash
npm test
npm run test:e2e
```

### Generate Prisma Client

```bash
npx prisma generate
```

### Open Prisma Studio

```bash
npx prisma studio
```

## License

MIT
