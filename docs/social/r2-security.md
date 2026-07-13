# Private R2 boundary

R2 remains private. Only the Network Server reads `CLOUDFLARE_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, and `R2_REGION`. The server generates short-lived, exact-key PUT and GET URLs and never logs or stores them. The desktop renderer receives neither credentials, tokens, object keys nor URLs. Storage configuration or bucket access failure disables S3 flags without disabling S0-S2.
