# WebSocket contract

Socket.IO authentication is centralized. Clients provide `auth.token`, `auth.deviceId`, and `auth.protocolVersion`; URL query tokens are rejected. Authenticated gateways receive `client.data.userId`, `deviceId`, and `protocolVersion`. Invalid sockets receive no protected data and disconnect.

Presence is connection-level only in S1. It remains in-memory for single-instance development and is not horizontally scalable. The last socket starts a configurable 45-second disconnect grace period before offline state is written.

Rate limits use the direct socket address supplied by Socket.IO; the service does not trust forwarded client-IP headers. Before running behind Cloudflare or another reverse proxy, configure a trusted-proxy boundary and replace the in-memory limiter with a shared Redis-backed implementation.
