# Social S4 execution log

- Added immutable `VisitInvitation` and `VisitSession` PostgreSQL models with restrictive Pack/Companion relations and a unique session-per-invitation constraint.
- Implemented consented invitation, readiness, start, end, heartbeat, timeout, session asset, and invalidation flows.
- Added immediate friendship/block/unpublish revocation and superseded Pack pinning.
- Bumped Social protocol defaults to `0.3` / `0.3.0`; `visualVisits` remains `false`.
- Added focused lifecycle/privacy tests and an opt-in PostgreSQL migration verification test.
