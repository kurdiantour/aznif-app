-- A confirmed manual leave in a free team match is an immediate personal
-- forfeit. The leaver's bot keeps playing, while every remaining human is
-- settled only from the match's eventual authoritative result.

CREATE OR REPLACE FUNCTION public.settle_free_two_vs_two_manual_forfeit(
  p_room_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_player public.two_vs_two_players%ROWTYPE;
  v_existing_id uuid;
  v_settlement_id uuid;
  v_coin_before numeric;
  v_gem_before numeric;
  v_points_before integer;
  v_points_after integer;
BEGIN
  SELECT * INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  IF v_room.status <> 'active' THEN
    RAISE EXCEPTION 'Manual forfeit requires an active 2v2 match';
  END IF;

  -- Paid matches have their own financial settlement and must never enter the
  -- free Coin/Gem/Points economy.
  IF COALESCE(v_room.bet_amount, 0) > 0
     OR COALESCE(v_room.metadata ->> 'aznif_betting', 'false') = 'true'
  THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_player
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND kind = 'human'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forfeiting human player not found';
  END IF;

  SELECT settlement.id INTO v_existing_id
  FROM public.free_match_settlements AS settlement
  WHERE settlement.game_type = 'domino_2v2'
    AND settlement.match_id = p_room_id
    AND settlement.user_id = p_user_id;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  INSERT INTO public.wallets(user_id, mc, coin, updated_at)
  VALUES (p_user_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT wallet.coin, wallet.gem
  INTO v_coin_before, v_gem_before
  FROM public.wallets AS wallet
  WHERE wallet.user_id = p_user_id
  FOR UPDATE;

  SELECT COALESCE(profile.points, 0)
  INTO v_points_before
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forfeiting player profile not found';
  END IF;

  v_points_after := GREATEST(0, v_points_before - 25);

  INSERT INTO public.free_match_settlements(
    game_type, match_id, user_id, result,
    coin_delta, gem_delta, points_requested_delta, points_applied_delta,
    coin_before, coin_after, gem_before, gem_after, points_before, points_after,
    metadata
  ) VALUES (
    'domino_2v2', p_room_id, p_user_id, 'forfeit',
    0, 0, -25, v_points_after - v_points_before,
    v_coin_before, v_coin_before, v_gem_before, v_gem_before,
    v_points_before, v_points_after,
    jsonb_build_object(
      'mode', '2v2',
      'settled_at', 'manual_leave',
      'team_id', v_player.team_id,
      'player_index', v_player.player_index
    )
  )
  RETURNING id INTO v_settlement_id;

  UPDATE public.profiles
  SET points = v_points_after,
      level = LEAST(7, FLOOR(v_points_after::numeric / 150)::int + 1),
      games_played = games_played + 1,
      games_lost = games_lost + 1
  WHERE id = p_user_id;

  RETURN v_settlement_id;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_free_two_vs_two_manual_forfeit(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_free_two_vs_two_manual_forfeit(uuid, uuid)
TO service_role;
CREATE OR REPLACE FUNCTION public.leave_two_vs_two_match(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_player public.two_vs_two_players%ROWTYPE;
  v_forfeit_settlement_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  SELECT * INTO v_player
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a player in this 2v2 room';
  END IF;

  IF v_room.status = 'active' THEN
    UPDATE public.two_vs_two_players
    SET connected = false,
        left_at = now(),
        bot_takeover = true,
        takeover_started_at = now(),
        takeover_expires_at = NULL,
        abandoned = false,
        updated_at = now()
    WHERE id = v_player.id;

    INSERT INTO public.two_vs_two_moves (
      room_id, player_id, sequence, action, payload
    ) VALUES (
      p_room_id,
      v_user_id,
      public.next_two_vs_two_move_sequence(p_room_id),
      'manual_leave_takeover',
      jsonb_build_object(
        'reason', 'manual_leave_takeover',
        'user_id', v_user_id,
        'team_id', v_player.team_id,
        'player_index', v_player.player_index
      )
    );

    -- Settle only the confirmed leaver now. The unique settlement key ensures
    -- the eventual match settlement cannot reward or penalize them again.
    v_forfeit_settlement_id :=
      public.settle_free_two_vs_two_manual_forfeit(p_room_id, v_user_id);

    -- The match remains playable while at least one human on each team stays.
    -- If an entire team has manually left, the existing round-boundary rule
    -- may finish the match after the current round presentation.
    IF NULLIF(v_room.state ->> 'roundWinnerPlayerId', '') IS NOT NULL THEN
      PERFORM public.resolve_two_vs_two_round_leave_forfeits(p_room_id);
    END IF;

    RETURN jsonb_build_object(
      'status', 'bot_takeover',
      'room_id', p_room_id,
      'result', CASE
        WHEN v_forfeit_settlement_id IS NULL THEN NULL
        ELSE 'forfeit'
      END,
      'settlement_id', v_forfeit_settlement_id
    );
  END IF;

  UPDATE public.two_vs_two_players
  SET connected = false, left_at = now(), updated_at = now()
  WHERE id = v_player.id;

  INSERT INTO public.two_vs_two_moves (
    room_id, player_id, sequence, action, payload
  ) VALUES (
    p_room_id,
    v_user_id,
    public.next_two_vs_two_move_sequence(p_room_id),
    'left_before_start',
    jsonb_build_object(
      'reason', 'leave_before_start',
      'user_id', v_user_id,
      'team_id', v_player.team_id
    )
  );

  RETURN jsonb_build_object('status', 'left', 'room_id', p_room_id);
END;
$$;
REVOKE ALL ON FUNCTION public.leave_two_vs_two_match(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_two_vs_two_match(uuid)
TO authenticated;
