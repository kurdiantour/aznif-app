-- Keep Dama in the waiting room for the shared five-second pre-game countdown.
-- The countdown is persisted on the server and every start path checks it.
ALTER TABLE public.dama_matches
  ADD COLUMN IF NOT EXISTS countdown_deadline_at timestamptz;

CREATE OR REPLACE FUNCTION public.refresh_dama_waiting_countdown()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.match_id ELSE NEW.match_id END;
  v_players integer;
BEGIN
  PERFORM 1 FROM public.dama_matches WHERE id = v_match_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_players
  FROM public.dama_match_players
  WHERE match_id = v_match_id AND left_at IS NULL AND user_id IS NOT NULL;

  UPDATE public.dama_matches
  SET countdown_deadline_at = CASE
        WHEN status = 'waiting' AND v_players = 2
          THEN COALESCE(countdown_deadline_at, clock_timestamp() + interval '5 seconds')
        ELSE NULL
      END,
      updated_at = clock_timestamp()
  WHERE id = v_match_id AND status = 'waiting';
  RETURN NULL;
END;
$$;

CREATE TRIGGER dama_waiting_countdown
AFTER INSERT OR DELETE OR UPDATE OF left_at ON public.dama_match_players
FOR EACH ROW EXECUTE FUNCTION public.refresh_dama_waiting_countdown();

CREATE OR REPLACE FUNCTION public.find_dama_match()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.dama_matches%ROWTYPE;
  v_index smallint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dama-matchmaking', 0));

  SELECT m.* INTO v_match
  FROM public.dama_matches m
  JOIN public.dama_match_players p ON p.match_id = m.id
  WHERE p.user_id = v_uid AND p.left_at IS NULL AND m.status IN ('waiting', 'active')
  ORDER BY m.created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status', v_match.status, 'match_id', v_match.id);
  END IF;

  SELECT m.* INTO v_match
  FROM public.dama_matches m
  WHERE m.status = 'waiting'
    AND (SELECT count(*) FROM public.dama_match_players p
      WHERE p.match_id = m.id AND p.left_at IS NULL AND p.user_id IS NOT NULL) = 1
    AND NOT EXISTS (SELECT 1 FROM public.dama_match_players p
      WHERE p.match_id = m.id AND p.user_id = v_uid)
  ORDER BY m.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    SELECT COALESCE(max(player_index), -1) + 1 INTO v_index
    FROM public.dama_match_players WHERE match_id = v_match.id;
    INSERT INTO public.dama_match_players(match_id, user_id, player_index, piece_color)
    VALUES (v_match.id, v_uid, v_index, CASE WHEN v_index = 0 THEN 'cream' ELSE 'black' END);
    RETURN jsonb_build_object('status', 'matched', 'match_id', v_match.id);
  END IF;

  INSERT INTO public.dama_matches(status) VALUES ('waiting') RETURNING * INTO v_match;
  INSERT INTO public.dama_match_players(match_id, user_id, player_index, piece_color)
  VALUES (v_match.id, v_uid, 0, 'cream');
  RETURN jsonb_build_object('status', 'searching', 'match_id', v_match.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.dama_start_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match public.dama_matches%ROWTYPE;
  v_players integer;
  v_cream_user uuid;
  v_now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_pieces jsonb;
  v_state jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.dama_match_players
    WHERE match_id = p_match_id AND user_id = auth.uid() AND left_at IS NULL
  ) THEN RAISE EXCEPTION 'dama_membership_required' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_match FROM public.dama_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND OR v_match.status <> 'waiting' THEN RETURN; END IF;
  IF v_match.countdown_deadline_at IS NULL OR v_match.countdown_deadline_at > clock_timestamp() THEN
    RAISE EXCEPTION 'countdown_not_complete' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_players FROM public.dama_match_players
  WHERE match_id = p_match_id AND left_at IS NULL AND user_id IS NOT NULL;
  IF v_players <> 2 THEN RAISE EXCEPTION 'dama_requires_two_players'; END IF;

  PERFORM public.dama_charge_entry_fee(p_match_id);
  SELECT user_id INTO v_cream_user FROM public.dama_match_players
  WHERE match_id = p_match_id AND piece_color = 'cream' AND left_at IS NULL;
  SELECT jsonb_agg(jsonb_build_object(
    'id', color || '-' || row_no || '-' || col_no,
    'color', color, 'row', row_no, 'column', col_no, 'king', false
  ) ORDER BY color, row_no, col_no) INTO v_pieces
  FROM (
    SELECT 'black'::text AS color, r AS row_no, c AS col_no
    FROM generate_series(1, 2) r CROSS JOIN generate_series(0, 7) c
    UNION ALL
    SELECT 'cream'::text AS color, r AS row_no, c AS col_no
    FROM generate_series(5, 6) r CROSS JOIN generate_series(0, 7) c
  ) initial_pieces;

  v_state := jsonb_build_object(
    'pieces', v_pieces, 'turn', 'cream', 'ply', 0, 'result', NULL,
    'quietPly', 0, 'history', '{}'::jsonb,
    'timeoutStrikes', jsonb_build_object('cream', 0, 'black', 0),
    'turnStartedAtMs', v_now_ms, 'turnDeadlineAtMs', v_now_ms + 15000
  );
  UPDATE public.dama_matches
  SET status = 'active', state = v_state, current_turn_user_id = v_cream_user,
      countdown_deadline_at = NULL, version = version + 1, updated_at = clock_timestamp()
  WHERE id = p_match_id AND status = 'waiting';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dama_match_snapshot(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.dama_matches%ROWTYPE;
  v_players jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dama_match_players
    WHERE match_id = p_match_id AND user_id = v_uid AND left_at IS NULL)
  THEN RAISE EXCEPTION 'dama_membership_required' USING ERRCODE = '42501'; END IF;

  SELECT * INTO STRICT v_match FROM public.dama_matches WHERE id = p_match_id;
  IF v_match.status = 'waiting' AND v_match.countdown_deadline_at IS NOT NULL
    AND v_match.countdown_deadline_at <= clock_timestamp() THEN
    PERFORM public.dama_start_match(p_match_id);
    SELECT * INTO STRICT v_match FROM public.dama_matches WHERE id = p_match_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.user_id, 'userId', p.user_id, 'playerIndex', p.player_index,
    'pieceColor', p.piece_color,
    'connected', p.connected AND p.last_seen_at > clock_timestamp() - interval '45 seconds',
    'lastSeenAt', p.last_seen_at, 'botTakeover', p.bot_takeover,
    'consecutiveTimeoutStrikes', p.consecutive_timeout_strikes,
    'username', COALESCE(pr.username, 'Player'), 'avatarId', pr.avatar_id, 'avatarUrl', pr.avatar_url
  ) ORDER BY p.player_index), '[]'::jsonb) INTO v_players
  FROM public.dama_match_players p LEFT JOIN public.profiles pr ON pr.id = p.user_id
  WHERE p.match_id = p_match_id AND p.left_at IS NULL;

  RETURN jsonb_build_object(
    'id', v_match.id, 'status', v_match.status, 'version', v_match.version,
    'state', v_match.state, 'current_turn_user_id', v_match.current_turn_user_id,
    'winner_user_id', v_match.winner_user_id, 'finish_reason', v_match.finish_reason,
    'settlement', v_match.settlement, 'countdown_ends_at', v_match.countdown_deadline_at,
    'players', v_players
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_dama_waiting_countdown() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_dama_match() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dama_start_match(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_dama_match_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_dama_match() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_start_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dama_match_snapshot(uuid) TO authenticated;

-- The shared-statistics schema intentionally denies access to client roles.
-- The Dama service-role commit RPC calls its narrowly granted final-stats
-- function, so service_role needs schema USAGE while EXECUTE remains limited
-- to the explicitly granted function.
GRANT USAGE ON SCHEMA multiplayer_private TO service_role;

NOTIFY pgrst, 'reload schema';
