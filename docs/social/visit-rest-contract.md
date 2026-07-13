# S4 Visit REST contract

S4 permits one direction only: the Visitor Owner sends their active published Network Companion to an accepted friend, the Host. `POST /api/visit-invitations` accepts only `{ hostUserId }`; the server snapshots the Network Companion, immutable active Asset Pack, public name, description, and tags.

Invitation routes are `GET/POST /api/visit-invitations` and `POST /:id/accept`, `/decline`, `/cancel`. Valid invitation states are `pending`, `accepted`, `declined`, `cancelled`, and `expired`. Acceptance is transactionally idempotent and creates one `preparing` session through a unique invitation relation.

Session routes are `GET /api/visit-sessions`, `GET /:id`, and `POST /:id/ready`, `/start`, `/end`, `/heartbeat`. Both roles acknowledge preparation; only the Host starts `ready → active`; either participant ends. The server permits only one non-terminal session per participant, using participant row locks plus transactional checks.

Hosts alone can use `GET /:id/assets/manifest` and `POST /:id/assets/download-urls`. A session can access its immutable Pack while it is `active` or `superseded`, but never while it is deleting, failed, or terminal. URL batches are limited to 50 file IDs and reauthorize friendship and blocks every time.

Cleanup expires pending invitations and ends timed-out sessions. Friendship removal, blocking, and Companion unpublishing end sessions immediately. Superseded Packs referenced by a non-terminal session are pinned from S3 cleanup.
