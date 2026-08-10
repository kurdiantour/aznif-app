-- Canonical manual-leave settlement plus atomic 2v2 round termination.

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
  v_settlement_id uuid;
  v_points_before integer;
  v_points_after integer;
BEGIN
  SELECT * INTO v_room FROM public.two_vs_two_rooms
  WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '2v2 room not found'; END IF;
  IF v_room.status <> 'active' THEN
    RAISE EXCEPTION 'Manual forfeit requires an active 2v2 match';
  END IF;

  IF COALESCE(v_room.bet_amount, 0) > 0
     OR COALESCE(v_room.metadata ->> 'aznif_betting', 'false') = 'true'
  THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_player FROM public.two_vs_two_players
  WHERE room_id = p_room_id AND user_id = p_user_id AND kind = 'human'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Forfeiting human player not found'; END IF;

  SELECT record.id INTO v_settlement_id
  FROM public.match_reward_records AS record
  WHERE record.room_id = p_room_id
    AND record.mode = '2v2'
    AND record.user_id = p_user_id;
  IF v_settlement_id IS NOT NULL THEN RETURN v_settlement_id; END IF;

  SELECT COALESCE(profile.points, 0) INTO v_points_before
  FROM public.profiles AS profile WHERE profile.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Forfeiting player profile not found'; END IF;

  v_points_after := GREATEST(0, v_points_before - 25);

  INSERT INTO public.match_reward_records (
    room_id, mode, user_id, team_id, points, gold, tier, source, metadata
  ) VALUES (
    p_room_id, '2v2', p_user_id, v_player.team_id, 0, 0,
    'manual_forfeit', 'manual_leave_settlement',
    jsonb_build_object(
      'result', 'forfeit',
      'settled_at', 'manual_leave',
      'player_index', v_player.player_index,
      'points_requested_delta', -25,
      'points_applied_delta', v_points_after - v_points_before,
      'points_before', v_points_before,
      'points_after', v_points_after
    )
  )
  ON CONFLICT (room_id, mode, user_id) DO NOTHING
  RETURNING id INTO v_settlement_id;

  IF v_settlement_id IS NULL THEN
    SELECT record.id INTO v_settlement_id
    FROM public.match_reward_records AS record
    WHERE record.room_id = p_room_id
      AND record.mode = '2v2'
      AND record.user_id = p_user_id;
    RETURN v_settlement_id;
  END IF;

  UPDATE public.profiles
  SET points = v_points_after,
      level = LEAST(7, FLOOR(v_points_after::numeric / 150)::int + 1),
      games_played = COALESCE(games_played, 0) + 1,
      games_lost = COALESCE(games_lost, 0) + 1
  WHERE id = p_user_id;

  RETURN v_settlement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_free_two_vs_two_manual_forfeit(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_free_two_vs_two_manual_forfeit(uuid, uuid)
TO service_role;

DROP FUNCTION IF EXISTS public.settle_finished_match_rewards(text, uuid);

CREATE OR REPLACE FUNCTION public.settle_finished_match_rewards(
  p_mode text,
  p_room_id uuid
)
RETURNS TABLE(
  reward_id uuid,
  rewarded_user_id uuid,
  awarded_points integer,
  awarded_gold numeric,
  already_claimed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_state jsonb;
  v_winning_team text;
  v_team_scores jsonb;
  v_winner_score integer;
  v_loser_score integer;
  v_tier text;
  v_gold numeric;
  v_points integer;
  v_player record;
  v_reward_id uuid;
  v_before_gold numeric;
  v_after_gold numeric;
  v_existing_reward_id uuid;
BEGIN
  IF p_mode NOT IN ('1v1', '2v2') THEN RAISE EXCEPTION 'Invalid match mode: %', p_mode; END IF;

  IF p_mode = '1v1' THEN
    SELECT room.status, room.state INTO v_status, v_state
    FROM public.one_vs_one_rooms AS room WHERE room.id = p_room_id;
  ELSE
    SELECT room.status, room.state INTO v_status, v_state
    FROM public.two_vs_two_rooms AS room WHERE room.id = p_room_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION '% room not found', p_mode; END IF;
  IF v_status <> 'finished' THEN RAISE EXCEPTION 'Match is not finished'; END IF;

  v_winning_team := v_state ->> 'winningTeamId';
  IF v_winning_team NOT IN ('teamA', 'teamB') THEN
    RAISE EXCEPTION 'Finished match has no winning team';
  END IF;

  v_team_scores := COALESCE(v_state -> 'teamScores', '{}'::jsonb);
  v_winner_score := COALESCE((v_team_scores ->> v_winning_team)::int, 0);
  v_loser_score := COALESCE((v_team_scores ->> CASE
    WHEN v_winning_team = 'teamA' THEN 'teamB' ELSE 'teamA' END)::int, 0);

  IF v_state ? 'matchReward' AND jsonb_typeof(v_state -> 'matchReward') = 'object' THEN
    v_tier := COALESCE(v_state #>> '{matchReward,tier}', 'normal');
    v_gold := COALESCE((v_state #>> '{matchReward,gold}')::numeric, 0);
    v_points := COALESCE((v_state #>> '{matchReward,points}')::int, 0);
  ELSE
    SELECT reward.tier, reward.gold, reward.points INTO v_tier, v_gold, v_points
    FROM public.calculate_match_reward(v_winner_score, v_loser_score) AS reward;
  END IF;
  IF v_points < 0 OR v_gold < 0 THEN RAISE EXCEPTION 'Invalid match reward values'; END IF;

  FOR v_player IN
    EXECUTE format(
      'SELECT player.user_id, player.team_id
       FROM public.%I AS player
       WHERE player.room_id = $1
         AND player.team_id = $2
         AND player.user_id IS NOT NULL
         AND ($3 <> ''2v2'' OR NOT EXISTS (
           SELECT 1 FROM public.two_vs_two_moves AS leave_move
           WHERE leave_move.room_id = $1
             AND leave_move.player_id = player.user_id
             AND leave_move.action = ''manual_leave_takeover''
         ))
       ORDER BY player.player_index',
      CASE WHEN p_mode = '1v1' THEN 'one_vs_one_players' ELSE 'two_vs_two_players' END
    ) USING p_room_id, v_winning_team, p_mode
  LOOP
    v_existing_reward_id := NULL;
    v_reward_id := NULL;
    SELECT record.id INTO v_existing_reward_id
    FROM public.match_reward_records AS record
    WHERE record.room_id = p_room_id AND record.mode = p_mode
      AND record.user_id = v_player.user_id;

    INSERT INTO public.match_reward_records (
      room_id, mode, user_id, team_id, points, gold, tier, metadata
    ) VALUES (
      p_room_id, p_mode, v_player.user_id, v_player.team_id,
      v_points, v_gold, v_tier,
      jsonb_build_object('winner_score', v_winner_score, 'loser_score', v_loser_score, 'settled_by', 'server')
    )
    ON CONFLICT (room_id, mode, user_id) DO NOTHING
    RETURNING match_reward_records.id INTO v_reward_id;

    IF v_reward_id IS NOT NULL THEN
      UPDATE public.profiles AS profile
      SET points = COALESCE(profile.points, 0) + v_points
      WHERE profile.id = v_player.user_id;

      IF v_gold > 0 THEN
        INSERT INTO public.wallets (user_id, mc, gold, updated_at)
        VALUES (v_player.user_id, 0, 0, now()) ON CONFLICT (user_id) DO NOTHING;
        SELECT wallet.gold INTO v_before_gold FROM public.wallets AS wallet
        WHERE wallet.user_id = v_player.user_id FOR UPDATE;
        v_after_gold := COALESCE(v_before_gold, 0) + v_gold;
        UPDATE public.wallets SET gold = v_after_gold, updated_at = now()
        WHERE user_id = v_player.user_id;
        INSERT INTO public.wallet_transactions (
          user_id, to_user_id, amount, currency, transaction_type, status,
          metadata, balance_before, balance_after
        ) VALUES (
          v_player.user_id, v_player.user_id, v_gold, 'Gold', 'reward', 'completed',
          jsonb_build_object('reason', 'match_reward', 'room_id', p_room_id,
            'mode', p_mode, 'reward_id', v_reward_id, 'tier', v_tier),
          COALESCE(v_before_gold, 0), v_after_gold
        );
      END IF;
      RETURN QUERY SELECT v_reward_id, v_player.user_id, v_points, v_gold, false;
    ELSE
      RETURN QUERY SELECT v_existing_reward_id, v_player.user_id, v_points, v_gold, true;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_finished_match_rewards(text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_finished_match_rewards(text, uuid) TO service_role;


-- Delegate the authenticated compatibility RPC to the same canonical path.
CREATE OR REPLACE FUNCTION public.settle_match_rewards(p_mode text, p_room_id uuid)
RETURNS TABLE(reward_id uuid, user_id uuid, points integer, gold numeric, already_claimed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_status text;
  v_state jsonb;
  v_winning_team text;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_mode NOT IN ('1v1', '2v2') THEN RAISE EXCEPTION 'Invalid match mode: %', p_mode; END IF;
  IF p_mode = '1v1' THEN
    SELECT room.status, room.state INTO v_status, v_state
    FROM public.one_vs_one_rooms AS room WHERE room.id = p_room_id;
    IF NOT FOUND THEN RAISE EXCEPTION '1v1 room not found'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.one_vs_one_players AS player
      WHERE player.room_id = p_room_id AND player.user_id = v_caller)
    THEN RAISE EXCEPTION 'You are not a player in this 1v1 room'; END IF;
  ELSE
    SELECT room.status, room.state INTO v_status, v_state
    FROM public.two_vs_two_rooms AS room WHERE room.id = p_room_id;
    IF NOT FOUND THEN RAISE EXCEPTION '2v2 room not found'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.two_vs_two_players AS player
      WHERE player.room_id = p_room_id AND player.user_id = v_caller)
    THEN RAISE EXCEPTION 'You are not a player in this 2v2 room'; END IF;
  END IF;
  IF v_status <> 'finished' THEN RAISE EXCEPTION 'Match is not finished'; END IF;
  v_winning_team := v_state ->> 'winningTeamId';
  IF v_winning_team NOT IN ('teamA', 'teamB') THEN RAISE EXCEPTION 'Finished match has no winning team'; END IF;
  IF p_mode = '1v1' AND NOT EXISTS (SELECT 1 FROM public.one_vs_one_players AS player
    WHERE player.room_id = p_room_id AND player.user_id = v_caller AND player.team_id = v_winning_team)
  THEN RAISE EXCEPTION 'Only a winning player can settle match rewards'; END IF;
  IF p_mode = '2v2' AND NOT EXISTS (SELECT 1 FROM public.two_vs_two_players AS player
    WHERE player.room_id = p_room_id AND player.user_id = v_caller AND player.team_id = v_winning_team)
  THEN RAISE EXCEPTION 'Only a winning player can settle match rewards'; END IF;
  RETURN QUERY SELECT settled.reward_id, settled.rewarded_user_id, settled.awarded_points,
    settled.awarded_gold, settled.already_claimed
  FROM public.settle_finished_match_rewards(p_mode, p_room_id) AS settled;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_match_rewards(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_match_rewards(text, uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.commit_multiplayer_action(
  p_mode text, p_room_id uuid, p_expected_version bigint, p_state jsonb,
  p_hands jsonb, p_boneyard jsonb, p_current_turn_player_id uuid,
  p_status text, p_player_id uuid, p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room jsonb;
  v_sequence bigint;
  v_effective_status text;
  v_forfeit jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;

  IF p_mode = '1v1' THEN
    UPDATE public.one_vs_one_rooms
    SET state = p_state, version = version + 1,
        current_turn_player_id = p_current_turn_player_id,
        status = COALESCE(p_status, status), updated_at = now()
    WHERE id = p_room_id AND version = p_expected_version
    RETURNING to_jsonb(one_vs_one_rooms.*), status INTO v_room, v_effective_status;
    IF NOT FOUND THEN RAISE EXCEPTION 'STALE_GAME_STATE'; END IF;
    INSERT INTO public.one_vs_one_private_states(room_id, hands, boneyard)
    VALUES (p_room_id, p_hands, p_boneyard)
    ON CONFLICT (room_id) DO UPDATE SET hands = EXCLUDED.hands,
      boneyard = EXCLUDED.boneyard, updated_at = now();
    v_sequence := public.next_one_vs_one_move_sequence(p_room_id);
    INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
    VALUES (p_room_id, p_player_id, v_sequence, p_action, COALESCE(p_payload, '{}'::jsonb));
  ELSIF p_mode = '2v2' THEN
    UPDATE public.two_vs_two_rooms
    SET state = p_state, version = version + 1,
        current_turn_player_id = p_current_turn_player_id,
        status = COALESCE(p_status, status), updated_at = now()
    WHERE id = p_room_id AND version = p_expected_version
    RETURNING to_jsonb(two_vs_two_rooms.*), status INTO v_room, v_effective_status;
    IF NOT FOUND THEN RAISE EXCEPTION 'STALE_GAME_STATE'; END IF;
    INSERT INTO public.two_vs_two_private_states(room_id, hands, boneyard)
    VALUES (p_room_id, p_hands, p_boneyard)
    ON CONFLICT (room_id) DO UPDATE SET hands = EXCLUDED.hands,
      boneyard = EXCLUDED.boneyard, updated_at = now();
    v_sequence := public.next_two_vs_two_move_sequence(p_room_id);
    INSERT INTO public.two_vs_two_moves(room_id, player_id, sequence, action, payload)
    VALUES (p_room_id, p_player_id, v_sequence, p_action, COALESCE(p_payload, '{}'::jsonb));

    IF v_effective_status = 'active'
       AND NULLIF(p_state ->> 'roundWinnerPlayerId', '') IS NOT NULL
    THEN
      v_forfeit := public.resolve_two_vs_two_round_leave_forfeits(p_room_id);
      IF NOT COALESCE((v_forfeit ->> 'forfeit')::boolean, false)
         AND NULLIF(p_state ->> 'winningTeamId', '') IS NOT NULL
      THEN
        UPDATE public.two_vs_two_rooms
        SET status = 'finished', current_turn_player_id = NULL, updated_at = now()
        WHERE id = p_room_id AND status = 'active';
        PERFORM public.settle_finished_match_rewards('2v2', p_room_id);
      END IF;
      SELECT to_jsonb(room.*), room.status INTO v_room, v_effective_status
      FROM public.two_vs_two_rooms AS room WHERE room.id = p_room_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid game mode';
  END IF;

  IF v_effective_status = 'finished' AND p_mode = '1v1' THEN
    PERFORM public.settle_finished_match_rewards(p_mode, p_room_id);
    PERFORM public.settle_one_vs_one_bet(p_room_id);
  END IF;
  RETURN v_room;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_multiplayer_action(
  text, uuid, bigint, jsonb, jsonb, jsonb, uuid, text, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_multiplayer_action(
  text, uuid, bigint, jsonb, jsonb, jsonb, uuid, text, uuid, text, jsonb
) TO service_role;
