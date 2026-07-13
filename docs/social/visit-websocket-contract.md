# S4 Visit websocket contract

Sockets are invalidation-only. The server publishes through `SocialEventPublisher`:

- `visit.invitation.created` and `visit.invitation.updated`: `{ invitationId }`
- `visit.session.created`, `visit.session.updated`, and `visit.session.ended`: `{ sessionId, state }`

Clients re-fetch the authoritative REST record. Socket payloads never contain a profile snapshot, manifest, object key, pre-signed URL, access token, local identifier, or local path.
