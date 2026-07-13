# S3 Asset Pack contract

An Asset Pack V1 is immutable and addressed by the SHA-256 of canonical JSON. Paths are POSIX, sorted, and limited to managed `assets/` files. Files are sorted by relative path; animation mappings and each mapping's file list are sorted. Timestamps, local IDs, server IDs, object keys and URLs are excluded. `Idle_Neutral`, `Enter`, and `Leave` mappings are required. SVG, links, traversal, hidden files, case collisions and unsupported types are rejected. Voice files require explicit client opt-in.
