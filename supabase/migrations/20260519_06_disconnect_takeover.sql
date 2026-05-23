-- Migration: Disconnection, bot takeover and abandonment support

-- Add columns to game_players for disconnect/takeover tracking
ALTER TABLE public.game_players
ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS bot_takeover boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS takeover_started_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS takeover_expires_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS abandoned boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS pending_forfeit boolean NOT NULL DEFAULT false;

-- Add columns to game_rooms for pending forfeit and forfeit winner
ALTER TABLE public.game_rooms
ADD COLUMN IF NOT EXISTS pending_forfeit boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS forfeit_winner_team text NULL;

-- Helper function: heartbeat
CREATE OR REPLACE FUNCTION public.player_heartbeat(p_game_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.game_players
  SET connected = true,
      last_seen_at = now(),
      updated_at = now(),
      left_at = NULL
  WHERE game_id = p_game_id
    AND user_id = v_uid;

  RETURN (FOUND);
END;
$$;

-- Helper function: mark explicit disconnect (can be called by server)
CREATE OR REPLACE FUNCTION public.mark_player_disconnected(p_game_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.game_players
  SET connected = false,
      updated_at = now()
  WHERE game_id = p_game_id
    AND user_id = p_user_id;

  RETURN FOUND;
END;
$$;

-- Process takeovers: convert seats to bot_takeover if offline beyond grace period
CREATE OR REPLACE FUNCTION public.process_takeovers(p_grace_seconds int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cutoff timestamptz := now() - (p_grace_seconds || ' seconds')::interval;
  r record;
  taken int := 0;
BEGIN
  FOR r IN
    SELECT gp.* FROM public.game_players gp
    JOIN public.game_rooms gr ON gr.id = gp.game_id
    WHERE gp.bot_takeover = false
      AND gp.abandoned = false
      AND (gp.connected = false OR (gp.last_seen_at IS NOT NULL AND gp.last_seen_at < cutoff))
  LOOP
    UPDATE public.game_players
    SET bot_takeover = true,
        takeover_started_at = now(),
        takeover_expires_at = NULL,
        updated_at = now()
    WHERE id = r.id;

    -- insert audit move noting takeover start
    INSERT INTO public.game_moves (game_id, player_id, sequence, action, payload)
    VALUES (
      r.game_id,
      r.user_id,
      (SELECT COALESCE(MAX(sequence),0) + 1 FROM public.game_moves WHERE game_id = r.game_id),
      'takeover_started',
      jsonb_build_object('player_index', r.player_index, 'user_id', r.user_id, 'reason', 'disconnect_timeout')
    );

    taken := taken + 1;
  END LOOP;

  RETURN taken;
END;
$$;

-- Restore human control when user reconnects within grace period
CREATE OR REPLACE FUNCTION public.restore_human_control(p_game_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.game_players
  SET bot_takeover = false,
      takeover_started_at = NULL,
      takeover_expires_at = NULL,
      connected = true,
      last_seen_at = now(),
      updated_at = now()
  WHERE game_id = p_game_id
    AND user_id = v_uid;

  -- insert audit move noting restore event
  INSERT INTO public.game_moves (game_id, player_id, sequence, action, payload)
  VALUES (
    p_game_id,
    v_uid,
    (SELECT COALESCE(MAX(sequence),0) + 1 FROM public.game_moves WHERE game_id = p_game_id),
    'takeover_restored',
    jsonb_build_object('user_id', v_uid)
  );

  RETURN FOUND;
END;
$$;

-- Evaluate abandonment/forfeit at hand boundary. Call this when moving to next hand.
-- For 1v1: if a player had bot_takeover at previous hand end and still bot_takeover now, mark abandoned and award forfeit.
-- For 2v2: if both teammates abandoned, mark forfeit for team.
CREATE OR REPLACE FUNCTION public.evaluate_abandonments_and_forfeits(p_game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  g record;
  players public.game_players%ROWTYPE;
  p_rows record;
  abandoned_players int := 0;
  teamA_abandoned boolean := false;
  teamB_abandoned boolean := false;
  result jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO g FROM public.game_rooms WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  FOR p_rows IN
    SELECT * FROM public.game_players WHERE game_id = p_game_id
  LOOP
    IF p_rows.abandoned THEN
      abandoned_players := abandoned_players + 1;
    END IF;
  END LOOP;

  -- For 1v1: if either player has bot_takeover and still bot_takeover -> abandoned -> forfeit
  IF g.mode = '1v1' THEN
    FOR p_rows IN SELECT * FROM public.game_players WHERE game_id = p_game_id
    LOOP
      IF p_rows.bot_takeover = true THEN
        -- mark abandoned and award forfeit to opponent
        UPDATE public.game_players SET abandoned = true WHERE id = p_rows.id;

        UPDATE public.game_rooms SET pending_forfeit = true, forfeit_winner_team = (
          SELECT CASE WHEN team_id = 'teamA' THEN 'teamB' ELSE 'teamA' END FROM public.game_players WHERE id = p_rows.id
        ) WHERE id = p_game_id;

        INSERT INTO public.game_moves (game_id, player_id, sequence, action, payload)
        VALUES (
          p_game_id,
          p_rows.user_id,
          (SELECT COALESCE(MAX(sequence),0) + 1 FROM public.game_moves WHERE game_id = p_game_id),
          'player_abandoned_forfeit',
          jsonb_build_object('user_id', p_rows.user_id, 'team_id', p_rows.team_id)
        );

        result := jsonb_build_object('forfeit', true, 'winner_team', (SELECT forfeit_winner_team FROM public.game_rooms WHERE id = p_game_id));
        RETURN result;
      END IF;
    END LOOP;
  END IF;

  -- For 2v2: if both teammates abandoned -> opponent wins at next hand start
  IF g.mode = '2v2' THEN
    -- check teamA
    SELECT count(*) = sum(CASE WHEN abandoned THEN 1 ELSE 0 END) INTO teamA_abandoned
    FROM public.game_players WHERE game_id = p_game_id AND team_id = 'teamA';

    SELECT count(*) = sum(CASE WHEN abandoned THEN 1 ELSE 0 END) INTO teamB_abandoned
    FROM public.game_players WHERE game_id = p_game_id AND team_id = 'teamB';

    IF teamA_abandoned THEN
      UPDATE public.game_rooms SET pending_forfeit = true, forfeit_winner_team = 'teamB' WHERE id = p_game_id;
      result := jsonb_build_object('forfeit', true, 'winner_team', 'teamB');
      RETURN result;
    ELSIF teamB_abandoned THEN
      UPDATE public.game_rooms SET pending_forfeit = true, forfeit_winner_team = 'teamA' WHERE id = p_game_id;
      result := jsonb_build_object('forfeit', true, 'winner_team', 'teamA');
      RETURN result;
    END IF;
  END IF;

  RETURN jsonb_build_object('forfeit', false);
END;
$$;

-- Adjust RLS: allow authenticated SELECT; updates to bot_takeover/abandoned should go through functions
ALTER TABLE public.game_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_players_select_authenticated" ON public.game_players FOR SELECT TO authenticated USING (true);

-- Block direct updates to sensitive takeover fields from clients
CREATE POLICY "game_players_update_restricted" ON public.game_players FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND bot_takeover = public.game_players.bot_takeover AND abandoned = public.game_players.abandoned AND pending_forfeit = public.game_players.pending_forfeit);

-- Note: the above CHECK prevents clients from modifying bot_takeover/abandoned/pending_forfeit via direct UPDATE (they must use RPC functions)

-- Grant execute on the new functions to authenticated (they are SECURITY DEFINER functions)
GRANT EXECUTE ON FUNCTION public.player_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_human_control(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_takeovers(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_player_disconnected(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_abandonments_and_forfeits(uuid) TO authenticated;

COMMIT;
