-- A temporary timeout takeover is not a forfeit. Keep the match active while
-- either human may return; finish only when the rules engine has a result or a
-- player explicitly leaves through dama_leave_match.
CREATE OR REPLACE FUNCTION public.commit_dama_action(
  p_match_id uuid,
  p_expected_version bigint,
  p_actor_user_id uuid,
  p_state jsonb,
  p_current_turn_user_id uuid,
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match public.dama_matches%ROWTYPE;
  v_state jsonb := p_state;
  v_status text;
  v_player public.dama_match_players%ROWTYPE;
  v_settlement jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_match FROM public.dama_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND OR v_match.status <> 'active' OR v_match.version <> p_expected_version THEN
    RAISE EXCEPTION 'STALE_DAMA_STATE' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_player FROM public.dama_match_players
  WHERE match_id = p_match_id AND user_id = p_actor_user_id AND left_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_actor_not_member' USING ERRCODE = '42501'; END IF;

  IF p_action = 'timeout-move' THEN
    UPDATE public.dama_match_players
    SET consecutive_timeout_strikes = consecutive_timeout_strikes + 1,
        bot_takeover = (consecutive_timeout_strikes + 1 >= 2),
        connected = CASE WHEN consecutive_timeout_strikes + 1 >= 2 THEN false ELSE connected END
    WHERE id = v_player.id RETURNING * INTO v_player;
    v_state := jsonb_set(v_state, ARRAY['timeoutStrikes', v_player.piece_color],
      to_jsonb(v_player.consecutive_timeout_strikes), true);
  ELSIF p_action = 'move' AND NOT v_player.bot_takeover THEN
    UPDATE public.dama_match_players SET consecutive_timeout_strikes = 0 WHERE id = v_player.id;
    v_state := jsonb_set(v_state, ARRAY['timeoutStrikes', v_player.piece_color], '0'::jsonb, true);
  END IF;

  -- No timeout-only terminal result here. A legal timeout move advances play;
  -- no-legal-move and all other genuine game results still finish normally.
  v_status := CASE
    WHEN v_state->'result' IS NOT NULL AND v_state->'result' <> 'null'::jsonb THEN 'finished'
    ELSE 'active'
  END;

  UPDATE public.dama_matches
  SET state = v_state,
      current_turn_user_id = CASE WHEN v_status = 'finished' THEN NULL ELSE p_current_turn_user_id END,
      status = v_status,
      winner_user_id = CASE WHEN v_state->'result'->>'winner' IS NULL THEN NULL ELSE
        (SELECT user_id FROM public.dama_match_players
         WHERE match_id = p_match_id AND piece_color = v_state->'result'->>'winner' AND left_at IS NULL)
      END,
      finish_reason = v_state->'result'->>'reason',
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = p_match_id
  RETURNING * INTO v_match;

  INSERT INTO public.dama_match_moves(match_id, version, user_id, action, payload)
  VALUES (p_match_id, v_match.version, p_actor_user_id, p_action, COALESCE(p_payload, '{}'::jsonb));

  IF v_status = 'finished' THEN
    v_settlement := public.dama_settle_match(p_match_id);
    PERFORM multiplayer_private.record_dama_final_stats(p_match_id);
  END IF;

  RETURN jsonb_build_object(
    'id', v_match.id,
    'status', v_match.status,
    'version', v_match.version,
    'state', v_match.state,
    'current_turn_user_id', v_match.current_turn_user_id,
    'winner_user_id', v_match.winner_user_id,
    'finish_reason', v_match.finish_reason,
    'settlement', v_settlement
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_dama_action(uuid, bigint, uuid, jsonb, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_dama_action(uuid, bigint, uuid, jsonb, uuid, text, jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';
