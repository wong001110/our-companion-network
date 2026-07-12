# REST contract

`POST /api/auth/register` and `POST /api/auth/login` require `email`, `password`, `username` (register), and a UUID `deviceId`. They return a user plus access and refresh tokens inside `data`. `POST /api/auth/refresh` rotates a device-scoped refresh token. `POST /api/auth/logout` requires an access token and `deviceId` and revokes that device session.

Refresh tokens are bcrypt-hashed in `DeviceSession`; rotated previous tokens trigger session revocation if reused. Tokens are never logged.
