# Shared multiplayer match layer

This directory is game-independent. A game connects through `MultiplayerMatchAdapter`
and three projections: lifecycle, round result, and final result. Realtime events are
treated as invalidations; every event is reconciled through an authoritative `load()`
so private state is never trusted from a public broadcast.

`useMultiplayerMatch` owns boot/reconnect, foreground resume, stale-event watchdog,
versioned timeout claims, round synchronization, ordered round/final presentation,
and confirmed exit. It intentionally contains no Domino or Okey imports.

Adapters must keep commands server-authoritative and idempotent. In particular,
`claimTimeout` must compare all three claim fields and `startNextRound` must use the
completed round id as its idempotency boundary.
