-- Dama has a fixed Fun 1v1 stake; keep its ledger separate because the
-- Domino ledger deliberately constrains mode to 1v1/2v2.
ALTER TABLE public.dama_matches
  ADD COLUMN IF NOT EXISTS settlement jsonb,
  ADD COLUMN IF NOT EXISTS settlement_at timestamptz;
ALTER TABLE public.dama_match_players
  ADD COLUMN IF NOT EXISTS consecutive_timeout_strikes integer NOT NULL DEFAULT 0
    CHECK (consecutive_timeout_strikes >= 0);
ALTER TABLE public.dama_match_moves DROP CONSTRAINT IF EXISTS dama_match_moves_action_check;
ALTER TABLE public.dama_match_moves ADD CONSTRAINT dama_match_moves_action_check
  CHECK (action IN ('move','timeout-move','bot-move','manual-leave','disconnect-takeover','restore-control'));
ALTER TABLE public.dama_matches DROP CONSTRAINT IF EXISTS dama_matches_finish_reason_check;
ALTER TABLE public.dama_matches ADD CONSTRAINT dama_matches_finish_reason_check
  CHECK (finish_reason IS NULL OR finish_reason IN ('no-pieces','no-moves','one-vs-one','repetition','quiet-limit','manual-leave','timeout','both-bot-takeover'));

CREATE TABLE public.dama_match_economy (
  match_id uuid PRIMARY KEY REFERENCES public.dama_matches(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'coin' CHECK (currency = 'coin'),
  entry_fee integer NOT NULL DEFAULT 500 CHECK (entry_fee = 500),
  total_entry integer NOT NULL DEFAULT 1000 CHECK (total_entry = 1000),
  commission integer NOT NULL DEFAULT 0 CHECK (commission = 0),
  charged_at timestamptz,
  settled_at timestamptz,
  settlement jsonb
);
CREATE TABLE public.dama_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.dama_matches(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  amount integer NOT NULL CHECK (amount <> 0),
  reason text NOT NULL CHECK (reason IN ('entry_fee','prize','refund')),
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (match_id,user_id,reason)
);
ALTER TABLE public.dama_match_economy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dama_wallet_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dama_match_economy, public.dama_wallet_ledger FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.dama_match_economy TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.dama_match_economy,public.dama_wallet_ledger TO service_role;
CREATE POLICY dama_economy_member_read ON public.dama_match_economy FOR SELECT TO authenticated
  USING (public.is_dama_match_member(match_id,(SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.dama_charge_entry_fee(p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_economy public.dama_match_economy%ROWTYPE; v_player record; v_before numeric; v_after numeric;
BEGIN
  INSERT INTO public.dama_match_economy(match_id) VALUES(p_match_id) ON CONFLICT(match_id) DO NOTHING;
  SELECT * INTO STRICT v_economy FROM public.dama_match_economy WHERE match_id=p_match_id FOR UPDATE;
  IF v_economy.charged_at IS NOT NULL THEN RETURN jsonb_build_object('charged',false,'reason','already_charged'); END IF;
  IF (SELECT count(*) FROM public.dama_match_players WHERE match_id=p_match_id AND left_at IS NULL AND user_id IS NOT NULL) <> 2
     OR (SELECT count(DISTINCT user_id) FROM public.dama_match_players WHERE match_id=p_match_id AND left_at IS NULL AND user_id IS NOT NULL) <> 2
  THEN RAISE EXCEPTION 'dama_requires_two_unique_players'; END IF;
  FOR v_player IN SELECT user_id FROM public.dama_match_players WHERE match_id=p_match_id AND left_at IS NULL ORDER BY user_id LOOP
    SELECT coin INTO v_before FROM public.wallets WHERE user_id=v_player.user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_initialized'; END IF;
    IF v_before < 500 THEN RAISE EXCEPTION 'insufficient_entry_balance'; END IF;
    UPDATE public.wallets SET coin=coin-500,updated_at=clock_timestamp() WHERE user_id=v_player.user_id RETURNING coin INTO v_after;
    INSERT INTO public.dama_wallet_ledger(match_id,user_id,amount,reason,idempotency_key,metadata)
    VALUES(p_match_id,v_player.user_id,-500,'entry_fee','dama:'||p_match_id||':entry:'||v_player.user_id,
      jsonb_build_object('balanceBefore',v_before,'balanceAfter',v_after,'entryFee',500));
  END LOOP;
  UPDATE public.dama_match_economy SET charged_at=clock_timestamp() WHERE match_id=p_match_id;
  RETURN jsonb_build_object('charged',true,'entryFeePerPlayer',500,'totalEntry',1000,'commission',0);
END;
$$;

CREATE OR REPLACE FUNCTION public.dama_start_match(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_players integer; v_cream_user uuid; v_now_ms bigint:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint; v_pieces jsonb; v_state jsonb;
BEGIN
  PERFORM 1 FROM public.dama_matches WHERE id=p_match_id AND status='waiting' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public.dama_charge_entry_fee(p_match_id);
  SELECT count(*) INTO v_players FROM public.dama_match_players WHERE match_id=p_match_id AND left_at IS NULL AND user_id IS NOT NULL;
  SELECT user_id INTO v_cream_user FROM public.dama_match_players WHERE match_id=p_match_id AND piece_color='cream' AND left_at IS NULL;
  IF v_players<>2 THEN RAISE EXCEPTION 'dama_requires_two_players'; END IF;
  SELECT jsonb_agg(jsonb_build_object('id',color||'-'||row_no||'-'||col_no,'color',color,'row',row_no,'column',col_no,'king',false) ORDER BY color,row_no,col_no)
    INTO v_pieces FROM (SELECT 'black'::text color,r row_no,c col_no FROM generate_series(1,2) r CROSS JOIN generate_series(0,7) c
      UNION ALL SELECT 'cream'::text,r,c FROM generate_series(5,6) r CROSS JOIN generate_series(0,7) c) s;
  v_state:=jsonb_build_object('pieces',v_pieces,'turn','cream','ply',0,'result',NULL,'quietPly',0,'history','{}'::jsonb,
    'timeoutStrikes',jsonb_build_object('cream',0,'black',0),'turnStartedAtMs',v_now_ms,'turnDeadlineAtMs',v_now_ms+15000);
  UPDATE public.dama_matches SET status='active',state=v_state,current_turn_user_id=v_cream_user,version=version+1,updated_at=clock_timestamp()
    WHERE id=p_match_id AND status='waiting';
END;
$$;

CREATE OR REPLACE FUNCTION public.dama_settle_match(p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_match public.dama_matches%ROWTYPE; v_economy public.dama_match_economy%ROWTYPE; v_winner uuid; v_before numeric; v_after numeric; v_result jsonb;
BEGIN
  SELECT * INTO STRICT v_match FROM public.dama_matches WHERE id=p_match_id FOR UPDATE;
  SELECT * INTO STRICT v_economy FROM public.dama_match_economy WHERE match_id=p_match_id FOR UPDATE;
  IF v_economy.settled_at IS NOT NULL THEN RETURN v_economy.settlement; END IF;
  IF v_match.status<>'finished' THEN RAISE EXCEPTION 'dama_match_not_finished'; END IF;
  IF v_economy.charged_at IS NULL THEN RAISE EXCEPTION 'dama_entry_not_charged'; END IF;
  v_winner:=v_match.winner_user_id;
  IF v_winner IS NULL THEN
    v_result:=jsonb_build_object('type','no_winner','currency','coin','entryFeePerPlayer',500,'totalEntry',1000,'commission',0,'payout',0,'refund',0,'reason',v_match.finish_reason);
  ELSE
    SELECT coin INTO v_before FROM public.wallets WHERE user_id=v_winner FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_initialized'; END IF;
    UPDATE public.wallets SET coin=coin+1000,updated_at=clock_timestamp() WHERE user_id=v_winner RETURNING coin INTO v_after;
    INSERT INTO public.dama_wallet_ledger(match_id,user_id,amount,reason,idempotency_key,metadata)
      VALUES(p_match_id,v_winner,1000,'prize','dama:'||p_match_id||':prize:'||v_winner,jsonb_build_object('balanceBefore',v_before,'balanceAfter',v_after,'payout',1000));
    v_result:=jsonb_build_object('type','winner','currency','coin','winnerUserId',v_winner,'entryFeePerPlayer',500,'totalEntry',1000,'commission',0,'payout',1000,'netCoinDelta',500);
  END IF;
  UPDATE public.dama_match_economy SET settled_at=clock_timestamp(),settlement=v_result WHERE match_id=p_match_id;
  UPDATE public.dama_matches SET settlement=v_result,settlement_at=clock_timestamp() WHERE id=p_match_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION multiplayer_private.record_dama_final_stats(p_match_id uuid,p_manual_leaver uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_match public.dama_matches%ROWTYPE; v_results jsonb;
BEGIN
  SELECT * INTO v_match FROM public.dama_matches WHERE id=p_match_id;
  IF NOT FOUND OR v_match.status<>'finished' THEN RETURN; END IF;
  IF v_match.winner_user_id IS NULL AND v_match.finish_reason<>'both-bot-takeover' AND p_manual_leaver IS NULL THEN RETURN; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id',p.user_id,'team_id',CASE WHEN p.piece_color='cream' THEN 'teamA' ELSE 'teamB' END,
    'outcome',CASE WHEN p.user_id=v_match.winner_user_id THEN 'win' ELSE 'loss' END,
    'reason',CASE WHEN p.user_id=p_manual_leaver THEN 'manual_leave' ELSE 'match_finished' END)), '[]'::jsonb)
    INTO v_results FROM public.dama_match_players p WHERE p.match_id=p_match_id AND p.user_id IS NOT NULL AND p.left_at IS NULL;
  PERFORM multiplayer_private.record_player_results('dama',p_match_id,v_match.version,
    CASE WHEN p_manual_leaver IS NULL THEN NULL ELSE 'manual_leave' END,v_results);
END;
$$;

CREATE OR REPLACE FUNCTION public.dama_restore_control(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_color text; v_now_ms bigint:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint; v_version bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.dama_matches WHERE id=p_match_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_match_not_active'; END IF;
  UPDATE public.dama_match_players SET bot_takeover=false,manual_left=false,connected=true,last_seen_at=clock_timestamp(),consecutive_timeout_strikes=0
    WHERE match_id=p_match_id AND user_id=auth.uid() AND left_at IS NULL RETURNING piece_color INTO v_color;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_membership_required' USING ERRCODE='42501'; END IF;
  UPDATE public.dama_matches SET state=CASE WHEN state->>'turn'=v_color
      THEN jsonb_set(jsonb_set(jsonb_set(state,ARRAY['timeoutStrikes',v_color],'0'::jsonb,true),'{turnStartedAtMs}',to_jsonb(v_now_ms),true),'{turnDeadlineAtMs}',to_jsonb(v_now_ms+15000),true)
      ELSE jsonb_set(state,ARRAY['timeoutStrikes',v_color],'0'::jsonb,true) END,
    version=version+1,updated_at=clock_timestamp() WHERE id=p_match_id RETURNING version INTO v_version;
  INSERT INTO public.dama_match_moves(match_id,version,user_id,action,payload)
    VALUES(p_match_id,v_version,auth.uid(),'restore-control',jsonb_build_object('piece_color',v_color));
END;
$$;

CREATE OR REPLACE FUNCTION multiplayer_private.record_dama_final_stats(p_match_id uuid,p_manual_leaver uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_match public.dama_matches%ROWTYPE; v_results jsonb;
BEGIN
  SELECT * INTO v_match FROM public.dama_matches WHERE id=p_match_id;
  IF NOT FOUND OR (p_manual_leaver IS NULL AND v_match.status<>'finished') THEN RETURN; END IF;
  IF p_manual_leaver IS NULL AND v_match.winner_user_id IS NULL AND v_match.finish_reason<>'both-bot-takeover' THEN RETURN; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id',p.user_id,'team_id',CASE WHEN p.piece_color='cream' THEN 'teamA' ELSE 'teamB' END,
    'outcome',CASE WHEN p.user_id=v_match.winner_user_id THEN 'win' ELSE 'loss' END,
    'reason',CASE WHEN p.user_id=p_manual_leaver THEN 'manual_leave' ELSE 'match_finished' END)), '[]'::jsonb)
    INTO v_results FROM public.dama_match_players p WHERE p.match_id=p_match_id AND p.user_id IS NOT NULL
    AND ((p_manual_leaver IS NOT NULL AND p.user_id=p_manual_leaver) OR (p_manual_leaver IS NULL AND p.left_at IS NULL));
  PERFORM multiplayer_private.record_player_results('dama',p_match_id,v_match.version,
    CASE WHEN p_manual_leaver IS NULL THEN NULL ELSE 'manual_leave' END,v_results);
END;
$$;

CREATE OR REPLACE FUNCTION public.dama_claim_bot_takeover(p_match_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.dama_match_players WHERE match_id=p_match_id AND user_id=auth.uid() AND left_at IS NULL)
  THEN RAISE EXCEPTION 'dama_membership_required' USING ERRCODE='42501'; END IF;
  -- Disconnect alone no longer hands a seat to a bot. Two server timeouts do.
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.dama_cancel_and_refund(p_match_id uuid,p_reason text DEFAULT 'match_start_failed')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_match public.dama_matches%ROWTYPE; v_econ public.dama_match_economy%ROWTYPE; v_entry record; v_before numeric; v_after numeric; v_refunded integer:=0; v_result jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT v_match FROM public.dama_matches WHERE id=p_match_id FOR UPDATE;
  IF v_match.status='cancelled' THEN
    SELECT * INTO v_econ FROM public.dama_match_economy WHERE match_id=p_match_id;
    RETURN COALESCE(v_econ.settlement,jsonb_build_object('type','refund','refundedPlayers',0,'totalRefund',0));
  END IF;
  IF v_match.status NOT IN ('waiting','active') OR EXISTS(SELECT 1 FROM public.dama_match_moves WHERE match_id=p_match_id)
  THEN RAISE EXCEPTION 'dama_match_not_refundable'; END IF;
  INSERT INTO public.dama_match_economy(match_id) VALUES(p_match_id) ON CONFLICT(match_id) DO NOTHING;
  SELECT * INTO STRICT v_econ FROM public.dama_match_economy WHERE match_id=p_match_id FOR UPDATE;
  FOR v_entry IN SELECT * FROM public.dama_wallet_ledger WHERE match_id=p_match_id AND reason='entry_fee' ORDER BY user_id LOOP
    IF EXISTS(SELECT 1 FROM public.dama_wallet_ledger WHERE match_id=p_match_id AND user_id=v_entry.user_id AND reason='refund') THEN CONTINUE; END IF;
    SELECT coin INTO v_before FROM public.wallets WHERE user_id=v_entry.user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_initialized'; END IF;
    UPDATE public.wallets SET coin=coin+500,updated_at=clock_timestamp() WHERE user_id=v_entry.user_id RETURNING coin INTO v_after;
    INSERT INTO public.dama_wallet_ledger(match_id,user_id,amount,reason,idempotency_key,metadata)
      VALUES(p_match_id,v_entry.user_id,500,'refund','dama:'||p_match_id||':refund:'||v_entry.user_id,
        jsonb_build_object('balanceBefore',v_before,'balanceAfter',v_after,'reason',p_reason));
    v_refunded:=v_refunded+1;
  END LOOP;
  v_result:=jsonb_build_object('type','refund','currency','coin','entryFeePerPlayer',500,'refundedPlayers',v_refunded,'totalRefund',v_refunded*500,'reason',p_reason);
  UPDATE public.dama_match_economy SET settled_at=clock_timestamp(),settlement=v_result WHERE match_id=p_match_id;
  UPDATE public.dama_matches SET status='cancelled',current_turn_user_id=NULL,settlement=v_result,settlement_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=p_match_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.dama_leave_match(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_status text; v_bots integer; v_version bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  SELECT status INTO v_status FROM public.dama_matches WHERE id=p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_match_not_found'; END IF;
  PERFORM 1 FROM public.dama_match_players WHERE match_id=p_match_id AND user_id=v_uid AND left_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_membership_required' USING ERRCODE='42501'; END IF;
  IF v_status='waiting' THEN
    UPDATE public.dama_match_players SET bot_takeover=true,connected=false,left_at=clock_timestamp() WHERE match_id=p_match_id AND user_id=v_uid;
    UPDATE public.dama_matches SET status='cancelled',version=version+1,updated_at=clock_timestamp() WHERE id=p_match_id AND status='waiting';
  ELSIF v_status='active' THEN
    UPDATE public.dama_match_players SET bot_takeover=true,manual_left=true,connected=false WHERE match_id=p_match_id AND user_id=v_uid;
    SELECT count(*) INTO v_bots FROM public.dama_match_players WHERE match_id=p_match_id AND bot_takeover AND left_at IS NULL;
    IF v_bots=2 THEN
      UPDATE public.dama_matches SET status='finished',current_turn_user_id=NULL,winner_user_id=NULL,finish_reason='both-bot-takeover',
        state=jsonb_set(jsonb_set(COALESCE(state,'{}'::jsonb),'{result}',jsonb_build_object('winner',NULL,'reason','both-bot-takeover'),true),'{turnDeadlineAtMs}','null'::jsonb,true),
        version=version+1,updated_at=clock_timestamp() WHERE id=p_match_id AND status='active' RETURNING version INTO v_version;
      INSERT INTO public.dama_match_moves(match_id,version,user_id,action,payload) VALUES(p_match_id,v_version,v_uid,'manual-leave',jsonb_build_object('bot_takeover',true));
      PERFORM public.dama_settle_match(p_match_id);
      PERFORM multiplayer_private.record_dama_final_stats(p_match_id);
    ELSE
      UPDATE public.dama_matches SET version=version+1,updated_at=clock_timestamp() WHERE id=p_match_id AND status='active' RETURNING version INTO v_version;
      INSERT INTO public.dama_match_moves(match_id,version,user_id,action,payload) VALUES(p_match_id,v_version,v_uid,'manual-leave',jsonb_build_object('bot_takeover',true));
      PERFORM multiplayer_private.record_dama_final_stats(p_match_id,v_uid);
    END IF;
  ELSE RAISE EXCEPTION 'dama_match_not_active'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dama_match_snapshot(p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_match public.dama_matches%ROWTYPE; v_players jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.dama_match_players WHERE match_id=p_match_id AND user_id=v_uid AND left_at IS NULL)
  THEN RAISE EXCEPTION 'dama_membership_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT v_match FROM public.dama_matches WHERE id=p_match_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.user_id,'userId',p.user_id,'playerIndex',p.player_index,
    'pieceColor',p.piece_color,'connected',p.connected AND p.last_seen_at>clock_timestamp()-interval '45 seconds','lastSeenAt',p.last_seen_at,'botTakeover',p.bot_takeover,
    'consecutiveTimeoutStrikes',p.consecutive_timeout_strikes,'username',COALESCE(pr.username,'Player'),'avatarId',pr.avatar_id,'avatarUrl',pr.avatar_url)
    ORDER BY p.player_index),'[]'::jsonb) INTO v_players FROM public.dama_match_players p LEFT JOIN public.profiles pr ON pr.id=p.user_id
    WHERE p.match_id=p_match_id AND p.left_at IS NULL;
  RETURN jsonb_build_object('id',v_match.id,'status',v_match.status,'version',v_match.version,'state',v_match.state,
    'current_turn_user_id',v_match.current_turn_user_id,'winner_user_id',v_match.winner_user_id,'finish_reason',v_match.finish_reason,
    'settlement',v_match.settlement,'players',v_players);
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_dama_action(
  p_match_id uuid,p_expected_version bigint,p_actor_user_id uuid,p_state jsonb,p_current_turn_user_id uuid,p_action text,p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_match public.dama_matches%ROWTYPE; v_state jsonb:=p_state; v_status text; v_bots integer; v_player public.dama_match_players%ROWTYPE; v_settlement jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_match FROM public.dama_matches WHERE id=p_match_id FOR UPDATE;
  IF NOT FOUND OR v_match.status<>'active' OR v_match.version<>p_expected_version THEN RAISE EXCEPTION 'STALE_DAMA_STATE' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_player FROM public.dama_match_players WHERE match_id=p_match_id AND user_id=p_actor_user_id AND left_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dama_actor_not_member' USING ERRCODE='42501'; END IF;
  IF p_action='timeout-move' THEN
    UPDATE public.dama_match_players SET consecutive_timeout_strikes=consecutive_timeout_strikes+1,
      bot_takeover=(consecutive_timeout_strikes+1>=2),connected=CASE WHEN consecutive_timeout_strikes+1>=2 THEN false ELSE connected END
      WHERE id=v_player.id RETURNING * INTO v_player;
    v_state:=jsonb_set(v_state,ARRAY['timeoutStrikes',v_player.piece_color],to_jsonb(v_player.consecutive_timeout_strikes),true);
  ELSIF p_action='move' AND NOT v_player.bot_takeover THEN
    UPDATE public.dama_match_players SET consecutive_timeout_strikes=0 WHERE id=v_player.id;
    v_state:=jsonb_set(v_state,ARRAY['timeoutStrikes',v_player.piece_color],'0'::jsonb,true);
  END IF;
  SELECT count(*) INTO v_bots FROM public.dama_match_players WHERE match_id=p_match_id AND bot_takeover AND left_at IS NULL;
  IF v_bots=2 AND v_state->'result'='null'::jsonb THEN
    v_state:=jsonb_set(v_state,'{result}',jsonb_build_object('winner',NULL,'reason','both-bot-takeover'),true);
    v_state:=jsonb_set(v_state,'{turnDeadlineAtMs}', 'null'::jsonb,true);
  END IF;
  v_status:=CASE WHEN v_state->'result' IS NOT NULL AND v_state->'result'<>'null'::jsonb THEN 'finished' ELSE 'active' END;
  UPDATE public.dama_matches SET state=v_state,current_turn_user_id=CASE WHEN v_status='finished' THEN NULL ELSE p_current_turn_user_id END,
    status=v_status,winner_user_id=CASE WHEN v_state->'result'->>'winner' IS NULL THEN NULL ELSE
      (SELECT user_id FROM public.dama_match_players WHERE match_id=p_match_id AND piece_color=v_state->'result'->>'winner' AND left_at IS NULL) END,
    finish_reason=v_state->'result'->>'reason',version=version+1,updated_at=clock_timestamp() WHERE id=p_match_id RETURNING * INTO v_match;
  INSERT INTO public.dama_match_moves(match_id,version,user_id,action,payload) VALUES(p_match_id,v_match.version,p_actor_user_id,p_action,COALESCE(p_payload,'{}'::jsonb));
  IF v_status='finished' THEN
    v_settlement:=public.dama_settle_match(p_match_id);
    PERFORM multiplayer_private.record_dama_final_stats(p_match_id);
  END IF;
  RETURN jsonb_build_object('id',v_match.id,'status',v_match.status,'version',v_match.version,'state',v_match.state,
    'current_turn_user_id',v_match.current_turn_user_id,'winner_user_id',v_match.winner_user_id,'finish_reason',v_match.finish_reason,'settlement',v_settlement);
END;
$$;

REVOKE ALL ON FUNCTION public.dama_charge_entry_fee(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dama_settle_match(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.commit_dama_action(uuid,bigint,uuid,jsonb,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dama_charge_entry_fee(uuid),public.dama_settle_match(uuid),public.commit_dama_action(uuid,bigint,uuid,jsonb,uuid,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.dama_cancel_and_refund(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dama_cancel_and_refund(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dama_claim_bot_takeover(uuid),public.dama_leave_match(uuid),public.dama_restore_control(uuid),public.get_dama_match_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_start_match(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
