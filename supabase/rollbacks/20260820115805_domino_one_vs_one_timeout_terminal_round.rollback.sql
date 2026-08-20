-- Rollback for 20260820115805_domino_one_vs_one_timeout_terminal_round.sql
-- Restores the exact pre-migration 1v1 timeout, Manual Leave resolver, and trigger definitions.

CREATE OR REPLACE FUNCTION public.apply_one_vs_one_timeout_strike_takeover(
  p_room_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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
    PERFORM public.check_and_finalize_zero_human_room('1v1', p_room_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_one_vs_one_round_leave_forfeits(
  p_room_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_leaver public.one_vs_one_players%ROWTYPE;
  v_winning_team text;
  v_state jsonb;
  v_settlement jsonb;
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
     OR NULLIF(
       v_room.state ->> 'roundWinnerPlayerId',
       ''
     ) IS NULL
  THEN
    RETURN jsonb_build_object(
      'forfeit', false
    );
  END IF;

  SELECT *
  INTO v_leaver
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND bot_takeover = true
    AND connected = false
    AND abandoned = false
      AND EXISTS (
        SELECT 1
        FROM public.one_vs_one_moves AS ml
        WHERE ml.room_id = p_room_id
          AND ml.player_id = user_id
          AND ml.action = 'manual_leave_takeover'
      )
  ORDER BY takeover_started_at ASC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'forfeit', false
    );
  END IF;

  v_winning_team :=
    CASE
      WHEN v_leaver.team_id = 'teamA'
        THEN 'teamB'
      ELSE 'teamA'
    END;

  v_state :=
    COALESCE(v_room.state, '{}'::jsonb)
    || jsonb_build_object(
      'status', 'finished',
      'matchFinished', true,
      'winningTeamId', v_winning_team,
      'forfeitByPlayerId', v_leaver.user_id,
      'forfeitReason', 'player_left',
      'finishReason', 'opponent_left',
      'gameOverReason', 'opponent_left',
      'canDrawTile', false
    );

  UPDATE public.one_vs_one_players
  SET
    abandoned = true,
    connected = false,
    updated_at = now()
  WHERE id = v_leaver.id;

  UPDATE public.one_vs_one_rooms
  SET
    status = 'finished',
    state = v_state,
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
  )
  VALUES (
    p_room_id,
    v_leaver.user_id,
    public.next_one_vs_one_move_sequence(
      p_room_id
    ),
    'round_end_leave_forfeit',
    jsonb_build_object(
      'user_id', v_leaver.user_id,
      'team_id', v_leaver.team_id,
      'winner_team', v_winning_team,
      'reason', 'player_left'
    )
  );

  /*
   * IMPORTANT:
   * Use the canonical Domino settlement.
   * This handles Fun Coin / Aznif payout and
   * the existing reward/economy rules.
   */
  v_settlement :=
    public.domino_settle_match(
      '1v1',
      p_room_id
    );

  /*
   * Make the final settlement available
   * to the game-over/final result state.
   */
  UPDATE public.one_vs_one_rooms
  SET
    state =
      state
      || jsonb_build_object(
        'settlement', v_settlement,
        'onlineMatchResultReward', v_settlement
      ),
      version = version + 1,
      updated_at = now()
    WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'forfeit', true,
    'winner_team', v_winning_team,
    'reason', 'player_left',
    'settlement', v_settlement
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_one_vs_one_takeover_after_round()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'active'
     AND NULLIF(NEW.state ->> 'roundWinnerPlayerId', '') IS NOT NULL
     AND (
       OLD.state IS DISTINCT FROM NEW.state
       OR NULLIF(OLD.state ->> 'roundWinnerPlayerId', '') IS NULL
     )
     AND EXISTS (
       SELECT 1
       FROM public.one_vs_one_players p
       WHERE p.room_id = NEW.id
         AND p.bot_takeover = true
         AND p.connected = false
         AND p.abandoned = false
      AND EXISTS (
        SELECT 1
        FROM public.one_vs_one_moves AS ml
        WHERE ml.room_id = p.room_id
          AND ml.player_id = p.user_id
          AND ml.action = 'manual_leave_takeover'
      )
     )
  THEN
    PERFORM public.resolve_one_vs_one_round_leave_forfeits(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.resolve_multiplayer_terminal_round(text, text, uuid);
DROP FUNCTION IF EXISTS public.resolve_one_vs_one_terminal_round(uuid);

REVOKE ALL ON FUNCTION public.apply_one_vs_one_timeout_strike_takeover(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_one_vs_one_timeout_strike_takeover(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.resolve_one_vs_one_round_leave_forfeits(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_one_vs_one_round_leave_forfeits(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_one_vs_one_takeover_after_round() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
