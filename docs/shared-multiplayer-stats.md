# Shared multiplayer statistics

## Contract and lifecycle test map (before implementation)

The existing engines remain the only authorities for winners and termination.
Manual leave records one personal loss immediately; takeover alone records nothing.
Finalization records only missing human results. No winner means no new final results.
Rewards and wallets are not inputs to statistics. Test matches do not count.

| Existing terminal path | Database/lifecycle test |
| --- | --- |
| Okey ordinary final round, last-human-winner, team elimination | Engine round settlement -> authoritative commit -> final results |
| Okey two manual leaves on a team | Manual losses first, engine team-forfeit winner for remaining seats |
| Okey manual leave plus teammate timeout / two teammate timeouts | Engine-produced team-forfeit, no loss before terminal commit |
| Okey no-humans | Prepared existing no-humans path; four manual losses, zero final inserts |
| Okey bot/eliminated turn and maintenance finish | Same authoritative commit; no separate stats RPC in workers |
| Okey round-only finish / next round / takeover / take-back-seat | No stats until authoritative match finish |
| Domino 1v1 human move/pass finish | Existing commit writes authoritative winner; one result per human |
| Domino 1v1 start_one_vs_one_game pending score finish | Direct room update captured by deferred trigger |
| Domino 1v1 manual / second-timeout terminal round | Existing resolver executes; final opposing winner, no intermediate winner counted |
| Domino 2v2 human normal finish | Existing authoritative winningTeamId counts even when room status remains active |
| Domino 2v2 whole-team manual / timeout / mixed forfeit | Existing SQL resolver, per-player manual loss precedence |
| Domino bot finish / status-only finish | Same deferred final adapter reads persisted winner |
| Domino all manual leave / zero-human timeout | Existing no-winner state; only previously recorded manual losses remain |
| Both games cancelled/waiting/test | No results |
| Retry, overlapping leave/final, state rewrites in one transaction | Unique ledger + room serialization + final persisted state |

## Storage and integration

`public.multiplayer_match_stat_results` is the result ledger, keyed by
`(game_type, match_id, user_id)` with game types `okey`, `domino_1v1`, `domino_2v2`.
The private writer updates profile counters only after a successful new insert.
Adapters preserve the original human identity even while a bot controls the seat.
Okey commits invoke their adapter after command insertion in the same transaction.
Domino leave RPCs invoke the manual adapter before their existing finalization;
deferred room triggers read the final persisted state after takeover resolvers.

No client can execute the private writer or write the ledger. No gameplay engine,
reward amount, payout, or terminal policy changes. Okey uses its existing is_test;
Domino has an explicit server-owned is_test flag for server-side fixtures. Local
preview/practice modes do not use these database paths.

## Deployment boundary

This migration does not backfill history. Deploy during a drained-match window:
active matches with pre-migration manual losses need a separately reviewed ledger
seed or must finish before deployment. Do not replay historical settlements to
repair statistics. Existing profile totals are retained. Mark server test rooms
before play starts. Deleting an account removes its ledger rows, not other users'
counters. Run database and engine tests before applying to Remote.

## Verification and remaining limits

- Shared Stats: 31 database tests and 15 real-engine lifecycle tests pass.
- TypeScript typecheck passes; existing Okey core suite: 276 tests pass.
- Existing Domino suites: 98/98 pass. Two source-text assertions in
  `domino-one-vs-one-module-boundary.test.ts` now tolerate multiline formatting
  and an optional trailing argument comma; production code is unchanged.
- Full migration-chain audit stops at the pre-existing
  `20260813000300_okey_runtime_integrity.sql`: `okey.match_chat_messages` is missing.
  The earlier `20260802000500_okey_match_chat.sql` is a history-preserving no-op,
  but runtime integrity still creates indexes on that removed historical table.
  This historical fresh-install issue is outside the Stats migration.
  The new migration runs successfully in the isolated PostgreSQL/PGlite fixture.
- PGlite serializes requests: overlapping version-claim/retry tests pass, but real
  multi-session PostgreSQL lock/MVCC stress has not been run in this environment.
- All five replaced RPC bodies were compared with their prior definitions; only
  the intended stats statements differ. No Remote migration or backfill was run.

## Primary workspace verification

Changes were transferred to `D:/domino-app` after comparing existing SQL
migrations and authoritative engines. Newer Okey reconciler changes in D were
preserved. All reported suites were rerun from D; no Remote SQL was executed.
