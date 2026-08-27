-- Keep the durable global-presence write cadence and all social/party
-- eligibility checks on one shared freshness contract. Room connection
-- health remains owned by the game-room Gateway and is intentionally
-- unaffected by this migration.

do $$
declare
  v_signature regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.send_game_invite(uuid)'::regprocedure,
    'public.respond_game_invite(uuid,boolean)'::regprocedure,
    'public.find_domino_match(text,text,numeric)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_signature) into v_definition;

    if position('35 seconds' in v_definition) = 0 then
      raise exception 'Expected legacy presence freshness in %', v_signature;
    end if;

    execute replace(v_definition, '35 seconds', '120 seconds');
  end loop;
end;
$$;