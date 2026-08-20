# Domino 1v1 SQL source of truth

Audited against the local repository and the linked `kozel-domino` production catalog on 2026-08-20. Historical migrations are append-only. This document classifies the final object graph; it is not a replacement for migration history.

## Deployment boundary

Production migration history currently ends at:

- `20260819000100_domino_timeout_takeover.sql`
- `20260819000200_domino_manual_leave_takeover.sql`

The following are local, reversible, and pending deployment:

- `20260820115805_domino_one_vs_one_timeout_terminal_round.sql`
- `20260820130711_domino_one_vs_one_sql_contract_cleanup.sql`

Do not assume the pending terminal-round resolver exists in production until the migrations are explicitly deployed and verified.

## Canonical runtime flow

| Concern | Canonical source | Runtime consumers |
| --- | --- | --- |
| Matchmaking | `find_domino_match(text,text,numeric)` | Domino matchmaking UI; shared by 1v1 and 2v2 |
| Waiting-room status/cancel | `get_one_vs_one_matchmaking_status()`, `cancel_one_vs_one_matchmaking(uuid)` | Domino matchmaking UI |
| Snapshot | `get_one_vs_one_snapshot(uuid)` | 1v1 Supabase adapter |
| Start / next round | `start_one_vs_one_game(uuid)` | 1v1 Supabase adapter |
| Commands | `submit_one_vs_one` Edge Function -> `commit_multiplayer_action(...)` | 1v1 command adapter |
| Bot worker | `process_bot_turns` Edge Function | 1v1 bot controller and shared 2v2 worker |
| Timeout policy | `process_one_vs_one_turn_strikes(...)` -> `apply_one_vs_one_timeout_strike_takeover(uuid,uuid)` | post-commit lifecycle; service role only |
| Manual Leave | `leave_one_vs_one_match(uuid)` | 1v1 adapter |
| Terminal round | `resolve_one_vs_one_terminal_round(uuid)` | pending canonical resolver introduced by 20260820115805 |
| Terminal compatibility | `resolve_one_vs_one_round_leave_forfeits(uuid)` | current Edge/worker call sites; adapter to canonical resolver after pending migration |
| Economy settlement | `domino_settle_match(text,uuid)` | shared by 1v1 and 2v2; service role only |
| Realtime | publication entries for rooms, players, moves | invalidation/reload only |
| Chat | `is_game_room_member`, `send_game_chat_message`, `game_chat_messages` | shared Domino/Okey chat |

Heartbeat, presence, reconnect and disconnect have no terminal-round authority. Domino 1v1 takeover is caused only by two consecutive timeout actions.

## Canonical tables

- `one_vs_one_rooms`: public authoritative match envelope, state, version and economy settlement.
- `one_vs_one_players`: seats, ownership and consecutive-timeout takeover state.
- `one_vs_one_private_states`: hands and boneyard; no direct client access.
- `one_vs_one_moves`: ordered authoritative command/event log.
- `one_vs_one_matchmaking_queue`: 1v1 queue compatibility storage used by shared Domino matchmaking.
- `one_vs_one_private_join_attempts`: security/audit data for private joins; no direct client access.
- `multiplayer_match_events`: shared idempotent multiplayer events, including `timeout_takeover`.
- `domino_fun_match_rewards` and `domino_wallet_ledger`: shared 1v1/2v2 economy.
- `game_chat_messages`: shared game chat.

All exposed 1v1 tables have RLS enabled. Private state and join-attempt tables remain deny-by-default to clients.

## Active triggers

| Trigger | Role |
| --- | --- |
| `trigger_set_one_vs_one_*_updated_at` | timestamp maintenance |
| `one_vs_one_manual_leave_penalty` | Manual Leave reward/penalty compatibility |
| `trg_finalize_one_vs_one_takeover_after_round` | terminal-round resolution after state transition |
| `domino_configure_1v1_economy` | shared Domino economy setup |
| `domino_charge_1v1_entry` | shared entry charging |
| `domino_settle_1v1` | shared final settlement |
| `capture_one_vs_one_daily_quest_progress` | shared daily quests |
| `sync_partial_one_vs_one_waiting_queue` | shared waiting-room compatibility |
| `trigger_enforce_one_active_paid_room` | shared paid-room invariant |

None of these is safe to remove during the 1v1-only cleanup.

## Active compatibility that looks legacy

These objects have historical names but are still in the live dependency path:

- `get_one_vs_one_snapshot_before_free_economy(uuid)`
- `get_one_vs_one_snapshot_internal_20260613(uuid)`

The live call chain is:

`get_one_vs_one_snapshot` -> `get_one_vs_one_snapshot_before_free_economy` -> `get_one_vs_one_snapshot_internal_20260613`

They must not be dropped until the snapshot body is flattened in a separate parity-tested migration.

`resolve_one_vs_one_round_leave_forfeits(uuid)` also remains active because current workers call it. The pending terminal-round migration converts it into a compatibility adapter.

## Legacy compatibility RPCs retained

The current application no longer calls these directly, but older clients may. They remain intact because repository absence alone does not prove production inactivity:

- `find_one_vs_one_opponent()`
- `find_one_vs_one_bet_match(numeric)`
- `cancel_one_vs_one_room(uuid)`
- `create_one_vs_one_room(numeric)`
- `join_one_vs_one_room(text)`
- `evaluate_one_vs_one_abandonments_and_forfeits(uuid)`

Before removal: measure API usage over an agreed compatibility window, verify no database function body references the target, revoke access in a reversible release, then drop it in a later release.

## Superseded migration layers

These migrations remain immutable history but their function bodies were superseded by later `CREATE OR REPLACE` definitions:

- Snapshot debug/private-sync/opening fixes from `20260601000200` through `20260615000200`.
- Earlier `start_one_vs_one_game` definitions through `20260705000100`; current behavior includes the `20260816130000` initial-turn timer fix.
- Earlier reward/settlement functions; current shared settlement is finalized by `20260816180000`.
- Earlier no-human/manual-leave/takeover implementations; current policy layers are `20260819000100`, `20260819000200`, and pending `20260820115805`.

Superseded does not mean deletable: clean database rebuilds still require the historical chain.

## Shared with 2v2 or other games

Do not move or remove these as part of a 1v1-only cleanup:

- `find_domino_match`
- `domino_settle_match`
- `domino_cancel_match_and_refund`
- `check_and_finalize_zero_human_room`
- `commit_multiplayer_action`
- `multiplayer_match_events`
- Domino economy/reward tables and triggers
- unified game chat functions/table
- daily-quest capture function
- `process_bot_turns` Edge Function

Okey-specific schemas and authoritative functions are outside this source of truth.

## Cleanup performed

`20260820130711_domino_one_vs_one_sql_contract_cleanup.sql`:

1. Validates that `idx_one_vs_one_moves_room_id_sequence` is structurally identical to the canonical unique index `one_vs_one_moves_room_id_sequence_key`.
2. Drops only that redundant non-unique index.
3. Pins `search_path` on the remaining 1v1 helper functions without changing their bodies or privileges.
4. Replans the existing matchmaking ownership policy with `(SELECT auth.uid())`; its authorization predicate is unchanged.
5. Adds catalog comments identifying canonical, compatibility and legacy RPCs.
6. Changes no function body, trigger, table, grant, gameplay timing or lifecycle behavior.

The matching rollback recreates the redundant index and clears only the comments introduced by the cleanup.

## Final source of truth

- Schema and RLS baseline: `20260524000400``20260524000600`.
- Authoritative action commit: `20260613000200_atomic_game_actions.sql`.
- Current snapshot/reveal chain: through `20260615000200_terminal_one_vs_one_hand_reveal.sql`.
- Current next-round scoring: `20260705000100_settle_one_vs_one_end_hand_score_on_next_hand.sql`.
- Shared economy: `20260810000500_domino_okey_economy.sql` plus `20260816180000_domino_okey_takeover_economy_fix.sql`.
- Realtime: `20260814000400_enable_domino_one_vs_one_realtime.sql`.
- Current start timer: `20260816130000_fix_one_vs_one_initial_turn_timer.sql`.
- Shared chat: `20260818123000_unified_game_chat.sql`.
- Timeout takeover: `20260819000100_domino_timeout_takeover.sql`.
- Manual Leave: `20260819000200_domino_manual_leave_takeover.sql`.
- Unified terminal round: `20260820115805_domino_one_vs_one_timeout_terminal_round.sql` (pending).
- Contract classification/index cleanup: `20260820130711_domino_one_vs_one_sql_contract_cleanup.sql` (pending).
