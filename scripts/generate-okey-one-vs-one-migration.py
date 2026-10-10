"""Materialize the shared Okey RPCs with mode aware seat and economy counts.

The source migrations remain the canonical definitions for the 2v2 behavior.
This script is intentionally strict: a source change must be reviewed instead
of silently producing a partial SQL migration.
"""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
migrations = root / "supabase" / "migrations"
target = migrations / "20261009223549_okey_one_vs_one_mode.sql"


def function(source: str, name: str) -> str:
    content = (migrations / source).read_text(encoding="utf-8")
    pattern = rf"(?is)create or replace function public\.{name}\s*\(.*?\n\$\$;"
    matches = re.findall(pattern, content)
    if len(matches) != 1:
        raise ValueError(f"Expected one {name} in {source}: {len(matches)}")
    return matches[0]


def replace_once(sql: str, before: str, after: str) -> str:
    count = sql.count(before)
    if count != 1:
        raise ValueError(f"Expected one occurrence ({count}): {before!r}")
    return sql.replace(before, after)


room = function("20260813000400_okey_membership_release.sql", "okey_room_action")
room = replace_once(room, "  v_player_index smallint;", "  v_player_index smallint;\n  v_capacity integer;")
room = replace_once(room, "        and match.table_id = trim(p_table_id)", "        and match.table_id = trim(p_table_id)\n        and match.mode = case when p_table_id like '1v1:%' then '1v1' else '2v2' end")
room = replace_once(room, "        ) < 4", "        ) < case when p_table_id like '1v1:%' then 2 else 4 end")
room = replace_once(room, "          status,\n          table_id,", "          status,\n          mode,\n          table_id,")
room = replace_once(room, "          'waiting',\n          trim(p_table_id),", "          'waiting',\n          case when p_table_id like '1v1:%' then '1v1' else '2v2' end,\n          trim(p_table_id),")
room = replace_once(room, "      from generate_series(0, 3) candidate", "      from generate_series(0, case when v_match.mode = '1v1' then 1 else 3 end) candidate")
room = replace_once(room, "  -- Presence expiration", "  -- Presence expiration")
room = replace_once(room, "  -- Count room members and presence", "  -- Count room members and presence")
room = replace_once(room, "  if v_match.status = 'waiting' then\n\n    /*\n     * Begin", "  v_capacity := case when v_match.mode = '1v1' then 2 else 4 end;\n  if v_match.status = 'waiting' then\n\n    /*\n     * Begin")
room = room.replace("v_member_count = 4", "v_member_count = v_capacity")
room = room.replace("v_connected_count = 4", "v_connected_count = v_capacity")
room = room.replace("v_confirmed_count = 4", "v_confirmed_count = v_capacity")
room = room.replace("v_member_count <> 4", "v_member_count <> v_capacity")
room = room.replace("v_connected_count <> 4", "v_connected_count <> v_capacity")
room = room.replace("v_confirmed_count <> 4", "v_confirmed_count <> v_capacity")
room = replace_once(room, "    'roomCode', v_match.room_code,", "    'roomCode', v_match.room_code,\n    'mode', v_match.mode,\n    'capacity', v_capacity,")

configure = function("20260802000300_okey_production_lifecycle.sql", "okey_configure_match")
configure = replace_once(configure, "  v_prize_pool numeric(20,2);", "  v_prize_pool numeric(20,2);\n  v_capacity integer;")
configure = replace_once(configure, "  v_entry_fee := round(p_entry_fee::numeric, 2);", "  select case when mode = '1v1' then 2 else 4 end into v_capacity\n  from okey.matches where id = p_match_id and status = 'waiting';\n  if v_capacity is null then raise exception 'match_not_waiting'; end if;\n  v_entry_fee := round(p_entry_fee::numeric, 2);")
configure = replace_once(configure, "v_entry_fee * 4", "v_entry_fee * v_capacity")
configure = replace_once(configure, "v_commission_per_player * 4", "v_commission_per_player * v_capacity")

charge = function("20260802000300_okey_production_lifecycle.sql", "okey_charge_entry_fee")
charge = replace_once(charge, "  v_distinct_user_count integer;", "  v_distinct_user_count integer;\n  v_capacity integer;")
charge = replace_once(charge, "  if v_match.status <> 'waiting' then", "  v_capacity := case when v_match.mode = '1v1' then 2 else 4 end;\n  if v_match.status <> 'waiting' then")
charge = replace_once(charge, "v_seat_count <> 4", "v_seat_count <> v_capacity")
charge = replace_once(charge, "v_distinct_user_count <> 4", "v_distinct_user_count <> v_capacity")
charge = replace_once(charge, "'playerCount', 4", "'playerCount', v_capacity")

settle = function("20260816180000_domino_okey_takeover_economy_fix.sql", "okey_settle_match")
settle = replace_once(settle, "  v_eligible_winners integer;", "  v_eligible_winners integer;\n  v_capacity integer;\n  v_winner_count integer;")
settle = replace_once(settle, "  IF v_match.settlement_at is not null then", "  v_capacity := case when v_match.mode = '1v1' then 2 else 4 end;\n  v_winner_count := v_capacity / 2;\n  IF v_match.settlement_at is not null then")
settle = replace_once(settle, "v_charged_players <> 4", "v_charged_players <> v_capacity")
settle = replace_once(settle, "v_match.prize_pool / 2", "v_match.prize_pool / v_winner_count")
settle = replace_once(settle, "v_payout_per_winner * 2", "v_payout_per_winner * v_winner_count")

refund = function("20260813000300_okey_runtime_integrity.sql", "okey_cancel_match_and_refund")
refund = replace_once(refund, "v_charged_players <> 4", "v_charged_players <> (case when v_match.mode = '1v1' then 2 else 4 end)")

confirm = function("20260814000300_okey_server_countdown_start.sql", "okey_confirm_server_countdown")
confirm = replace_once(confirm, "  v_connected_count integer;", "  v_connected_count integer;\n  v_capacity integer;")
confirm = replace_once(confirm, "  select countdown_deadline_at\n  into v_deadline", "  select countdown_deadline_at, case when mode = '1v1' then 2 else 4 end\n  into v_deadline, v_capacity")
confirm = replace_once(confirm, "v_member_count <> 4 or v_connected_count <> 4", "v_member_count <> v_capacity or v_connected_count <> v_capacity")

parts = [
    "-- Okey 1v1 shares the authoritative engine, room, wallet and lifecycle RPCs.\n"
    "alter table okey.matches add column if not exists mode text not null default '2v2'\n"
    "  check (mode in ('1v1', '2v2'));\n"
    "create index if not exists okey_waiting_mode_matchmaking_idx\n"
    "  on okey.matches(mode, table_id, created_at) where status = 'waiting';\n",
    room, configure, charge, settle, refund, confirm,
    "\nrevoke all on function public.okey_room_action(uuid,text,uuid,text,text,text,jsonb,jsonb,timestamptz) from public, anon, authenticated;\n"
    "grant execute on function public.okey_room_action(uuid,text,uuid,text,text,text,jsonb,jsonb,timestamptz) to service_role;\n"
    "revoke all on function public.okey_configure_match(uuid,numeric,text) from public, anon, authenticated;\n"
    "grant execute on function public.okey_configure_match(uuid,numeric,text) to service_role;\n"
    "revoke all on function public.okey_charge_entry_fee(uuid) from public, anon, authenticated;\n"
    "grant execute on function public.okey_charge_entry_fee(uuid) to service_role;\n"
    "revoke all on function public.okey_settle_match(uuid,text) from public, anon, authenticated;\n"
    "grant execute on function public.okey_settle_match(uuid,text) to service_role;\n"
    "revoke all on function public.okey_cancel_match_and_refund(uuid,text) from public, anon, authenticated;\n"
    "grant execute on function public.okey_cancel_match_and_refund(uuid,text) to service_role;\n"
    "revoke all on function public.okey_confirm_server_countdown(uuid) from public, anon, authenticated;\n"
    "grant execute on function public.okey_confirm_server_countdown(uuid) to service_role;\n",
]
target.write_text("\n\n".join(parts), encoding="utf-8")
print(target)

cleanup = function("20260828025845_stabilize_all_waiting_room_heartbeats.sql", "expire_stale_waiting_room_members")
cleanup = replace_once(
    cleanup,
    "(select count(*) from okey.match_seats seat where seat.match_id = match.id) < 4",
    "(select count(*) from okey.match_seats seat where seat.match_id = match.id) < "
    "(case when match.mode = '1v1' then 2 else 4 end)",
)
cleanup_target = migrations / "20261009224244_okey_one_vs_one_waiting_cleanup.sql"
cleanup_target.write_text(
    "-- Preserve the full 1v1 countdown during shared stale-seat cleanup.\n"
    + cleanup
    + "\nrevoke all on function public.expire_stale_waiting_room_members(integer) "
      "from public, anon, authenticated;\n"
      "grant execute on function public.expire_stale_waiting_room_members(integer) "
      "to service_role;\n",
    encoding="utf-8",
)
print(cleanup_target)
