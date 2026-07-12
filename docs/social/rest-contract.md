# REST contract

`POST /api/auth/register` and `POST /api/auth/login` require `email`, `password`, `username` (register), and a UUID `deviceId`. They return a user plus access and refresh tokens inside `data`. `POST /api/auth/refresh` rotates a device-scoped refresh token. `POST /api/auth/logout` requires `Authorization: Bearer <access-token>` and `{ "deviceId": "UUID" }`; its device ID must match the access-token claim and it revokes that exact device session. `GET /api/auth/me` returns the same public user object as login and register.

Refresh tokens are bcrypt-hashed in `DeviceSession`; rotated previous tokens trigger session revocation if reused. Tokens are never logged.
