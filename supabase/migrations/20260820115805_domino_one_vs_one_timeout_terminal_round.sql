-- Shared terminal-round policy entry point, initially wired only for Domino 1v1.
-- Manual Leave and the second consecutive timeout are explicit terminal causes.
-- The bot completes the current round; presence state alone is never terminal.
-- Existing RPC names remain as compatibility adapters.

CREATE OR REPLACE FUNCTION public.apply_one_vs_one_timeout_strike_takeover(
  p_room_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Serialize the seat transition and ledger event per room. This makes a
  -- retried timeout result atomic and idempotent.
  PERFORM 1
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  UPDATE public.one_vs_one_players
  SET bot_takeover = true,
      connected = false,
      abandoned = false,
      takeover_started_at = now(),
      takeover_expires_at = NULL,
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND bot_takeover = false;

  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.one_vs_one_moves AS takeover_event
      WHERE takeover_event.room_id = p_room_id
        AND takeover_event.player_id = p_user_id
        AND takeover_event.action = 'timeout_takeover'
    ) THEN
      INSERT INTO public.one_vs_one_moves (
        room_id, player_id, sequence, action, payload
      ) VALUES (
        p_room_id,
        p_user_id,
        public.next_one_vs_one_move_sequence(p_room_id),
        'timeout_takeover',
        jsonb_build_object(
          'reason', 'consecutive_timeouts',
          'timeout_strikes', 2,
          'user_id', p_user_id
        )
      );
    END IF;

    -- Preserve the established zero-human terminal policy.
    PERFORM public.check_and_finalize_zero_human_room('1v1', p_room_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_one_vs_one_terminal_round(
  p_room_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_taken_over_player public.one_vs_one_players%ROWTYPE;
  v_takeover_action text;
  v_winning_team text;
  v_state jsonb;
  v_settlement jsonb;
  v_forfeit_reason text;
  v_finish_reason text;
  v_terminal_move_action text;
  v_terminal_move_payload jsonb;
BEGIN
  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.status <> 'active'
     OR NULLIF(v_room.state ->> 'roundWinnerPlayerId', '') IS NULL
  THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  SELECT player, terminal_event.action
  INTO v_taken_over_player, v_takeover_action
  FROM public.one_vs_one_players AS player
  JOIN LATERAL (
    SELECT move.action
    FROM public.one_vs_one_moves AS move
    WHERE move.room_id = p_room_id
      AND move.player_id = player.user_id
      AND move.action IN ('manual_leave_takeover', 'timeout_takeover')
    ORDER BY move.sequence DESC
    LIMIT 1
  ) AS terminal_event ON true
  WHERE player.room_id = p_room_id
    AND player.bot_takeover = true
    AND player.connected = false
    AND player.abandoned = false
  ORDER BY player.takeover_started_at ASC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  v_winning_team := CASE
    WHEN v_taken_over_player.team_id = 'teamA' THEN 'teamB'
    ELSE 'teamA'
  END;

  IF v_takeover_action = 'manual_leave_takeover' THEN
    -- Preserve the existing Manual Leave public state and move contract.
    v_forfeit_reason := 'player_left';
    v_finish_reason := 'opponent_left';
    v_terminal_move_action := 'round_end_leave_forfeit';
    v_terminal_move_payload := jsonb_build_object(
      'user_id', v_taken_over_player.user_id,
      'team_id', v_taken_over_player.team_id,
      'winner_team', v_winning_team,
      'reason', v_forfeit_reason
    );
  ELSE
    v_forfeit_reason := 'consecutive_timeouts';
    v_finish_reason := 'opponent_timeout_takeover';
    v_terminal_move_action := 'round_end_timeout_forfeit';
    v_terminal_move_payload := jsonb_build_object(
      'user_id', v_taken_over_player.user_id,
      'team_id', v_taken_over_player.team_id,
      'winner_team', v_winning_team,
      'takeover_action', v_takeover_action,
      'reason', v_forfeit_reason
    );
  END IF;

  v_state := COALESCE(v_room.state, '{}'::jsonb)
    || jsonb_build_object(
      'status', 'finished',
      'matchFinished', true,
      'winningTeamId', v_winning_team,
      'forfeitByPlayerId', v_taken_over_player.user_id,
      'forfeitReason', v_forfeit_reason,
      'finishReason', v_finish_reason,
      'gameOverReason', v_finish_reason,
      'canDrawTile', false
    );

  UPDATE public.one_vs_one_players
  SET abandoned = true,
      connected = false,
      updated_at = now()
  WHERE id = v_taken_over_player.id;

  UPDATE public.one_vs_one_rooms
  SET status = 'finished',
      state = v_state,
      current_turn_player_id = NULL,
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id;

  INSERT INTO public.one_vs_one_moves (
    room_id, player_id, sequence, action, payload
  ) VALUES (
    p_room_id,
    v_taken_over_player.user_id,
    public.next_one_vs_one_move_sequence(p_room_id),
    v_terminal_move_action,
    v_terminal_move_payload
  );

  v_settlement := public.domino_settle_match('1v1', p_room_id);

  UPDATE public.one_vs_one_rooms
  SET state = state || jsonb_build_object(
        'settlement', v_settlement,
        'onlineMatchResultReward', v_settlement
      ),
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'forfeit', true,
    'winner_team', v_winning_team,
    'reason', v_forfeit_reason,
    'settlement', v_settlement
  );
END;
$$;

-- Shared Multiplayer Core dispatch boundary. Other games and modes remain
-- untouched until they explicitly register their own adapter here.
CREATE OR REPLACE FUNCTION public.resolve_multiplayer_terminal_round(
  p_game text,
  p_mode text,
  p_room_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_game = 'domino' AND p_mode = '1v1' THEN
    RETURN public.resolve_one_vs_one_terminal_round(p_room_id);
  END IF;

  RAISE EXCEPTION 'unsupported_terminal_round_scope:%:%', p_game, p_mode;
END;
$$;

-- Backward-compatible adapter used by the existing human and bot lifecycles.
CREATE OR REPLACE FUNCTION public.resolve_one_vs_one_round_leave_forfeits(
  p_room_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.resolve_multiplayer_terminal_round('domino', '1v1', p_room_id);
$$;

CREATE OR REPLACE FUNCTION public.finalize_one_vs_one_takeover_after_round()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'active'
     AND NULLIF(NEW.state ->> 'roundWinnerPlayerId', '') IS NOT NULL
     AND (
       OLD.state IS DISTINCT FROM NEW.state
       OR NULLIF(OLD.state ->> 'roundWinnerPlayerId', '') IS NULL
     )
  THEN
    PERFORM public.resolve_multiplayer_terminal_round('domino', '1v1', NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_one_vs_one_timeout_strike_takeover(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_one_vs_one_timeout_strike_takeover(uuid, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.resolve_one_vs_one_terminal_round(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_one_vs_one_terminal_round(uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.resolve_multiplayer_terminal_round(text, text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_multiplayer_terminal_round(text, text, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.resolve_one_vs_one_round_leave_forfeits(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_one_vs_one_round_leave_forfeits(uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.finalize_one_vs_one_takeover_after_round()
FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';