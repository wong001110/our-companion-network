# S3 execution log

- Baseline: `0ee9e9331c38726907674aff8a160fb66b70d226`
- Protocol: `0.2`; migration: `20260713000000_s3_public_companions`.
- Added Network Companion and immutable Asset Pack/File metadata, server-generated private R2 keys, presigned URL batches, object verification, activation, friends-only profile/download authorization and invalidation events.
- R2 environment variable names only: `CLOUDFLARE_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_REGION`.
- Completed locally: applied the migration to local PostgreSQL after recording the already-present S0-S2 schema migrations; Prisma generate/validate/status, Nest build, unit suite (8 passing suites / 31 passing tests; opt-in integration skipped), metadata E2E suite (1 suite / 1 test), and diff check.
- Added and passed an opt-in private R2 integration test using `RUN_R2_INTEGRATION=1`: disposable prefix PUT, HeadObject, GET/hash verification, manifest write and cleanup. Presigned PUTs require the signed `content-type` and `x-amz-meta-sha256` headers.
- Not run: two-client S3 smoke. S4-S5 are deferred.
