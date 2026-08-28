-- Remove the retired external WebSocket/Railway gameplay connection gateway.
-- Presence and stale-member cleanup remain owned by each game's existing
-- heartbeat/last_seen_at functions and Supabase-backed cleanup jobs.

do $$
declare
  v_job_id bigint;
begin
  if to_regclass('cron.job') is not null then
    for v_job_id in
      select jobid from cron.job where jobname = 'game-room-connection-sweep'
    loop
      perform cron.unschedule(v_job_id);
    end loop;
  end if;
end
$$;

do $$
begin
  if to_regclass('okey.match_seats') is not null then
    execute 'drop trigger if exists game_room_connection_provision on okey.match_seats';
  end if;
  if to_regclass('public.one_vs_one_players') is not null then
    execute 'drop trigger if exists game_room_connection_provision on public.one_vs_one_players';
  end if;
  if to_regclass('public.two_vs_two_players') is not null then
    execute 'drop trigger if exists game_room_connection_provision on public.two_vs_two_players';
  end if;
end
$$;

drop function if exists public.game_room_connection_issue_ticket(uuid);
drop function if exists public.game_room_connection_consume_ticket(text);
drop function if exists public.game_room_connection_join_room(uuid, text, uuid, uuid);
drop function if exists public.game_room_connection_begin_disconnect(uuid, text, uuid, uuid, bigint, integer);
drop function if exists public.game_room_connection_detach_connection(uuid, text, uuid, uuid, bigint);
drop function if exists public.game_room_connection_sweep_expired_connections(integer);

drop schema if exists game_room_connection cascade;