-- A manual leave is a final forfeit. Timeout takeover remains resumable.
CREATE OR REPLACE FUNCTION public.dama_restore_control(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_color text;
  v_now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_version bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.dama_matches
  WHERE id = p_match_id AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_match_not_active'; END IF;

  UPDATE public.dama_match_players
  SET bot_takeover = false, connected = true, last_seen_at = clock_timestamp(),
      consecutive_timeout_strikes = 0
  WHERE match_id = p_match_id AND user_id = auth.uid() AND left_at IS NULL
    AND bot_takeover AND NOT manual_left
  RETURNING piece_color INTO v_color;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_timeout_takeover_not_restorable'; END IF;

  UPDATE public.dama_matches
  SET state = CASE WHEN state->>'turn' = v_color
      THEN jsonb_set(jsonb_set(jsonb_set(state, ARRAY['timeoutStrikes', v_color], '0'::jsonb, true),
        '{turnStartedAtMs}', to_jsonb(v_now_ms), true),
        '{turnDeadlineAtMs}', to_jsonb(v_now_ms + 15000), true)
      ELSE jsonb_set(state, ARRAY['timeoutStrikes', v_color], '0'::jsonb, true) END,
      version = version + 1, updated_at = clock_timestamp()
  WHERE id = p_match_id
  RETURNING version INTO v_version;

  INSERT INTO public.dama_match_moves(match_id, version, user_id, action, payload)
  VALUES (p_match_id, v_version, auth.uid(), 'restore-control', jsonb_build_object('piece_color', v_color));
END;
$$;

CREATE OR REPLACE FUNCTION multiplayer_private.record_dama_final_stats(
  p_match_id uuid,
  p_manual_leaver uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match public.dama_matches%ROWTYPE;
  v_results jsonb;
BEGIN
  SELECT * INTO v_match FROM public.dama_matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'finished' THEN RETURN; END IF;
  IF v_match.winner_user_id IS NULL AND v_match.finish_reason <> 'both-bot-takeover'
     AND p_manual_leaver IS NULL THEN RETURN; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', p.user_id,
    'team_id', CASE WHEN p.piece_color = 'cream' THEN 'teamA' ELSE 'teamB' END,
    'outcome', CASE WHEN p.bot_takeover OR p.manual_left OR p.user_id <> v_match.winner_user_id
      THEN 'loss' ELSE 'win' END,
    'reason', CASE WHEN p.user_id = p_manual_leaver THEN 'manual_leave' ELSE 'match_finished' END
  )), '[]'::jsonb)
  INTO v_results
  FROM public.dama_match_players p
  WHERE p.match_id = p_match_id AND p.user_id IS NOT NULL
    AND (p.left_at IS NULL OR p.user_id = p_manual_leaver);

  PERFORM multiplayer_private.record_player_results(
    'dama', p_match_id, v_match.version,
    CASE WHEN p_manual_leaver IS NULL THEN NULL ELSE 'manual_leave' END,
    v_results
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dama_leave_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.dama_matches%ROWTYPE;
  v_player public.dama_match_players%ROWTYPE;
  v_opponent public.dama_match_players%ROWTYPE;
  v_result jsonb;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_match FROM public.dama_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_match_not_found'; END IF;
  SELECT * INTO v_player FROM public.dama_match_players
  WHERE match_id = p_match_id AND user_id = v_uid AND left_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_player.manual_left THEN RAISE EXCEPTION 'dama_membership_required' USING ERRCODE = '42501'; END IF;

  IF v_match.status = 'waiting' THEN
    UPDATE public.dama_match_players
    SET bot_takeover = false, manual_left = true, connected = false, left_at = clock_timestamp()
    WHERE id = v_player.id;
    UPDATE public.dama_matches SET status = 'cancelled', current_turn_user_id = NULL,
      version = version + 1, updated_at = clock_timestamp()
    WHERE id = p_match_id AND status = 'waiting';
    RETURN;
  END IF;
  IF v_match.status <> 'active' THEN RAISE EXCEPTION 'dama_match_not_active'; END IF;

  SELECT * INTO v_opponent FROM public.dama_match_players
  WHERE match_id = p_match_id AND user_id IS DISTINCT FROM v_uid AND left_at IS NULL
  ORDER BY player_index LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_opponent_missing'; END IF;

  IF v_opponent.bot_takeover THEN
    v_reason := 'both-bot-takeover';
    v_result := jsonb_build_object('winner', NULL, 'reason', v_reason);
  ELSE
    v_reason := 'manual-leave';
    v_result := jsonb_build_object('winner', v_opponent.piece_color, 'reason', v_reason);
  END IF;

  UPDATE public.dama_match_players
  SET bot_takeover = false, manual_left = true, connected = false, left_at = clock_timestamp()
  WHERE id = v_player.id;
  UPDATE public.dama_matches
  SET status = 'finished', current_turn_user_id = NULL,
      winner_user_id = CASE WHEN v_opponent.bot_takeover THEN NULL ELSE v_opponent.user_id END,
      finish_reason = v_reason,
      state = jsonb_set(jsonb_set(COALESCE(state, '{}'::jsonb), '{result}', v_result, true),
        '{turnDeadlineAtMs}', 'null'::jsonb, true),
      version = version + 1, updated_at = clock_timestamp()
  WHERE id = p_match_id AND status = 'active'
  RETURNING * INTO v_match;

  INSERT INTO public.dama_match_moves(match_id, version, user_id, action, payload)
  VALUES (p_match_id, v_match.version, v_uid, 'manual-leave',
    jsonb_build_object('manual_left', true, 'bot_takeover', false));

  INSERT INTO public.dama_fun_match_rewards(match_id, user_id, piece_color, point_delta, gem_delta)
  VALUES (p_match_id, v_uid, v_player.piece_color, -25, 0)
  ON CONFLICT (match_id, user_id) DO NOTHING;
  IF FOUND THEN
    UPDATE public.profiles SET points = GREATEST(0, COALESCE(points, 0) - 25), updated_at = clock_timestamp()
    WHERE id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_initialized'; END IF;
  END IF;

  PERFORM public.dama_settle_match(p_match_id);
  UPDATE public.dama_match_economy
  SET settlement = COALESCE(settlement, '{}'::jsonb) || jsonb_build_object(
    'manualLeaverUserId', v_uid, 'manualLeavePointDelta', -25
  )
  WHERE match_id = p_match_id;
  UPDATE public.dama_matches
  SET settlement = COALESCE(settlement, '{}'::jsonb) || jsonb_build_object(
    'manualLeaverUserId', v_uid, 'manualLeavePointDelta', -25
  )
  WHERE id = p_match_id;
  PERFORM multiplayer_private.record_dama_final_stats(p_match_id, v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.dama_leave_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dama_leave_match(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.dama_restore_control(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dama_restore_control(uuid) TO authenticated;
REVOKE ALL ON FUNCTION multiplayer_private.record_dama_final_stats(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION multiplayer_private.record_dama_final_stats(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
