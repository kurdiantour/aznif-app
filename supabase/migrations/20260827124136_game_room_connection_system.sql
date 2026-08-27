create schema if not exists game_room_connection;
revoke all on schema game_room_connection from public,anon,authenticated;
grant usage on schema game_room_connection to service_role;
create sequence game_room_connection.connection_generation_seq;

create table game_room_connection.auth_tickets(
 ticket_hash text primary key,user_id uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null,consumed_at timestamptz,created_at timestamptz not null default clock_timestamp());
create index game_room_auth_tickets_expiry_idx on game_room_connection.auth_tickets(expires_at) where consumed_at is null;
create table game_room_connection.membership_leases(
 game_type text not null check(game_type in('okey','domino_1v1','domino_2v2')),room_id uuid not null,
 user_id uuid not null references auth.users(id) on delete cascade,lease_version bigint not null default 0,
 phase text not null check(phase in('waiting','playing','finished')),updated_at timestamptz not null default clock_timestamp(),
 primary key(game_type,room_id,user_id));
create table game_room_connection.connections(
 game_type text not null,room_id uuid not null,user_id uuid not null,connection_id uuid not null,generation bigint not null,
 state text not null check(state in('active','grace','disconnected')),grace_deadline_at timestamptz,joined_at timestamptz not null default clock_timestamp(),
 disconnected_at timestamptz,updated_at timestamptz not null default clock_timestamp(),primary key(game_type,room_id,user_id,connection_id),
 foreign key(game_type,room_id,user_id) references game_room_connection.membership_leases on delete cascade,
 check((state='grace')=(grace_deadline_at is not null)));
create index game_room_connections_live_idx on game_room_connection.connections(game_type,room_id,user_id,state) where state in('active','grace');
alter table game_room_connection.auth_tickets enable row level security;
alter table game_room_connection.membership_leases enable row level security;
alter table game_room_connection.connections enable row level security;
revoke all on all tables in schema game_room_connection from public,anon,authenticated;
grant all on all tables in schema game_room_connection to service_role;
grant usage,select on sequence game_room_connection.connection_generation_seq to service_role;

create function game_room_connection.issue_ticket(p_user_id uuid) returns text language plpgsql security definer set search_path=pg_catalog,game_room_connection as $$
declare v text:=encode(extensions.gen_random_bytes(32),'hex'); begin
 if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 delete from game_room_connection.auth_tickets where expires_at<clock_timestamp()-interval '1 minute';
 insert into game_room_connection.auth_tickets values(encode(extensions.digest(v,'sha256'),'hex'),p_user_id,clock_timestamp()+interval '30 seconds',null,clock_timestamp()); return v; end$$;
create function game_room_connection.consume_ticket(p_ticket text) returns uuid language plpgsql security definer set search_path=pg_catalog,game_room_connection as $$
declare v uuid; begin if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 update game_room_connection.auth_tickets set consumed_at=clock_timestamp() where ticket_hash=encode(extensions.digest(p_ticket,'sha256'),'hex') and consumed_at is null and expires_at>=clock_timestamp() returning user_id into v;
 if v is null then raise exception 'invalid_or_expired_ticket' using errcode='42501'; end if; return v; end$$;

create function game_room_connection.resolve_phase(p_game text,p_room uuid,p_user uuid,p_lock boolean default false) returns text language plpgsql security definer set search_path=pg_catalog,public,okey as $$
declare s text; begin if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 if p_game='okey' then
  if p_lock then select status into s from okey.matches where id=p_room for update; else select status into s from okey.matches where id=p_room; end if;
  if not exists(select 1 from okey.match_seats where match_id=p_room and user_id=p_user and membership_released_at is null) then raise exception 'room_membership_required' using errcode='42501'; end if;
  return case s when 'waiting' then 'waiting' when 'playing' then 'playing' else 'finished' end;
 elsif p_game='domino_1v1' then
  if p_lock then select status into s from public.one_vs_one_rooms where id=p_room for update; else select status into s from public.one_vs_one_rooms where id=p_room; end if;
  if not exists(select 1 from public.one_vs_one_players where room_id=p_room and user_id=p_user) then raise exception 'room_membership_required' using errcode='42501'; end if;
  if s in('finished','cancelled') then return 'finished'; end if; return case when exists(select 1 from public.one_vs_one_private_states where room_id=p_room) then 'playing' else 'waiting' end;
 elsif p_game='domino_2v2' then
  if p_lock then select status into s from public.two_vs_two_rooms where id=p_room for update; else select status into s from public.two_vs_two_rooms where id=p_room; end if;
  if not exists(select 1 from public.two_vs_two_players where room_id=p_room and user_id=p_user) then raise exception 'room_membership_required' using errcode='42501'; end if;
  if s in('finished','cancelled') then return 'finished'; end if; return case when exists(select 1 from public.two_vs_two_private_states where room_id=p_room) then 'playing' else 'waiting' end;
 end if; raise exception 'invalid_game_type'; end$$;

create function game_room_connection.join_room(p_user uuid,p_game text,p_room uuid,p_connection uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,okey,game_room_connection as $$
declare ph text; gen bigint; ver bigint; begin if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_game||':'||p_room::text||':'||p_user::text,0)); ph:=game_room_connection.resolve_phase(p_game,p_room,p_user,true); gen:=nextval('game_room_connection.connection_generation_seq');
 insert into game_room_connection.membership_leases values(p_game,p_room,p_user,1,ph,clock_timestamp()) on conflict(game_type,room_id,user_id) do update set lease_version=membership_leases.lease_version+1,phase=excluded.phase,updated_at=clock_timestamp() returning lease_version into ver;
 insert into game_room_connection.connections(game_type,room_id,user_id,connection_id,generation,state) values(p_game,p_room,p_user,p_connection,gen,'active') on conflict(game_type,room_id,user_id,connection_id) do update set generation=excluded.generation,state='active',grace_deadline_at=null,disconnected_at=null,updated_at=clock_timestamp();
 if p_game='okey' then update okey.match_seats set connected=true where match_id=p_room and user_id=p_user; elsif p_game='domino_1v1' then update public.one_vs_one_players set connected=true,left_at=null where room_id=p_room and user_id=p_user; else update public.two_vs_two_players set connected=true,left_at=null where room_id=p_room and user_id=p_user; end if;
 return jsonb_build_object('phase',ph,'generation',gen,'leaseVersion',ver); end$$;

create function game_room_connection.begin_disconnect(p_user uuid,p_game text,p_room uuid,p_connection uuid,p_generation bigint,p_grace integer default 15) returns boolean language plpgsql security definer set search_path=pg_catalog,game_room_connection as $$
begin if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 update game_room_connection.connections set state='grace',grace_deadline_at=clock_timestamp()+make_interval(secs=>greatest(1,least(p_grace,120))),updated_at=clock_timestamp()
 where game_type=p_game and room_id=p_room and user_id=p_user and connection_id=p_connection and generation=p_generation and state='active'; return found; end$$;

create function game_room_connection.release_waiting(p_game text,p_room uuid,p_user uuid,p_reason text) returns integer language plpgsql security definer set search_path=pg_catalog,public,okey,game_room_connection as $$
declare users uuid[]:=array[p_user]; party uuid; n integer:=0; private_host boolean:=false; begin if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 select p.id into party from public.domino_parties p join public.domino_party_members pm on pm.party_id=p.id where pm.user_id=p_user and p.status='active' and p.current_room_id=p_room and p.flow_status='matchmaking' limit 1;
 if party is not null then select array_agg(user_id order by user_id) into users from public.domino_party_members where party_id=party; end if;
 if p_game='okey' then delete from okey.match_seats where match_id=p_room and user_id=any(users); select count(*) into n from okey.match_seats where match_id=p_room; update okey.matches set status=case when n=0 then 'cancelled' else 'waiting' end,countdown_deadline_at=null,updated_at=clock_timestamp() where id=p_room and status='waiting';
 elsif p_game='domino_1v1' then select metadata->>'source'='private_room_10' and host_user_id=p_user into private_host from public.one_vs_one_rooms where id=p_room; if private_host then delete from public.one_vs_one_players where room_id=p_room; else delete from public.one_vs_one_players where room_id=p_room and user_id=any(users); end if; select count(*) into n from public.one_vs_one_players where room_id=p_room; update public.one_vs_one_rooms set player_count=n,status=case when n=0 then 'cancelled' else 'waiting' end,current_turn_player_id=null,version=version+1,metadata=metadata||jsonb_build_object('connection_release_reason',p_reason) where id=p_room; update public.one_vs_one_matchmaking_queue q set status='cancelled',matched_room_id=null,ended_at=clock_timestamp(),updated_at=clock_timestamp() where q.user_id=any(users) or(q.matched_room_id=p_room and not exists(select 1 from public.one_vs_one_players p where p.room_id=p_room and p.user_id=q.user_id));
 elsif p_game='domino_2v2' then delete from public.two_vs_two_players where room_id=p_room and user_id=any(users); select count(*) into n from public.two_vs_two_players where room_id=p_room; update public.two_vs_two_rooms set player_count=n,status=case when n=0 then 'cancelled' else 'waiting' end,current_turn_player_id=null,version=version+1 where id=p_room; update public.two_vs_two_matchmaking_queue q set status='cancelled',matched_room_id=null,ended_at=clock_timestamp(),updated_at=clock_timestamp() where q.user_id=any(users) or(q.matched_room_id=p_room and not exists(select 1 from public.two_vs_two_players p where p.room_id=p_room and p.user_id=q.user_id)); end if;
 if party is not null then update public.domino_parties set flow_status='idle',current_room_id=null,current_mode=null,current_currency=null,current_entry_fee=null,current_table_id=null,command_version=command_version+1,updated_at=clock_timestamp() where id=party; end if;
 delete from game_room_connection.membership_leases where game_type=p_game and room_id=p_room and user_id=any(users); return n; end$$;

create function game_room_connection.finish_disconnect(p_user uuid,p_game text,p_room uuid,p_connection uuid,p_generation bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,okey,game_room_connection as $$
declare ph text;n integer;c integer;begin if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501';end if;perform pg_advisory_xact_lock(hashtextextended(p_game||':'||p_room::text||':'||p_user::text,0));
 update game_room_connection.connections set state='disconnected',grace_deadline_at=null,disconnected_at=clock_timestamp() where game_type=p_game and room_id=p_room and user_id=p_user and connection_id=p_connection and generation=p_generation and state='grace' and grace_deadline_at<=clock_timestamp();if not found then return jsonb_build_object('applied',false);end if;
 select count(*) into c from game_room_connection.connections where game_type=p_game and room_id=p_room and user_id=p_user and state in('active','grace');if c>0 then return jsonb_build_object('applied',true,'released',false,'reason','other_connection_alive');end if;
 ph:=game_room_connection.resolve_phase(p_game,p_room,p_user,true);if ph='waiting' then n:=game_room_connection.release_waiting(p_game,p_room,p_user,'disconnect_timeout');return jsonb_build_object('applied',true,'released',true,'phase',ph,'remainingMembers',n);end if;
 if ph='playing' then if p_game='okey' then update okey.match_seats set connected=false where match_id=p_room and user_id=p_user;elsif p_game='domino_1v1' then update public.one_vs_one_players set connected=false,left_at=coalesce(left_at,clock_timestamp()) where room_id=p_room and user_id=p_user;else update public.two_vs_two_players set connected=false,left_at=coalesce(left_at,clock_timestamp()) where room_id=p_room and user_id=p_user;end if;end if;return jsonb_build_object('applied',true,'released',false,'phase',ph);end$$;

create function game_room_connection.manual_leave(p_user uuid,p_game text,p_room uuid,p_connection uuid,p_generation bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,okey,game_room_connection as $$
declare ph text;n integer;begin if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501';end if;perform pg_advisory_xact_lock(hashtextextended(p_game||':'||p_room::text||':'||p_user::text,0));
 if not exists(select 1 from game_room_connection.connections where game_type=p_game and room_id=p_room and user_id=p_user and connection_id=p_connection and generation=p_generation and state in('active','grace')) then return jsonb_build_object('applied',false);end if;ph:=game_room_connection.resolve_phase(p_game,p_room,p_user,true);update game_room_connection.connections set state='disconnected',grace_deadline_at=null,disconnected_at=clock_timestamp() where game_type=p_game and room_id=p_room and user_id=p_user;
 if ph='waiting' then n:=game_room_connection.release_waiting(p_game,p_room,p_user,'manual_leave');return jsonb_build_object('applied',true,'released',true,'phase',ph,'remainingMembers',n);end if;
 if p_game='okey' then update okey.match_seats set connected=false where match_id=p_room and user_id=p_user;elsif p_game='domino_1v1' then update public.one_vs_one_players set connected=false,left_at=coalesce(left_at,clock_timestamp()) where room_id=p_room and user_id=p_user;else update public.two_vs_two_players set connected=false,left_at=coalesce(left_at,clock_timestamp()) where room_id=p_room and user_id=p_user;end if;return jsonb_build_object('applied',true,'released',false,'phase',ph);end$$;

revoke all on all functions in schema game_room_connection from public,anon,authenticated;
grant execute on all functions in schema game_room_connection to service_role;

