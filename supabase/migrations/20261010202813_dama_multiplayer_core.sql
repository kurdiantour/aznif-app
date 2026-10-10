-- Dama owns its match state and rules. Shared chat and resume contracts are
-- extended separately below; no Domino state or economy is reused.
CREATE TABLE public.dama_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('waiting', 'active', 'finished', 'cancelled')),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  state jsonb,
  current_turn_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  winner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  finish_reason text CHECK (finish_reason IS NULL OR finish_reason IN ('no-pieces', 'no-moves', 'one-vs-one', 'repetition', 'quiet-limit', 'manual-leave', 'timeout')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'active' AND state IS NOT NULL) OR status <> 'active')
);

CREATE TABLE public.dama_match_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.dama_matches(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  player_index smallint NOT NULL CHECK (player_index IN (0, 1)),
  piece_color text NOT NULL CHECK (piece_color IN ('cream', 'black')),
  connected boolean NOT NULL DEFAULT true,
  bot_takeover boolean NOT NULL DEFAULT false,
  manual_left boolean NOT NULL DEFAULT false,
  left_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (match_id, player_index),
  UNIQUE (match_id, user_id)
);

CREATE INDEX dama_match_players_user_active_idx
  ON public.dama_match_players(user_id, joined_at DESC)
  WHERE user_id IS NOT NULL AND left_at IS NULL;

CREATE OR REPLACE FUNCTION public.is_dama_match_member(p_match_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '' AS $$
  SELECT p_user_id IS NOT NULL AND p_user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.dama_match_players p
    WHERE p.match_id = p_match_id AND p.user_id = p_user_id AND p.left_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.is_dama_match_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_dama_match_member(uuid, uuid) TO authenticated;

CREATE TABLE public.dama_match_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.dama_matches(id) ON DELETE CASCADE,
  version bigint NOT NULL CHECK (version > 0),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('move', 'timeout-move', 'bot-move', 'manual-leave')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (match_id, version)
);

ALTER TABLE public.dama_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dama_match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dama_match_moves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dama_matches, public.dama_match_players, public.dama_match_moves FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dama_matches, public.dama_match_players, public.dama_match_moves TO authenticated;
GRANT ALL ON public.dama_matches, public.dama_match_players, public.dama_match_moves TO service_role;

CREATE POLICY dama_matches_member_read ON public.dama_matches
  FOR SELECT TO authenticated
  USING (public.is_dama_match_member(id, (SELECT auth.uid())));
CREATE POLICY dama_players_member_read ON public.dama_match_players
  FOR SELECT TO authenticated
  USING (public.is_dama_match_member(match_id, (SELECT auth.uid())));
CREATE POLICY dama_moves_member_read ON public.dama_match_moves
  FOR SELECT TO authenticated
  USING (public.is_dama_match_member(match_id, (SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.dama_start_match(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_players integer;
  v_cream_user uuid;
  v_now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_pieces jsonb;
  v_state jsonb;
BEGIN
  SELECT count(*) INTO v_players FROM public.dama_match_players
    WHERE match_id = p_match_id AND left_at IS NULL AND user_id IS NOT NULL;
  SELECT user_id INTO v_cream_user FROM public.dama_match_players
    WHERE match_id = p_match_id AND piece_color = 'cream' AND left_at IS NULL;
  IF v_players <> 2 THEN RAISE EXCEPTION 'dama_requires_two_players'; END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'id', color || '-' || row_no || '-' || col_no,
    'color', color, 'row', row_no, 'column', col_no, 'king', false
  ) ORDER BY color, row_no, col_no)
  INTO v_pieces
  FROM (
    SELECT 'black'::text AS color, r AS row_no, c AS col_no FROM generate_series(1, 2) r CROSS JOIN generate_series(0, 7) c
    UNION ALL
    SELECT 'cream'::text AS color, r AS row_no, c AS col_no FROM generate_series(5, 6) r CROSS JOIN generate_series(0, 7) c
  ) initial_pieces;
  v_state := jsonb_build_object(
    'pieces', v_pieces, 'turn', 'cream', 'ply', 0, 'result', NULL,
    'quietPly', 0, 'history', '{}'::jsonb,
    'turnStartedAtMs', v_now_ms, 'turnDeadlineAtMs', v_now_ms + 15000
  );
  UPDATE public.dama_matches
    SET status = 'active', state = v_state, current_turn_user_id = v_cream_user,
        version = version + 1, updated_at = clock_timestamp()
    WHERE id = p_match_id AND status = 'waiting';
END;
$$;

CREATE OR REPLACE FUNCTION public.find_dama_match()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.dama_matches%ROWTYPE;
  v_index smallint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dama-matchmaking', 0));
  SELECT m.* INTO v_match FROM public.dama_matches m
  JOIN public.dama_match_players p ON p.match_id = m.id
  WHERE p.user_id = v_uid AND p.left_at IS NULL AND m.status IN ('waiting', 'active')
  ORDER BY m.created_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('status', v_match.status, 'match_id', v_match.id); END IF;

  SELECT m.* INTO v_match FROM public.dama_matches m
  WHERE m.status = 'waiting'
    AND (SELECT count(*) FROM public.dama_match_players p WHERE p.match_id = m.id AND p.left_at IS NULL) = 1
    AND NOT EXISTS (SELECT 1 FROM public.dama_match_players p WHERE p.match_id = m.id AND p.user_id = v_uid)
  ORDER BY m.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
    SELECT COALESCE(max(player_index), -1) + 1 INTO v_index FROM public.dama_match_players WHERE match_id = v_match.id;
    INSERT INTO public.dama_match_players(match_id, user_id, player_index, piece_color)
      VALUES (v_match.id, v_uid, v_index, CASE WHEN v_index = 0 THEN 'cream' ELSE 'black' END);
    PERFORM public.dama_start_match(v_match.id);
    RETURN jsonb_build_object('status', 'matched', 'match_id', v_match.id);
  END IF;

  INSERT INTO public.dama_matches(status) VALUES ('waiting') RETURNING * INTO v_match;
  INSERT INTO public.dama_match_players(match_id, user_id, player_index, piece_color)
    VALUES (v_match.id, v_uid, 0, 'cream');
  RETURN jsonb_build_object('status', 'searching', 'match_id', v_match.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dama_match_snapshot(p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_match public.dama_matches%ROWTYPE; v_players jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dama_match_players WHERE match_id = p_match_id AND user_id = v_uid AND left_at IS NULL) THEN
    RAISE EXCEPTION 'dama_membership_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT v_match FROM public.dama_matches WHERE id = p_match_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.user_id, 'userId', p.user_id, 'playerIndex', p.player_index,
    'pieceColor', p.piece_color, 'connected', p.connected, 'lastSeenAt', p.last_seen_at,
    'botTakeover', p.bot_takeover, 'username', COALESCE(pr.username, 'Player'),
    'avatarId', pr.avatar_id, 'avatarUrl', pr.avatar_url
  ) ORDER BY p.player_index), '[]'::jsonb)
  INTO v_players FROM public.dama_match_players p
  LEFT JOIN public.profiles pr ON pr.id = p.user_id
  WHERE p.match_id = p_match_id AND p.left_at IS NULL;
  RETURN jsonb_build_object(
    'id', v_match.id, 'status', v_match.status, 'version', v_match.version,
    'state', v_match.state, 'current_turn_user_id', v_match.current_turn_user_id,
    'winner_user_id', v_match.winner_user_id, 'finish_reason', v_match.finish_reason,
    'players', v_players
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dama_heartbeat(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  UPDATE public.dama_match_players SET connected = true, last_seen_at = clock_timestamp()
  WHERE match_id = p_match_id AND user_id = auth.uid() AND left_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_membership_required' USING ERRCODE = '42501'; END IF;
END;
$$;

ALTER TABLE public.dama_match_moves DROP CONSTRAINT dama_match_moves_action_check;
ALTER TABLE public.dama_match_moves ADD CONSTRAINT dama_match_moves_action_check
  CHECK (action IN ('move', 'timeout-move', 'bot-move', 'manual-leave', 'disconnect-takeover'));

CREATE OR REPLACE FUNCTION public.dama_claim_bot_takeover(p_match_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_target public.dama_match_players%ROWTYPE; v_version bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.dama_matches WHERE id = p_match_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dama_match_players WHERE match_id = p_match_id AND user_id = v_uid AND left_at IS NULL) THEN
    RAISE EXCEPTION 'dama_membership_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_target FROM public.dama_match_players
    WHERE match_id = p_match_id AND user_id <> v_uid AND left_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_target.bot_takeover OR v_target.last_seen_at > clock_timestamp() - interval '75 seconds' THEN RETURN false; END IF;
  UPDATE public.dama_match_players SET connected = false, bot_takeover = true, manual_left = false
    WHERE id = v_target.id AND NOT bot_takeover;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.dama_matches SET version = version + 1, updated_at = clock_timestamp()
    WHERE id = p_match_id AND status = 'active' RETURNING version INTO v_version;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.dama_match_moves(match_id, version, user_id, action, payload)
    VALUES (p_match_id, v_version, v_target.user_id, 'disconnect-takeover', jsonb_build_object('last_seen_at', v_target.last_seen_at));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.dama_restore_control(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.dama_matches WHERE id = p_match_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_match_not_active'; END IF;
  UPDATE public.dama_match_players SET bot_takeover = false, manual_left = false, connected = true, last_seen_at = clock_timestamp()
    WHERE match_id = p_match_id AND user_id = auth.uid() AND left_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_membership_required' USING ERRCODE = '42501'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION multiplayer_private.record_dama_final_stats(p_match_id uuid, p_manual_leaver uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_match public.dama_matches%ROWTYPE; v_results jsonb;
BEGIN
  SELECT * INTO v_match FROM public.dama_matches WHERE id = p_match_id;
  IF NOT FOUND OR (p_manual_leaver IS NULL AND v_match.status <> 'finished') THEN RETURN; END IF;
  IF p_manual_leaver IS NULL AND v_match.winner_user_id IS NULL THEN RETURN; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', p.user_id,
    'team_id', CASE WHEN p.piece_color = 'cream' THEN 'teamA' ELSE 'teamB' END,
    'outcome', CASE WHEN p.user_id = p_manual_leaver THEN 'loss'
      WHEN p.user_id = v_match.winner_user_id THEN 'win' ELSE 'loss' END,
    'reason', CASE WHEN p.user_id = p_manual_leaver THEN 'manual_leave' ELSE 'match_finished' END
  )), '[]'::jsonb) INTO v_results
  FROM public.dama_match_players p
  WHERE p.match_id = p_match_id AND p.user_id IS NOT NULL
    AND ((p_manual_leaver IS NOT NULL AND p.user_id = p_manual_leaver)
      OR (p_manual_leaver IS NULL AND p.left_at IS NULL));
  PERFORM multiplayer_private.record_player_results('dama', p_match_id, v_match.version,
    CASE WHEN p_manual_leaver IS NULL THEN NULL ELSE 'manual_leave' END, v_results);
END;
$$;
REVOKE ALL ON FUNCTION multiplayer_private.record_dama_final_stats(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION multiplayer_private.record_dama_final_stats(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.dama_leave_match(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_color text; v_bot_count integer; v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  SELECT status INTO v_status FROM public.dama_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_match_not_found'; END IF;
  SELECT piece_color INTO v_color FROM public.dama_match_players
    WHERE match_id = p_match_id AND user_id = v_uid AND left_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_membership_required' USING ERRCODE = '42501'; END IF;
  IF v_status = 'waiting' THEN
    UPDATE public.dama_match_players SET bot_takeover = true, connected = false
      WHERE match_id = p_match_id AND user_id = v_uid;
    UPDATE public.dama_match_players SET left_at = clock_timestamp() WHERE match_id = p_match_id AND user_id = v_uid;
    UPDATE public.dama_matches SET status = 'cancelled', version = version + 1, updated_at = clock_timestamp()
      WHERE id = p_match_id AND status = 'waiting';
  ELSIF v_status = 'active' THEN
    -- Match the Domino takeover contract: keep the seat and match resumable while
    -- the opponent's client submits server-computed Dama bot moves.
    UPDATE public.dama_match_players SET bot_takeover = true, manual_left = true, connected = false
      WHERE match_id = p_match_id AND user_id = v_uid;
    SELECT count(*) INTO v_bot_count FROM public.dama_match_players
      WHERE match_id = p_match_id AND bot_takeover AND left_at IS NULL;
    IF v_bot_count = 2 THEN
      UPDATE public.dama_matches SET status = 'finished', current_turn_user_id = NULL,
        winner_user_id = NULL, finish_reason = 'manual-leave',
        state = jsonb_set(COALESCE(state, '{}'::jsonb), '{result}',
          jsonb_build_object('winner', NULL, 'reason', 'manual-leave')),
        version = version + 1, updated_at = clock_timestamp()
        WHERE id = p_match_id AND status = 'active';
    ELSE
      UPDATE public.dama_matches SET version = version + 1, updated_at = clock_timestamp()
        WHERE id = p_match_id AND status = 'active';
    END IF;
    INSERT INTO public.dama_match_moves(match_id, version, user_id, action, payload)
      SELECT id, version, v_uid, 'manual-leave', jsonb_build_object('bot_takeover', true)
      FROM public.dama_matches WHERE id = p_match_id;
    PERFORM multiplayer_private.record_dama_final_stats(p_match_id, v_uid);
  ELSE
    RAISE EXCEPTION 'dama_match_not_active';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_dama_action(
  p_match_id uuid, p_expected_version bigint, p_actor_user_id uuid,
  p_state jsonb, p_current_turn_user_id uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_match public.dama_matches%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_match FROM public.dama_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND OR v_match.status <> 'active' OR v_match.version <> p_expected_version THEN
    RAISE EXCEPTION 'STALE_DAMA_STATE' USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dama_match_players WHERE match_id = p_match_id AND user_id = p_actor_user_id AND left_at IS NULL) THEN
    RAISE EXCEPTION 'dama_actor_not_member' USING ERRCODE = '42501';
  END IF;
  UPDATE public.dama_matches SET
    state = p_state, current_turn_user_id = p_current_turn_user_id,
    status = CASE WHEN p_state->'result' IS NOT NULL AND p_state->'result' <> 'null'::jsonb THEN 'finished' ELSE 'active' END,
    winner_user_id = CASE
      WHEN p_state->'result' IS NULL OR p_state->'result' = 'null'::jsonb OR p_state->'result'->>'winner' IS NULL THEN NULL
      ELSE (SELECT user_id FROM public.dama_match_players WHERE match_id = p_match_id AND piece_color = p_state->'result'->>'winner' AND left_at IS NULL)
    END,
    finish_reason = p_state->'result'->>'reason',
    version = version + 1, updated_at = clock_timestamp()
  WHERE id = p_match_id RETURNING * INTO v_match;
  INSERT INTO public.dama_match_moves(match_id, version, user_id, action, payload)
    VALUES (p_match_id, v_match.version, p_actor_user_id, p_action, COALESCE(p_payload, '{}'::jsonb));
  IF v_match.status = 'finished' THEN
    PERFORM multiplayer_private.record_dama_final_stats(p_match_id);
  END IF;
  RETURN jsonb_build_object('id', v_match.id, 'status', v_match.status, 'version', v_match.version,
    'state', v_match.state, 'current_turn_user_id', v_match.current_turn_user_id,
    'winner_user_id', v_match.winner_user_id, 'finish_reason', v_match.finish_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.dama_start_match(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_dama_match() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_dama_match_snapshot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dama_heartbeat(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dama_claim_bot_takeover(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dama_restore_control(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dama_leave_match(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commit_dama_action(uuid, bigint, uuid, jsonb, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_dama_match() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dama_match_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_claim_bot_takeover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_restore_control(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_leave_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_dama_action(uuid, bigint, uuid, jsonb, uuid, text, jsonb) TO service_role;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.dama_matches;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.dama_match_players;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.dama_match_moves;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend the existing shared chat membership gate with Dama only.
CREATE OR REPLACE FUNCTION public.is_game_room_member(
  p_game_type text, p_match_id uuid, p_user_id uuid DEFAULT auth.uid(), p_mode text DEFAULT NULL
) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, okey, pg_temp AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    WHEN p_game_type = 'domino' AND p_mode = '1v1' THEN EXISTS (
      SELECT 1 FROM public.one_vs_one_players WHERE room_id = p_match_id AND user_id = p_user_id AND left_at IS NULL)
    WHEN p_game_type = 'domino' AND p_mode = '2v2' THEN EXISTS (
      SELECT 1 FROM public.two_vs_two_players WHERE room_id = p_match_id AND user_id = p_user_id AND left_at IS NULL)
    WHEN p_game_type = 'okey' THEN EXISTS (
      SELECT 1 FROM okey.match_seats WHERE match_id = p_match_id AND user_id = p_user_id AND membership_released_at IS NULL)
    WHEN p_game_type = 'dame' AND p_mode = '1v1' THEN EXISTS (
      SELECT 1 FROM public.dama_match_players WHERE match_id = p_match_id AND user_id = p_user_id AND left_at IS NULL)
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.is_game_room_member(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_game_room_member(text, uuid, uuid, text) TO authenticated;

-- Allow shared match statistics to represent Dama terminal results.
ALTER TABLE public.multiplayer_match_stat_results
  DROP CONSTRAINT IF EXISTS multiplayer_match_stat_results_game_type_check;
ALTER TABLE public.multiplayer_match_stat_results
  ADD CONSTRAINT multiplayer_match_stat_results_game_type_check
  CHECK (game_type IN ('okey', 'domino_1v1', 'domino_2v2', 'dama'));

NOTIFY pgrst, 'reload schema';
