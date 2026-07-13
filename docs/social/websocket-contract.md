# S3 websocket contract

REST is authoritative. The server emits minimal invalidations only to the owner and current accepted unblocked friends: `companion.profile.updated`, `companion.profile.unpublished`, and `companion.asset_pack.activated`. Clients re-fetch REST state; manifests, object keys and presigned URLs are never socket payloads.
