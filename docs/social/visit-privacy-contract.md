# S4 Visit privacy boundary

Visit records contain coordination IDs, public Companion snapshot fields, status, and timestamps only. They never include a Local Companion ID, local asset path, API key, prompt, memories, diary, chat, relationship data, permissions, runtime state, host files, desktop information, or remote-control commands.

The Host receives session-scoped, short-lived asset URLs only from authenticated REST calls. URLs remain out of Socket.IO and are not part of renderer contracts. S4 has no visitor rendering, movement, AI, interaction, or desktop access; those remain deferred to S5 or later.
