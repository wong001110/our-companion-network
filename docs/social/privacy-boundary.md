# S3 privacy boundary

Profiles are network-safe, not public: visibility is always friends-only. The server never receives local Companion IDs, local paths, AI keys, prompts, memories, diaries, conversations, personality values, device state or desktop permissions. Unpublishing prevents future profile/download authorization but does not revoke an already-issued short-lived GET URL or delete a friend's prior cache; later S4/S5 work must re-check authorization.
