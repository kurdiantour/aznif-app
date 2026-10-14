CREATE OR REPLACE FUNCTION public.commit_dama_action(
  p_match_id uuid,
  p_expected_version bigint,
  p_state jsonb,
  p_current_turn_user_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_match public.dama_matches%ROWTYPE; v_player public.dama_match_players%ROWTYPE; v_status text; v_settlement jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('dama-match-'||p_match_id::text, 0));
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_match FROM public.dama_matches WHERE id=p_match_id FOR UPDATE;
  IF NOT FOUND OR v_match.status<>'active' OR v_match.version<>p_expected_version THEN 
    RETURN jsonb_build_object('already_transitioned',true,'current_version',v_match.version);
  END IF;
  SELECT * INTO v_player FROM public.dama_match_players WHERE match_id=p_match_id AND user_id=auth.uid() AND left_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_player.piece_color<>v_match.state->>'turn' THEN RAISE EXCEPTION 'dama_actor_not_member' USING ERRCODE='42501'; END IF;
  v_status:=CASE WHEN p_state->'result' IS NOT NULL AND p_state->'result'<>'null'::jsonb THEN 'finished' ELSE 'active' END;
  UPDATE public.dama_matches SET state=p_state,current_turn_user_id=p_current_turn_user_id,status=v_status,
    winner_user_id=CASE WHEN p_state->'result'->>'winner' IS NULL THEN NULL ELSE (SELECT user_id FROM public.dama_match_players WHERE match_id=p_match_id AND piece_color=p_state->'result'->>'winner' AND left_at IS NULL) END,
    finish_reason=p_state->'result'->>'reason',version=version+1,updated_at=clock_timestamp() WHERE id=p_match_id RETURNING * INTO v_match;
  INSERT INTO public.dama_match_moves(match_id,version,user_id,action,payload) VALUES(p_match_id,v_match.version,auth.uid(),'move',COALESCE(p_payload,'{}'::jsonb));
  IF v_status='finished' THEN v_settlement:=public.dama_settle_match(p_match_id); PERFORM multiplayer_private.record_dama_final_stats(p_match_id); END IF;
  RETURN jsonb_build_object('id',v_match.id,'status',v_match.status,'version',v_match.version,'state',v_match.state,'current_turn_user_id',v_match.current_turn_user_id,'winner_user_id',v_match.winner_user_id,'finish_reason',v_match.finish_reason,'settlement',v_settlement);
END;
$$;

NOTIFY pgrst,'reload schema';