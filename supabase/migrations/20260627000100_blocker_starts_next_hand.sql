-- Keep blocked-round scoring and next-hand leadership independent.
-- The edge functions store the scoring winner in roundWinnerPlayerId and the
-- player who closed the board in leaderPlayerId. Existing installations of
-- start_one_vs_one_game must prefer the latter when dealing the next hand.
DO $$
DECLARE
  function_definition text;
  patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.start_one_vs_one_game(uuid)'::regprocedure
  )
  INTO function_definition;

  patched_definition := replace(
    function_definition,
    'v_round_winner_player_id := NULLIF(v_room.state ->> ''roundWinnerPlayerId'', '''')::uuid;',
    'v_round_winner_player_id := NULLIF(COALESCE(v_room.state ->> ''leaderPlayerId'', v_room.state ->> ''roundWinnerPlayerId''), '''')::uuid;'
  );

  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'Unable to patch start_one_vs_one_game king selection';
  END IF;

  EXECUTE patched_definition;
END;
$$;
