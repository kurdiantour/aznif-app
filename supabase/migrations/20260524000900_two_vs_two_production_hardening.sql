-- 2v2 production hardening.
-- This migration keeps real 2v2 state, lifecycle, matchmaking, and permissions
-- inside dedicated two_vs_two_* SQL objects only.

CREATE TABLE IF NOT EXISTS public.two_vs_two_game_states (
  room_id uuid PRIMARY KEY REFERENCES public.two_vs_two_rooms(id) ON DELETE CASCADE,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  version int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_two_vs_two_game_states_version
ON public.two_vs_two_game_states(room_id, version);

CREATE OR REPLACE FUNCTION public.sync_two_vs_two_game_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.two_vs_two_game_states(room_id, state, version, updated_at)
  VALUES (NEW.id, COALESCE(NEW.state, '{}'::jsonb), NEW.version, now())
  ON CONFLICT (room_id) DO UPDATE
  SET state = EXCLUDED.state,
      version = EXCLUDED.version,
      updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_two_vs_two_game_state ON public.two_vs_two_rooms;
CREATE TRIGGER trigger_sync_two_vs_two_game_state
AFTER INSERT OR UPDATE OF state, version ON public.two_vs_two_rooms
FOR EACH ROW EXECUTE FUNCTION public.sync_two_vs_two_game_state();

INSERT INTO public.two_vs_two_game_states(room_id, state, version)
SELECT id, COALESCE(state, '{}'::jsonb), version
FROM public.two_vs_two_rooms
ON CONFLICT (room_id) DO UPDATE
SET state = EXCLUDED.state,
    version = EXCLUDED.version,
    updated_at = now();

ALTER TABLE public.two_vs_two_players
ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS bot_takeover boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS takeover_started_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS takeover_expires_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS abandoned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_two_vs_two_players_user_room
ON public.two_vs_two_players(user_id, room_id)
WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_two_vs_two_players_room_team
ON public.two_vs_two_players(room_id, team_id);

CREATE INDEX IF NOT EXISTS idx_two_vs_two_rooms_active_status
ON public.two_vs_two_rooms(status, updated_at)
WHERE status IN ('waiting', 'active');

CREATE OR REPLACE FUNCTION public.find_two_vs_two_match()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.find_two_vs_two_opponent();
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_two_vs_two_room(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.cancel_two_vs_two_room(p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.two_vs_two_player_heartbeat(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.two_vs_two_players
  SET connected = true,
      last_seen_at = now(),
      left_at = NULL,
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = v_user_id
    AND abandoned = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not an active player in this 2v2 room';
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'room_id', p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_two_vs_two_player_disconnected(p_room_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.two_vs_two_players
  SET connected = false,
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND abandoned = false;

  RETURN jsonb_build_object('status', CASE WHEN FOUND THEN 'ok' ELSE 'not_found' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_two_vs_two_takeovers(p_grace_seconds int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff timestamptz := now() - (p_grace_seconds || ' seconds')::interval;
  v_player record;
  v_taken int := 0;
BEGIN
  FOR v_player IN
    SELECT p.*
    FROM public.two_vs_two_players p
    JOIN public.two_vs_two_rooms r ON r.id = p.room_id
    WHERE r.status = 'active'
      AND p.bot_takeover = false
      AND p.abandoned = false
      AND (
        p.connected = false
        OR (p.last_seen_at IS NOT NULL AND p.last_seen_at < v_cutoff)
      )
  LOOP
    UPDATE public.two_vs_two_players
    SET bot_takeover = true,
        takeover_started_at = now(),
        takeover_expires_at = NULL,
        updated_at = now()
    WHERE id = v_player.id;

    INSERT INTO public.two_vs_two_moves(room_id, player_id, sequence, action, payload)
    VALUES (
      v_player.room_id,
      v_player.user_id,
      public.next_two_vs_two_move_sequence(v_player.room_id),
      'takeover_started',
      jsonb_build_object('player_index', v_player.player_index, 'user_id', v_player.user_id, 'reason', 'disconnect_timeout')
    );

    v_taken := v_taken + 1;
  END LOOP;

  RETURN v_taken;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_two_vs_two_human_control(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.two_vs_two_players
  SET bot_takeover = false,
      takeover_started_at = NULL,
      takeover_expires_at = NULL,
      connected = true,
      last_seen_at = now(),
      left_at = NULL,
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = v_user_id
    AND abandoned = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not an active player in this 2v2 room';
  END IF;

  INSERT INTO public.two_vs_two_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_user_id,
    public.next_two_vs_two_move_sequence(p_room_id),
    'takeover_restored',
    jsonb_build_object('user_id', v_user_id)
  );

  RETURN jsonb_build_object('status', 'ok', 'room_id', p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_two_vs_two_abandonments_and_forfeits(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_team_a_abandoned boolean := false;
  v_team_b_abandoned boolean := false;
  v_winning_team text;
  v_state jsonb;
BEGIN
  SELECT * INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  IF v_room.status <> 'active' THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  UPDATE public.two_vs_two_players
  SET abandoned = true,
      connected = false,
      updated_at = now()
  WHERE room_id = p_room_id
    AND bot_takeover = true
    AND abandoned = false;

  SELECT COUNT(*) > 0 AND COUNT(*) = COUNT(*) FILTER (WHERE abandoned)
  INTO v_team_a_abandoned
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id AND team_id = 'teamA';

  SELECT COUNT(*) > 0 AND COUNT(*) = COUNT(*) FILTER (WHERE abandoned)
  INTO v_team_b_abandoned
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id AND team_id = 'teamB';

  IF v_team_a_abandoned THEN
    v_winning_team := 'teamB';
  ELSIF v_team_b_abandoned THEN
    v_winning_team := 'teamA';
  ELSE
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  v_state := COALESCE(v_room.state, '{}'::jsonb)
    || jsonb_build_object(
      'winningTeamId', v_winning_team,
      'forfeitReason', 'team_abandoned',
      'matchReward', jsonb_build_object('tier', 'normal', 'gold', 6, 'points', 20),
      'canDrawTile', false
    );

  UPDATE public.two_vs_two_rooms
  SET status = 'finished',
      state = v_state,
      current_turn_player_id = NULL,
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id;

  INSERT INTO public.two_vs_two_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    NULL,
    public.next_two_vs_two_move_sequence(p_room_id),
    'team_abandoned_forfeit',
    jsonb_build_object('winner_team', v_winning_team)
  );

  RETURN jsonb_build_object('forfeit', true, 'winner_team', v_winning_team);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_two_vs_two_snapshot(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_game_state public.two_vs_two_game_states%ROWTYPE;
  v_private public.two_vs_two_private_states%ROWTYPE;
  v_player_index int;
  v_hand jsonb := '[]'::jsonb;
  v_public_state jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT player_index INTO v_player_index
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id AND user_id = v_user_id;

  IF v_player_index IS NULL THEN
    RAISE EXCEPTION 'You are not a player in this 2v2 room';
  END IF;

  SELECT * INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  SELECT * INTO v_game_state
  FROM public.two_vs_two_game_states
  WHERE room_id = p_room_id;

  IF FOUND THEN
    v_public_state := COALESCE(v_game_state.state, '{}'::jsonb);
  ELSE
    v_public_state := COALESCE(v_room.state, '{}'::jsonb);
  END IF;

  SELECT * INTO v_private
  FROM public.two_vs_two_private_states
  WHERE room_id = p_room_id;

  IF FOUND THEN
    v_hand := COALESCE(v_private.hands -> v_player_index, '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'id', v_room.id,
    'status', v_room.status,
    'version', GREATEST(v_room.version, COALESCE(v_game_state.version, 0)),
    'current_turn_player_id', v_room.current_turn_player_id,
    'state', v_public_state || jsonb_build_object('myHand', v_hand)
  );
END;
$$;

ALTER TABLE public.two_vs_two_game_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "two_vs_two_game_states_select_members" ON public.two_vs_two_game_states;
CREATE POLICY "two_vs_two_game_states_select_members"
ON public.two_vs_two_game_states FOR SELECT TO authenticated
USING (public.is_two_vs_two_room_member(room_id));

DROP POLICY IF EXISTS "two_vs_two_game_states_insert_rpc_only" ON public.two_vs_two_game_states;
CREATE POLICY "two_vs_two_game_states_insert_rpc_only"
ON public.two_vs_two_game_states FOR INSERT TO authenticated
WITH CHECK (false);

DROP POLICY IF EXISTS "two_vs_two_game_states_update_rpc_only" ON public.two_vs_two_game_states;
CREATE POLICY "two_vs_two_game_states_update_rpc_only"
ON public.two_vs_two_game_states FOR UPDATE TO authenticated
USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "two_vs_two_queue_insert_rpc_only" ON public.two_vs_two_matchmaking_queue;
CREATE POLICY "two_vs_two_queue_insert_rpc_only"
ON public.two_vs_two_matchmaking_queue FOR INSERT TO authenticated
WITH CHECK (false);

DROP POLICY IF EXISTS "two_vs_two_queue_update_rpc_only" ON public.two_vs_two_matchmaking_queue;
CREATE POLICY "two_vs_two_queue_update_rpc_only"
ON public.two_vs_two_matchmaking_queue FOR UPDATE TO authenticated
USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "two_vs_two_queue_delete_rpc_only" ON public.two_vs_two_matchmaking_queue;
CREATE POLICY "two_vs_two_queue_delete_rpc_only"
ON public.two_vs_two_matchmaking_queue FOR DELETE TO authenticated
USING (false);

GRANT SELECT ON public.two_vs_two_game_states TO authenticated;
REVOKE ALL ON public.two_vs_two_private_states FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.next_two_vs_two_move_sequence(uuid) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.find_two_vs_two_match() TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_two_vs_two_room(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.two_vs_two_player_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_two_vs_two_player_disconnected(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_two_vs_two_takeovers(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_two_vs_two_human_control(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_two_vs_two_abandonments_and_forfeits(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_two_vs_two_snapshot(uuid) TO authenticated;

ALTER FUNCTION public.find_two_vs_two_opponent() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_two_vs_two_matchmaking_status() SET search_path = public, pg_temp;
ALTER FUNCTION public.cancel_two_vs_two_matchmaking(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.cancel_two_vs_two_room(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.start_two_vs_two_game(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_two_vs_two_room_member(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.next_two_vs_two_move_sequence(uuid) SET search_path = public, pg_temp;
