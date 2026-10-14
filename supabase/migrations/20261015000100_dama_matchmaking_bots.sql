-- Dama matchmaking bots: database owned profiles, economy, feature switch,
-- and an atomic timeout path. Bots never masquerade as auth.users.
ALTER TABLE public.dama_matches
  ADD COLUMN IF NOT EXISTS matchmaking_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS matchmaking_started_at timestamptz;
ALTER TABLE public.dama_match_players
  ADD COLUMN IF NOT EXISTS bot_profile_id uuid;

CREATE TABLE public.dama_bot_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  matchmaking_enabled boolean NOT NULL DEFAULT false,
  wait_seconds integer NOT NULL DEFAULT 16 CHECK (wait_seconds = 16),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.dama_bot_settings(singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE public.dama_bot_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  avatar_url text,
  avatar_id text NOT NULL DEFAULT 'bot-avatar',
  active boolean NOT NULL DEFAULT true,
  coin_balance bigint NOT NULL DEFAULT 100000 CHECK (coin_balance >= 0),
  gem_balance bigint NOT NULL DEFAULT 0 CHECK (gem_balance >= 0),
  points integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.dama_bot_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.dama_matches(id) ON DELETE CASCADE,
  bot_profile_id uuid NOT NULL REFERENCES public.dama_bot_profiles(id),
  coin_delta bigint NOT NULL DEFAULT 0,
  gem_delta bigint NOT NULL DEFAULT 0,
  reason text NOT NULL CHECK (reason IN ('entry_fee','prize','refund')),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.dama_bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dama_bot_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dama_bot_wallet_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dama_bot_settings, public.dama_bot_profiles, public.dama_bot_wallet_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dama_bot_settings, public.dama_bot_profiles, public.dama_bot_wallet_ledger TO service_role;

-- Seed an initial Kurdish bot roster; avatar_url can be filled with public
-- Storage URLs by deployment tooling without changing application code.
INSERT INTO public.dama_bot_profiles(username, avatar_id) VALUES
 ('Aso','bot-avatar'),('Rojin','bot-avatar'),('Dilan','bot-avatar'),('Baran','bot-avatar'),('Shilan','bot-avatar'),
 ('Azad','bot-avatar'),('Narin','bot-avatar'),('Aram','bot-avatar'),('Berfin','bot-avatar'),('Helin','bot-avatar'),
 ('Kawa','bot-avatar'),('Jiyan','bot-avatar'),('Ronahi','bot-avatar'),('Soran','bot-avatar'),('Avin','bot-avatar'),
 ('Zana','bot-avatar'),('Lavin','bot-avatar'),('Chiya','bot-avatar'),('Bahar','bot-avatar'),('Renas','bot-avatar'),
 ('Nishtiman','bot-avatar'),('Hawar','bot-avatar'),('Dilovan','bot-avatar'),('Rabar','bot-avatar'),('Sipan','bot-avatar')
ON CONFLICT (username) DO NOTHING;

CREATE OR REPLACE FUNCTION public.dama_bot_matchmaking_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT matchmaking_enabled FROM public.dama_bot_settings WHERE singleton), false);
$$;
REVOKE ALL ON FUNCTION public.dama_bot_matchmaking_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dama_bot_matchmaking_enabled() TO service_role;

-- Keep one real player waiting, but give that seat a fixed server deadline.
CREATE OR REPLACE FUNCTION public.find_dama_match()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_match public.dama_matches%ROWTYPE; v_index smallint; v_wait integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dama-matchmaking', 0));
  SELECT m.* INTO v_match FROM public.dama_matches m JOIN public.dama_match_players p ON p.match_id=m.id
    WHERE p.user_id=v_uid AND p.left_at IS NULL AND m.status IN ('waiting','active') ORDER BY m.created_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('status',v_match.status,'match_id',v_match.id); END IF;

  SELECT m.* INTO v_match FROM public.dama_matches m WHERE m.status='waiting'
    AND (SELECT count(*) FROM public.dama_match_players p WHERE p.match_id=m.id AND p.left_at IS NULL
      AND (p.user_id IS NOT NULL OR p.bot_profile_id IS NOT NULL))=1
    AND (m.matchmaking_deadline_at IS NULL OR m.matchmaking_deadline_at>clock_timestamp())
    AND NOT EXISTS(SELECT 1 FROM public.dama_match_players p WHERE p.match_id=m.id AND p.user_id=v_uid)
    ORDER BY m.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
    SELECT COALESCE(max(player_index),-1)+1 INTO v_index FROM public.dama_match_players WHERE match_id=v_match.id;
    INSERT INTO public.dama_match_players(match_id,user_id,player_index,piece_color)
      VALUES(v_match.id,v_uid,v_index,CASE WHEN v_index=0 THEN 'cream' ELSE 'black' END);
    UPDATE public.dama_matches SET matchmaking_deadline_at=NULL,matchmaking_started_at=NULL WHERE id=v_match.id;
    RETURN jsonb_build_object('status','matched','match_id',v_match.id);
  END IF;

  SELECT wait_seconds INTO v_wait FROM public.dama_bot_settings WHERE singleton;
  INSERT INTO public.dama_matches(status,matchmaking_started_at,matchmaking_deadline_at)
    VALUES('waiting',clock_timestamp(),CASE WHEN public.dama_bot_matchmaking_enabled()
      THEN clock_timestamp()+make_interval(secs=>COALESCE(v_wait,16)) ELSE NULL END)
    RETURNING * INTO v_match;
  INSERT INTO public.dama_match_players(match_id,user_id,player_index,piece_color) VALUES(v_match.id,v_uid,0,'cream');
  RETURN jsonb_build_object('status','searching','match_id',v_match.id,'matchmaking_started_at',v_match.matchmaking_started_at,
    'matchmaking_deadline_at',v_match.matchmaking_deadline_at);
END;
$$;

-- Invoked by the scheduled Dama lifecycle. Row locking plus version/status
-- checks make timeout assignment safe against a human joining at the same time.
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
    UPDATE public.dama_matches SET matchmaking_deadline_at=clock_timestamp()+interval '3 seconds' WHERE id=p_match_id;
    RETURN jsonb_build_object('assigned',false,'reason','bot_pool_empty');
  END IF;
  SELECT COALESCE(max(player_index),-1)+1 INTO v_index FROM public.dama_match_players WHERE match_id=p_match_id;
  INSERT INTO public.dama_match_players(match_id,bot_profile_id,player_index,piece_color)
    VALUES(p_match_id,v_bot.id,v_index,CASE WHEN v_index=0 THEN 'cream' ELSE 'black' END);
  UPDATE public.dama_matches SET matchmaking_deadline_at=NULL,
    matchmaking_started_at=NULL,
    countdown_deadline_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
    WHERE id=p_match_id;
  RETURN jsonb_build_object('assigned',true,'bot_profile_id',v_bot.id);
END;
$$;
REVOKE ALL ON FUNCTION public.dama_fill_waiting_with_bot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dama_fill_waiting_with_bot(uuid) TO service_role;

NOTIFY pgrst,'reload schema';

-- Allow a bot to occupy a seat without a fake auth user. The game still owns
-- exactly two seats; only human participants are charged/rewarded in wallets.
ALTER TABLE public.dama_match_players DROP CONSTRAINT IF EXISTS dama_match_players_identity_check;
ALTER TABLE public.dama_match_players ADD CONSTRAINT dama_match_players_identity_check
  CHECK ((user_id IS NOT NULL AND bot_profile_id IS NULL)
    OR (user_id IS NULL AND bot_profile_id IS NOT NULL)
    OR (user_id IS NULL AND bot_profile_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS dama_match_players_bot_identity_idx
  ON public.dama_match_players(match_id, bot_profile_id) WHERE bot_profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.dama_start_match_service(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_match public.dama_matches%ROWTYPE; v_seats integer; v_cream_user uuid; v_pieces jsonb; v_state jsonb;
  v_now_ms bigint:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
BEGIN
  SELECT * INTO v_match FROM public.dama_matches WHERE id=p_match_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF auth.role()<>'service_role' AND NOT EXISTS(SELECT 1 FROM public.dama_match_players
    WHERE match_id=p_match_id AND user_id=auth.uid() AND left_at IS NULL) THEN
    RAISE EXCEPTION 'dama_membership_required' USING ERRCODE='42501';
  END IF;
  IF v_match.status<>'waiting' OR v_match.countdown_deadline_at IS NULL
    OR v_match.countdown_deadline_at>clock_timestamp() THEN RAISE EXCEPTION 'countdown_not_complete'; END IF;
  SELECT count(*) INTO v_seats FROM public.dama_match_players WHERE match_id=p_match_id AND left_at IS NULL
    AND (user_id IS NOT NULL OR bot_profile_id IS NOT NULL);
  IF v_seats<>2 THEN RAISE EXCEPTION 'dama_requires_two_players'; END IF;
  PERFORM public.dama_charge_entry_fee(p_match_id);
  SELECT user_id INTO v_cream_user FROM public.dama_match_players WHERE match_id=p_match_id AND piece_color='cream' AND left_at IS NULL;
  SELECT jsonb_agg(jsonb_build_object('id',color||'-'||row_no||'-'||col_no,'color',color,'row',row_no,'column',col_no,'king',false) ORDER BY color,row_no,col_no)
    INTO v_pieces FROM (SELECT 'black'::text color,r row_no,c col_no FROM generate_series(1,2) r CROSS JOIN generate_series(0,7) c
      UNION ALL SELECT 'cream'::text,r,c FROM generate_series(5,6) r CROSS JOIN generate_series(0,7) c) s;
  v_state:=jsonb_build_object('pieces',v_pieces,'turn','cream','ply',0,'result',NULL,'quietPly',0,'history','{}'::jsonb,
    'timeoutStrikes',jsonb_build_object('cream',0,'black',0),'turnStartedAtMs',v_now_ms,'turnDeadlineAtMs',v_now_ms+15000);
  UPDATE public.dama_matches SET status='active',state=v_state,current_turn_user_id=v_cream_user,
    countdown_deadline_at=NULL,matchmaking_deadline_at=NULL,matchmaking_started_at=NULL,version=version+1,updated_at=clock_timestamp()
    WHERE id=p_match_id AND status='waiting';
END;
$$;
REVOKE ALL ON FUNCTION public.dama_start_match_service(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dama_start_match_service(uuid) TO service_role;

-- Charge real humans using the existing wallet ledger and the bot from its own
-- ledger. This replaces the earlier two-auth-users-only charge implementation.
CREATE OR REPLACE FUNCTION public.dama_charge_entry_fee(p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_econ public.dama_match_economy%ROWTYPE; v_player record; v_before numeric; v_after numeric; v_bot public.dama_bot_profiles%ROWTYPE;
BEGIN
  INSERT INTO public.dama_match_economy(match_id) VALUES(p_match_id) ON CONFLICT(match_id) DO NOTHING;
  SELECT * INTO STRICT v_econ FROM public.dama_match_economy WHERE match_id=p_match_id FOR UPDATE;
  IF v_econ.charged_at IS NOT NULL THEN RETURN jsonb_build_object('charged',false,'reason','already_charged'); END IF;
  IF (SELECT count(*) FROM public.dama_match_players WHERE match_id=p_match_id AND left_at IS NULL
    AND (user_id IS NOT NULL OR bot_profile_id IS NOT NULL))<>2 THEN RAISE EXCEPTION 'dama_requires_two_unique_players'; END IF;
  FOR v_player IN SELECT * FROM public.dama_match_players WHERE match_id=p_match_id AND left_at IS NULL ORDER BY player_index FOR UPDATE LOOP
    IF v_player.user_id IS NOT NULL THEN
      SELECT coin INTO v_before FROM public.wallets WHERE user_id=v_player.user_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_initialized'; END IF;
      IF v_before<500 THEN RAISE EXCEPTION 'insufficient_entry_balance'; END IF;
      UPDATE public.wallets SET coin=coin-500,updated_at=clock_timestamp() WHERE user_id=v_player.user_id RETURNING coin INTO v_after;
      INSERT INTO public.dama_wallet_ledger(match_id,user_id,amount,reason,idempotency_key,metadata)
        VALUES(p_match_id,v_player.user_id,-500,'entry_fee','dama:'||p_match_id||':entry:'||v_player.user_id,
          jsonb_build_object('balanceBefore',v_before,'balanceAfter',v_after,'entryFee',500));
    ELSE
      SELECT * INTO STRICT v_bot FROM public.dama_bot_profiles WHERE id=v_player.bot_profile_id FOR UPDATE;
      IF v_bot.coin_balance<500 THEN RAISE EXCEPTION 'bot_entry_balance_low'; END IF;
      UPDATE public.dama_bot_profiles SET coin_balance=coin_balance-500,updated_at=clock_timestamp()
        WHERE id=v_bot.id RETURNING * INTO v_bot;
      INSERT INTO public.dama_bot_wallet_ledger(match_id,bot_profile_id,coin_delta,reason,idempotency_key)
        VALUES(p_match_id,v_bot.id,-500,'entry_fee','dama:'||p_match_id||':bot-entry:'||v_bot.id);
    END IF;
  END LOOP;
  UPDATE public.dama_match_economy SET charged_at=clock_timestamp() WHERE match_id=p_match_id;
  RETURN jsonb_build_object('charged',true,'entryFeePerPlayer',500,'totalEntry',1000,'commission',0);
END;
$$;

-- Keep the authenticated start path for human matches; service starts bot
-- matches after the same persisted five second pre-game countdown.
CREATE OR REPLACE FUNCTION public.dama_start_match(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_match public.dama_matches%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.dama_match_players WHERE match_id=p_match_id AND user_id=v_uid AND left_at IS NULL)
  THEN RAISE EXCEPTION 'dama_membership_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_match FROM public.dama_matches WHERE id=p_match_id FOR UPDATE;
  IF NOT FOUND OR v_match.status<>'waiting' OR v_match.countdown_deadline_at IS NULL OR v_match.countdown_deadline_at>clock_timestamp()
  THEN RAISE EXCEPTION 'countdown_not_complete'; END IF;
  PERFORM public.dama_start_match_service(p_match_id);
END;
$$;

-- Secure bot action committer: no bot actor is accepted from a client.
CREATE OR REPLACE FUNCTION public.commit_dama_bot_action(
  p_match_id uuid,p_expected_version bigint,p_bot_profile_id uuid,p_state jsonb,p_current_turn_user_id uuid,p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_match public.dama_matches%ROWTYPE; v_player public.dama_match_players%ROWTYPE; v_status text; v_settlement jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_match FROM public.dama_matches WHERE id=p_match_id FOR UPDATE;
  IF NOT FOUND OR v_match.status<>'active' OR v_match.version<>p_expected_version THEN RAISE EXCEPTION 'STALE_DAMA_STATE' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_player FROM public.dama_match_players WHERE match_id=p_match_id AND bot_profile_id=p_bot_profile_id AND left_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_player.piece_color<>v_match.state->>'turn' THEN RAISE EXCEPTION 'dama_bot_actor_not_member' USING ERRCODE='42501'; END IF;
  v_status:=CASE WHEN p_state->'result' IS NOT NULL AND p_state->'result'<>'null'::jsonb THEN 'finished' ELSE 'active' END;
  UPDATE public.dama_matches SET state=p_state,current_turn_user_id=p_current_turn_user_id,status=v_status,
    winner_user_id=CASE WHEN p_state->'result'->>'winner' IS NULL THEN NULL ELSE
      (SELECT user_id FROM public.dama_match_players WHERE match_id=p_match_id AND piece_color=p_state->'result'->>'winner' AND left_at IS NULL) END,
    finish_reason=p_state->'result'->>'reason',version=version+1,updated_at=clock_timestamp()
    WHERE id=p_match_id RETURNING * INTO v_match;
  INSERT INTO public.dama_match_moves(match_id,version,user_id,action,payload)
    VALUES(p_match_id,v_match.version,NULL,'bot-move',COALESCE(p_payload,'{}'::jsonb)||jsonb_build_object('bot_profile_id',p_bot_profile_id));
  IF v_status='finished' THEN v_settlement:=public.dama_settle_match(p_match_id); PERFORM multiplayer_private.record_dama_final_stats(p_match_id); END IF;
  RETURN jsonb_build_object('id',v_match.id,'status',v_match.status,'version',v_match.version,'state',v_match.state,
    'current_turn_user_id',v_match.current_turn_user_id,'winner_user_id',v_match.winner_user_id,
    'finish_reason',v_match.finish_reason,'settlement',v_settlement);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_dama_bot_action(uuid,bigint,uuid,jsonb,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_dama_bot_action(uuid,bigint,uuid,jsonb,uuid,jsonb) TO service_role;

-- Bot seats are included in private snapshots by their database profile.
CREATE OR REPLACE FUNCTION public.get_dama_match_snapshot(p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_match public.dama_matches%ROWTYPE; v_players jsonb;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.dama_match_players WHERE match_id=p_match_id AND user_id=v_uid AND left_at IS NULL)
  THEN RAISE EXCEPTION 'dama_membership_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT v_match FROM public.dama_matches WHERE id=p_match_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',COALESCE(p.user_id,p.bot_profile_id),'userId',p.user_id,'botProfileId',p.bot_profile_id,
    'isBot',p.bot_profile_id IS NOT NULL,'playerIndex',p.player_index,'pieceColor',p.piece_color,
    'connected',CASE WHEN p.bot_profile_id IS NOT NULL THEN true ELSE p.connected AND p.last_seen_at>clock_timestamp()-interval '45 seconds' END,
    'lastSeenAt',p.last_seen_at,'botTakeover',p.bot_takeover,'consecutiveTimeoutStrikes',p.consecutive_timeout_strikes,
    'username',COALESCE(pr.username,bp.username,'Player'),'avatarId',COALESCE(pr.avatar_id,bp.avatar_id),'avatarUrl',COALESCE(pr.avatar_url,bp.avatar_url)) ORDER BY p.player_index),'[]'::jsonb)
    INTO v_players FROM public.dama_match_players p LEFT JOIN public.profiles pr ON pr.id=p.user_id
      LEFT JOIN public.dama_bot_profiles bp ON bp.id=p.bot_profile_id WHERE p.match_id=p_match_id AND p.left_at IS NULL;
  RETURN jsonb_build_object('id',v_match.id,'status',v_match.status,'version',v_match.version,'state',v_match.state,
    'current_turn_user_id',v_match.current_turn_user_id,'winner_user_id',v_match.winner_user_id,'finish_reason',v_match.finish_reason,
    'settlement',v_match.settlement,'countdown_ends_at',v_match.countdown_deadline_at,
    'matchmaking_started_at',v_match.matchmaking_started_at,'matchmaking_deadline_at',v_match.matchmaking_deadline_at,'players',v_players);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dama_match_snapshot_service(p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  RETURN (SELECT jsonb_build_object('id',m.id,'status',m.status,'version',m.version,'state',m.state,
    'current_turn_user_id',m.current_turn_user_id,'winner_user_id',m.winner_user_id,'finish_reason',m.finish_reason,
    'settlement',m.settlement,'countdown_ends_at',m.countdown_deadline_at,'matchmaking_started_at',m.matchmaking_started_at,
    'matchmaking_deadline_at',m.matchmaking_deadline_at,
    'players',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',COALESCE(p.user_id,p.bot_profile_id),'userId',p.user_id,'botProfileId',p.bot_profile_id,
      'isBot',p.bot_profile_id IS NOT NULL,'playerIndex',p.player_index,'pieceColor',p.piece_color,'connected',true,'botTakeover',p.bot_takeover,
      'consecutiveTimeoutStrikes',p.consecutive_timeout_strikes,'username',COALESCE(pr.username,bp.username,'Player'),
      'avatarId',COALESCE(pr.avatar_id,bp.avatar_id),'avatarUrl',COALESCE(pr.avatar_url,bp.avatar_url)) ORDER BY p.player_index),'[]'::jsonb)
      FROM public.dama_match_players p LEFT JOIN public.profiles pr ON pr.id=p.user_id LEFT JOIN public.dama_bot_profiles bp ON bp.id=p.bot_profile_id
      WHERE p.match_id=m.id AND p.left_at IS NULL)) FROM public.dama_matches m WHERE m.id=p_match_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_dama_match_snapshot_service(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_dama_match_snapshot_service(uuid) TO service_role;

NOTIFY pgrst,'reload schema';

-- Bot contributes its internal stake to the pot. The real winner receives the
-- usual 1000 Coin prize; a bot winner gets the amount recorded in bot ledger.
CREATE OR REPLACE FUNCTION public.dama_settle_match(p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_match public.dama_matches%ROWTYPE; v_econ public.dama_match_economy%ROWTYPE;
  v_bot_winner uuid; v_bot_loser uuid; v_real_winner uuid; v_before numeric; v_after numeric;
  v_result jsonb; v_player record; v_points integer; v_gems numeric(20,2);
BEGIN
  SELECT * INTO STRICT v_match FROM public.dama_matches WHERE id=p_match_id FOR UPDATE;
  SELECT * INTO STRICT v_econ FROM public.dama_match_economy WHERE match_id=p_match_id FOR UPDATE;
  IF v_econ.settled_at IS NOT NULL THEN RETURN v_econ.settlement; END IF;
  IF v_match.status<>'finished' OR v_econ.charged_at IS NULL THEN RAISE EXCEPTION 'dama_match_not_settleable'; END IF;
  SELECT user_id,bot_profile_id INTO v_real_winner,v_bot_winner FROM public.dama_match_players
    WHERE match_id=p_match_id AND piece_color=v_match.state->'result'->>'winner' AND left_at IS NULL;
  IF v_match.state->'result'->>'winner' IS NULL THEN
    v_result:=jsonb_build_object('type','no_winner','currency','coin','entryFeePerPlayer',500,'totalEntry',1000,'commission',0,
      'payout',0,'refund',0,'netCoinDelta',-500,'pointDelta',0,'gemDelta',0,'reason',v_match.finish_reason);
  ELSE
    IF v_bot_winner IS NOT NULL THEN
      UPDATE public.dama_bot_profiles SET coin_balance=coin_balance+1000,gem_balance=gem_balance+10,
        points=points+35,updated_at=clock_timestamp() WHERE id=v_bot_winner;
      INSERT INTO public.dama_bot_wallet_ledger(match_id,bot_profile_id,coin_delta,gem_delta,reason,idempotency_key)
        VALUES(p_match_id,v_bot_winner,1000,10,'prize','dama:'||p_match_id||':bot-prize:'||v_bot_winner);
    ELSE
      SELECT coin INTO v_before FROM public.wallets WHERE user_id=v_real_winner FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_initialized'; END IF;
      UPDATE public.wallets SET coin=coin+1000,updated_at=clock_timestamp() WHERE user_id=v_real_winner RETURNING coin INTO v_after;
      INSERT INTO public.dama_wallet_ledger(match_id,user_id,amount,reason,idempotency_key,metadata)
        VALUES(p_match_id,v_real_winner,1000,'prize','dama:'||p_match_id||':prize:'||v_real_winner,
          jsonb_build_object('balanceBefore',v_before,'balanceAfter',v_after,'payout',1000));
      SELECT bot_profile_id INTO v_bot_loser FROM public.dama_match_players
        WHERE match_id=p_match_id AND piece_color<>(v_match.state->'result'->>'winner') AND left_at IS NULL;
      IF v_bot_loser IS NOT NULL THEN
        UPDATE public.dama_bot_profiles SET points=GREATEST(0,points-15),updated_at=clock_timestamp() WHERE id=v_bot_loser;
      END IF;
    END IF;
    FOR v_player IN SELECT user_id,piece_color,bot_profile_id,bot_takeover,manual_left FROM public.dama_match_players
      WHERE match_id=p_match_id AND left_at IS NULL AND user_id IS NOT NULL ORDER BY user_id FOR UPDATE LOOP
      IF v_player.bot_takeover OR v_player.manual_left THEN v_points:=-25; v_gems:=0;
      ELSIF v_player.piece_color=(v_match.state->'result'->>'winner') AND v_bot_winner IS NULL THEN v_points:=35; v_gems:=10; ELSE v_points:=-15; v_gems:=0; END IF;
      INSERT INTO public.dama_fun_match_rewards(match_id,user_id,piece_color,point_delta,gem_delta)
        VALUES(p_match_id,v_player.user_id,v_player.piece_color,v_points,v_gems) ON CONFLICT(match_id,user_id) DO NOTHING;
      IF FOUND THEN
        UPDATE public.profiles SET points=GREATEST(0,COALESCE(points,0)+v_points),updated_at=clock_timestamp() WHERE id=v_player.user_id;
        IF v_gems>0 THEN UPDATE public.wallets SET gem=gem+v_gems,updated_at=clock_timestamp() WHERE user_id=v_player.user_id; END IF;
      END IF;
    END LOOP;
    v_result:=jsonb_build_object('type','winner','currency','coin','entryFeePerPlayer',500,
      'totalEntry',1000,'commission',0,'payout',CASE WHEN v_bot_winner IS NULL THEN 1000 ELSE 0 END,
      'winnerUserId',v_real_winner,
      'netCoinDelta',CASE WHEN v_bot_winner IS NULL THEN 500 ELSE -500 END,
      'winnerPointDelta',CASE WHEN v_bot_winner IS NULL THEN 35 ELSE -15 END,
      'winnerGemDelta',CASE WHEN v_bot_winner IS NULL THEN 10 ELSE 0 END,'loserPointDelta',-15,'loserGemDelta',0,
      'botWon',v_bot_winner IS NOT NULL,'takeoverPointDelta',-25,'takeoverGemDelta',0);
  END IF;
  UPDATE public.dama_match_economy SET settled_at=clock_timestamp(),settlement=v_result WHERE match_id=p_match_id;
  UPDATE public.dama_matches SET settlement=v_result,settlement_at=clock_timestamp() WHERE id=p_match_id;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dama_settle_match(uuid) TO service_role;

-- Record a bot win as a loss for the sole real participant in shared stats.
CREATE OR REPLACE FUNCTION multiplayer_private.record_dama_final_stats(
  p_match_id uuid, p_manual_leaver uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_match public.dama_matches%ROWTYPE; v_winning_color text; v_results jsonb;
BEGIN
  SELECT * INTO v_match FROM public.dama_matches WHERE id=p_match_id;
  IF NOT FOUND OR v_match.status<>'finished' THEN RETURN; END IF;
  v_winning_color:=v_match.state->'result'->>'winner';
  IF v_winning_color IS NULL AND v_match.finish_reason<>'both-bot-takeover' AND p_manual_leaver IS NULL THEN RETURN; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id',p.user_id,
    'team_id',CASE WHEN p.piece_color='cream' THEN 'teamA' ELSE 'teamB' END,
    'outcome',CASE WHEN p.manual_left OR p.user_id=p_manual_leaver THEN 'loss'
      WHEN p.piece_color=v_winning_color AND p.bot_profile_id IS NULL AND NOT p.bot_takeover THEN 'win' ELSE 'loss' END,
    'reason',CASE WHEN p.manual_left OR p.user_id=p_manual_leaver THEN 'manual_leave' ELSE 'match_finished' END
  ) ORDER BY p.player_index),'[]'::jsonb) INTO v_results
  FROM public.dama_match_players p WHERE p.match_id=p_match_id AND p.user_id IS NOT NULL
    AND (p.left_at IS NULL OR p.user_id=p_manual_leaver);
  PERFORM multiplayer_private.record_player_results('dama',p_match_id,v_match.version,
    CASE WHEN p_manual_leaver IS NULL THEN NULL ELSE 'manual_leave' END,v_results);
END;
$$;
