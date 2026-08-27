-- Domino player tables distinguish humans with kind, not an is_bot column.
create or replace function game_room_connection.provision_domino_1v1_seat()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, game_room_connection
as $$
begin
  if new.user_id is not null and new.kind = 'human'
     and not exists(select 1 from public.one_vs_one_private_states where room_id = new.room_id) then
    new.connected := false;
    perform game_room_connection.provision_membership('domino_1v1', new.room_id, new.user_id);
  end if;
  return new;
end $$;

create or replace function game_room_connection.provision_domino_2v2_seat()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, game_room_connection
as $$
begin
  if new.user_id is not null and new.kind = 'human'
     and not exists(select 1 from public.two_vs_two_private_states where room_id = new.room_id) then
    new.connected := false;
    perform game_room_connection.provision_membership('domino_2v2', new.room_id, new.user_id);
  end if;
  return new;
end $$;
