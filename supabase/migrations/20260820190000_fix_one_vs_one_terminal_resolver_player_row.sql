-- Fix the terminal-round resolver's row assignment. `SELECT player` returns one
-- composite value and PL/pgSQL assigns it to the first field of the %ROWTYPE,
-- later causing the entire player row to be cast as a uuid. Selecting player.*
-- assigns each table column to its matching row field.
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
  SELECT *
  INTO v_room
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

  SELECT player.*
  INTO v_taken_over_player
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

  SELECT move.action
  INTO v_takeover_action
  FROM public.one_vs_one_moves AS move
  WHERE move.room_id = p_room_id
    AND move.player_id = v_taken_over_player.user_id
    AND move.action IN ('manual_leave_takeover', 'timeout_takeover')
  ORDER BY move.sequence DESC
  LIMIT 1;

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

