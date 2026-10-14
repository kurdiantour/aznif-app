-- Use one 20-second Dama lobby clock. A bot joins when 15 seconds remain,
-- and both human and bot matches start at the original clock's zero.
ALTER TABLE public.dama_bot_settings
  DROP CONSTRAINT IF EXISTS dama_bot_settings_wait_seconds_check;
ALTER TABLE public.dama_bot_settings
  ALTER COLUMN wait_seconds SET DEFAULT 5;
ALTER TABLE public.dama_bot_settings
  ADD CONSTRAINT dama_bot_settings_wait_seconds_check CHECK (wait_seconds BETWEEN 1 AND 20);
UPDATE public.dama_bot_settings SET wait_seconds=5 WHERE singleton;

CREATE OR REPLACE FUNCTION public.refresh_dama_waiting_countdown()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.match_id ELSE NEW.match_id END;
  v_players integer;
  v_started_at timestamptz;
BEGIN
  SELECT matchmaking_started_at INTO v_started_at
  FROM public.dama_matches WHERE id=v_match_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_players
  FROM public.dama_match_players
  WHERE match_id=v_match_id AND left_at IS NULL AND user_id IS NOT NULL;

  UPDATE public.dama_matches
  SET countdown_deadline_at = CASE
        WHEN status='waiting' AND v_players=2
          THEN COALESCE(countdown_deadline_at, COALESCE(v_started_at,clock_timestamp()) + interval '20 seconds')
        ELSE NULL
      END,
      updated_at=clock_timestamp()
  WHERE id=v_match_id AND status='waiting';
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.dama_fill_waiting_with_bot(p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_match public.dama_matches%ROWTYPE;
  v_human public.dama_match_players%ROWTYPE;
  v_bot public.dama_bot_profiles%ROWTYPE;
  v_index smallint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dama-matchmaking', 0));
  SELECT * INTO v_match FROM public.dama_matches WHERE id=p_match_id FOR UPDATE;
  IF NOT FOUND OR v_match.status <> 'waiting' OR v_match.matchmaking_deadline_at IS NULL
    OR v_match.matchmaking_deadline_at > clock_timestamp()
    OR NOT public.dama_bot_matchmaking_enabled() THEN
    RETURN jsonb_build_object('assigned',false,'reason','not_due_or_disabled');
  END IF;

  SELECT * INTO v_human FROM public.dama_match_players
  WHERE match_id=p_match_id AND left_at IS NULL AND user_id IS NOT NULL FOR UPDATE;
  IF NOT FOUND OR (SELECT count(*) FROM public.dama_match_players
      WHERE match_id=p_match_id AND left_at IS NULL) <> 1 THEN
    UPDATE public.dama_matches SET matchmaking_deadline_at=NULL WHERE id=p_match_id;
    RETURN jsonb_build_object('assigned',false,'reason','seat_changed');
  END IF;

  SELECT * INTO v_bot FROM public.dama_bot_profiles
  WHERE active AND coin_balance >= 500 ORDER BY random() LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    UPDATE public.dama_matches SET matchmaking_deadline_at=clock_timestamp()+interval '3 seconds'
    WHERE id=p_match_id;
    RETURN jsonb_build_object('assigned',false,'reason','bot_pool_empty');
  END IF;

  SELECT COALESCE(max(player_index),-1)+1 INTO v_index
  FROM public.dama_match_players WHERE match_id=p_match_id;
  INSERT INTO public.dama_match_players(match_id,bot_profile_id,player_index,piece_color)
  VALUES(p_match_id,v_bot.id,v_index,CASE WHEN v_index=0 THEN 'cream' ELSE 'black' END);

  UPDATE public.dama_matches
  SET matchmaking_deadline_at=NULL, matchmaking_started_at=NULL,
      countdown_deadline_at=COALESCE(v_match.matchmaking_started_at,clock_timestamp()) + interval '20 seconds',
      version=version+1, updated_at=clock_timestamp()
  WHERE id=p_match_id;
  RETURN jsonb_build_object('assigned',true,'bot_profile_id',v_bot.id);
END;
$$;
REVOKE ALL ON FUNCTION public.dama_fill_waiting_with_bot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dama_fill_waiting_with_bot(uuid) TO service_role;

NOTIFY pgrst,'reload schema';
