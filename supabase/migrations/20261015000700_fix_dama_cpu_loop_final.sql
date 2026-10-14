-- FINAL FIX - Fixes CPU flood from STALE_DAMA_STATE loop
-- This overwrites all the conflicting countdown migrations you have in the screenshot

-- 1. Fix countdown: must be 5 seconds in future, not now()
CREATE OR REPLACE FUNCTION public.dama_fill_waiting_with_bot(p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_match public.dama_matches%ROWTYPE; v_human public.dama_match_players%ROWTYPE; v_bot public.dama_bot_profiles%ROWTYPE; v_index smallint;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dama-matchmaking', 0));
  SELECT * INTO v_match FROM public.dama_matches WHERE id=p_match_id FOR UPDATE;
  IF NOT FOUND OR v_match.status<>'waiting' OR v_match.matchmaking_deadline_at IS NULL
    OR v_match.matchmaking_deadline_at>clock_timestamp() OR NOT public.dama_bot_matchmaking_enabled() THEN
    RETURN jsonb_build_object('assigned',false,'reason','not_due_or_disabled');
  END IF;
  SELECT * INTO v_human FROM public.dama_match_players WHERE match_id=p_match_id AND left_at IS NULL AND user_id IS NOT NULL FOR UPDATE;
  IF NOT FOUND OR (SELECT count(*) FROM public.dama_match_players WHERE match_id=p_match_id AND left_at IS NULL)<>1 THEN
    UPDATE public.dama_matches SET matchmaking_deadline_at=NULL WHERE id=p_match_id;
    RETURN jsonb_build_object('assigned',false,'reason','seat_changed');
  END IF;
  SELECT * INTO v_bot FROM public.dama_bot_profiles WHERE active AND coin_balance>=500
    ORDER BY random() LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    UPDATE public.dama_matches SET matchmaking_deadline_at=clock_timestamp()+interval '10 seconds' WHERE id=p_match_id;
    RETURN jsonb_build_object('assigned',false,'reason','bot_pool_empty');
  END IF;
  SELECT COALESCE(max(player_index),-1)+1 INTO v_index FROM public.dama_match_players WHERE match_id=p_match_id;
  INSERT INTO public.dama_match_players(match_id,bot_profile_id,player_index,piece_color)
    VALUES(p_match_id,v_bot.id,v_index,CASE WHEN v_index=0 THEN 'cream' ELSE 'black' END);
  UPDATE public.dama_matches SET matchmaking_deadline_at=NULL,
    matchmaking_started_at=NULL,
    countdown_deadline_at=clock_timestamp()+interval '5 seconds',version=version+1,updated_at=clock_timestamp()
    WHERE id=p_match_id;
  RETURN jsonb_build_object('assigned',true,'bot_profile_id',v_bot.id);
END;
$$;
REVOKE ALL ON FUNCTION public.dama_fill_waiting_with_bot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dama_fill_waiting_with_bot(uuid) TO service_role;

-- 2. Fix commit_dama_bot_action: Don't throw STALE as error, return gracefully to stop CPU flood
CREATE OR REPLACE FUNCTION public.commit_dama_bot_action(
  p_match_id uuid,p_expected_version bigint,p_bot_profile_id uuid,p_state jsonb,p_current_turn_user_id uuid,p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_match public.dama_matches%ROWTYPE; v_player public.dama_match_players%ROWTYPE; v_status text; v_settlement jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('dama-match-'||p_match_id::text, 0));
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_match FROM public.dama_matches WHERE id=p_match_id FOR UPDATE;
  IF NOT FOUND OR v_match.status<>'active' OR v_match.version<>p_expected_version THEN 
    RETURN jsonb_build_object('already_transitioned',true,'current_version',v_match.version);
  END IF;
  SELECT * INTO v_player FROM public.dama_match_players WHERE match_id=p_match_id AND bot_profile_id=p_bot_profile_id AND left_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_player.piece_color<>v_match.state->>'turn' THEN 
    RETURN jsonb_build_object('already_transitioned',true);
  END IF;
  v_status:=CASE WHEN p_state->'result' IS NOT NULL AND p_state->'result'<>'null'::jsonb THEN 'finished' ELSE 'active' END;
  UPDATE public.dama_matches SET state=p_state,current_turn_user_id=p_current_turn_user_id,status=v_status,
    winner_user_id=CASE WHEN p_state->'result'->>'winner' IS NULL THEN NULL ELSE (SELECT user_id FROM public.dama_match_players WHERE match_id=p_match_id AND piece_color=p_state->'result'->>'winner' AND left_at IS NULL) END,
    finish_reason=p_state->'result'->>'reason',version=version+1,updated_at=clock_timestamp() WHERE id=p_match_id RETURNING * INTO v_match;
  INSERT INTO public.dama_match_moves(match_id,version,user_id,action,payload) VALUES(p_match_id,v_match.version,NULL,'bot-move',COALESCE(p_payload,'{}'::jsonb)||jsonb_build_object('bot_profile_id',p_bot_profile_id));
  IF v_status='finished' THEN v_settlement:=public.dama_settle_match(p_match_id); PERFORM multiplayer_private.record_dama_final_stats(p_match_id); END IF;
  RETURN jsonb_build_object('id',v_match.id,'status',v_match.status,'version',v_match.version,'state',v_match.state,'current_turn_user_id',v_match.current_turn_user_id,'winner_user_id',v_match.winner_user_id,'finish_reason',v_match.finish_reason,'settlement',v_settlement);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_dama_bot_action(uuid,bigint,uuid,jsonb,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_dama_bot_action(uuid,bigint,uuid,jsonb,uuid,jsonb) TO service_role;

-- 3. Cleanup old stuck waiting matches (safe, only older than 10 min)
UPDATE public.dama_matches SET status='finished', finish_reason='cleanup_after_fix'
WHERE status='waiting' AND created_at < now() - interval '10 minutes';

NOTIFY pgrst,'reload schema';

