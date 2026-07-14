# S5 Visual Visit contract

Protocol `0.4` exposes `visualVisits` only while private Asset Pack transfers are available.

A Visit snapshot Pack must include `Idle_Neutral`, `Enter`, `Leave`, `Walk_Left`, `Walk_Right`, `Walk_Up`, and `Walk_Down`. Invitation creation validates the immutable active snapshot; acceptance validates it again while the invitation, participants, Companion, and Pack are locked. Missing required assets return `VISIT_VISUAL_ASSETS_UNAVAILABLE` without exposing the manifest.

Diagonal animations are optional. The Network stores no visual position, direction, animation frame, movement target, AI prompt, memory, speech, or interaction data. Socket events remain invalidation-only; clients fetch authoritative REST session state before creating or removing local visual representation.

The Server remains authoritative for consent, participants, friendship/block/revocation, Pack snapshot identity, session lifecycle, timeouts, and session-scoped asset authorization. It does not create a remote Companion runtime or transmit private local Companion state.
