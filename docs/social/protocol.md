# Social protocol 0.1

The Network Server is the authoritative protocol source. Client version `0.1.0` uses protocol `0.1` and sends `X-Our-Companion-Client-Version`, `X-Our-Companion-Protocol-Version`, and `X-Our-Companion-Device-Id` on every REST request. `GET /api/meta/health`, `/protocol`, and `/client-compatibility` are public discovery endpoints.

Successful REST responses are `{ "data": T }`. Errors are `{ "error": { "code", "message", "requestId" } }`. No shared npm package is used; canonical examples belong in this repository and are copied into client contract tests when updated.

Current feature flags only advertise authentication and socket connection. Friends, presence UI, public companions, assets, invitations, and visits remain unavailable in protocol 0.1.
