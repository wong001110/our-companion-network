# S3 REST contract

Owner endpoints are `/api/companions/mine`, `/api/companions`, profile update/activate/publish/unpublish, and Asset Pack initiate/list endpoints. Pack endpoints issue batches of at most 50 upload or download URLs, complete, activate, delete eligible non-active packs, and retrieve a manifest. `GET /api/friends/:friendUserId/companion` returns only an accepted unblocked friend's published active profile; all unavailable cases are `404 COMPANION_NOT_AVAILABLE`.
