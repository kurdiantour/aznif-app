-- End a Domino 1v1 match immediately only when a confirmed manual leave
-- transitions the number of remaining humans from one to zero.

CREATE OR REPLACE FUNCTION public.leave_one_vs_one_match(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player public.one_vs_one_players%ROWTYPE;
  v_humans_before integer;
  v_humans_after integer;
  v_final_state jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  SELECT * INTO v_player
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a player in this 1v1 room';
  END IF;

  IF v_room.status = 'active' THEN
    SELECT COUNT(*)::integer INTO v_humans_before
    FROM public.one_vs_one_players AS human
    WHERE human.room_id = p_room_id
      AND human.kind = 'human'
      AND NOT EXISTS (
        SELECT 1
        FROM public.one_vs_one_moves AS leave_move
        WHERE leave_move.room_id = p_room_id
          AND leave_move.player_id = human.user_id
          AND leave_move.action = 'manual_leave_takeover'
      );

    UPDATE public.one_vs_one_players
    SET connected = false,
        left_at = now(),
        bot_takeover = true,
        takeover_started_at = now(),
        takeover_expires_at = NULL,
        abandoned = false,
        updated_at = now()
    WHERE id = v_player.id;

    INSERT INTO public.one_vs_one_moves (
      room_id,
      player_id,
      sequence,
      action,
      payload
    ) VALUES (
      p_room_id,
      v_user_id,
      public.next_one_vs_one_move_sequence(p_room_id),
      'manual_leave_takeover',
      jsonb_build_object(
        'reason', 'manual_leave_takeover',
        'user_id', v_user_id,
        'player_index', v_player.player_index
      )
    );

    SELECT COUNT(*)::integer INTO v_humans_after
    FROM public.one_vs_one_players AS human
    WHERE human.room_id = p_room_id
      AND human.kind = 'human'
      AND NOT EXISTS (
        SELECT 1
        FROM public.one_vs_one_moves AS leave_move
        WHERE leave_move.room_id = p_room_id
          AND leave_move.player_id = human.user_id
          AND leave_move.action = 'manual_leave_takeover'
      );

    IF v_humans_before = 1 AND v_humans_after = 0 THEN
      v_final_state := COALESCE(v_room.state, '{}'::jsonb)
        || jsonb_build_object(
          'status', 'finished',
          'matchFinished', true,
          'winningTeamId', NULL,
          'finishReason', 'all_players_manual_leave',
          'forfeitReason', 'no_humans_remaining',
          'canDrawTile', false
        );

      UPDATE public.one_vs_one_players
      SET connected = false,
          bot_takeover = true,
          abandoned = true,
          updated_at = now()
      WHERE room_id = p_room_id
        AND kind = 'human'
        AND EXISTS (
          SELECT 1
          FROM public.one_vs_one_moves AS leave_move
          WHERE leave_move.room_id = p_room_id
            AND leave_move.player_id = one_vs_one_players.user_id
            AND leave_move.action = 'manual_leave_takeover'
        );

      UPDATE public.one_vs_one_rooms
      SET status = 'finished',
          state = v_final_state,
          current_turn_player_id = NULL,
          version = version + 1,
          updated_at = now()
      WHERE id = p_room_id;

      INSERT INTO public.one_vs_one_moves (
        room_id,
        player_id,
        sequence,
        action,
        payload
      ) VALUES (
        p_room_id,
        NULL,
        public.next_one_vs_one_move_sequence(p_room_id),
        'all_players_manual_leave',
        jsonb_build_object(
          'reason', 'no_humans_remaining',
          'humans_before', v_humans_before,
          'humans_after', v_humans_after
        )
      );

      RETURN jsonb_build_object(
        'status', 'match_finished',
        'room_id', p_room_id,
        'result', 'no_winner',
        'finish_reason', 'all_players_manual_leave'
      );
    END IF;

    IF NULLIF(v_room.state ->> 'roundWinnerPlayerId', '') IS NOT NULL THEN
      PERFORM public.resolve_one_vs_one_round_leave_forfeits(p_room_id);
    END IF;

    RETURN jsonb_build_object(
      'status', 'bot_takeover',
      'room_id', p_room_id
    );
  END IF;

  UPDATE public.one_vs_one_players
  SET connected = false,
      left_at = now(),
      updated_at = now()
  WHERE id = v_player.id;

  UPDATE public.one_vs_one_rooms
  SET status = 'cancelled',
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id
    AND status = 'waiting';

  RETURN jsonb_build_object('status', 'left', 'room_id', p_room_id);
END;
$$;

REVOKE ALL ON FUNCTION public.leave_one_vs_one_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_one_vs_one_match(uuid) TO authenticated;
