# Social S2 execution log

- Baseline: `b0c914e3188ff815d38572f59af08c714e05854a`.
- Data: added FriendRequest lifecycle timestamp and indexes in `20260712010000_s2_social_lifecycle`; terminal directed requests are reopened to allow resending.
- Rules: reverse pending requests accept the existing request; friendships are symmetric directed pairs; blocks remove friendships, cancel requests in both directions, and return generic social errors to the blocked user.
- Events: user Socket.IO rooms publish friend/block invalidations and friend-only presence updates. Presence supports online, idle, offline, activity throttling, multi-socket aggregation, and disconnect grace.
- Verification: Prisma validation, server build, 7 unit tests, schema push, and two-account PostgreSQL REST lifecycle verification passed.
- Deferred: S3 public profiles/assets, S4 invitations, and S5 visits remain out of scope.
