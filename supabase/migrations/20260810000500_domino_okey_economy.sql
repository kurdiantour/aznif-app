-- Final Domino economy. Okey is the behavioral reference; no okey.* object is changed.
-- Domino card entries: Fun 1v1=500, Fun 2v2=3500, Aznif 1v1=5/10, Aznif 2v2=15/20.

ALTER TABLE public.one_vs_one_rooms
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'fun' CHECK (currency IN ('fun','aznif')),
  ADD COLUMN IF NOT EXISTS entry_fee numeric(20,2) NOT NULL DEFAULT 0 CHECK (entry_fee >= 0),
  ADD COLUMN IF NOT EXISTS commission_rate numeric(6,5) NOT NULL DEFAULT 0 CHECK (commission_rate BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS commission_per_player numeric(20,2) NOT NULL DEFAULT 0 CHECK (commission_per_player >= 0),
  ADD COLUMN IF NOT EXISTS total_entry numeric(20,2) NOT NULL DEFAULT 0 CHECK (total_entry >= 0),
  ADD COLUMN IF NOT EXISTS total_commission numeric(20,2) NOT NULL DEFAULT 0 CHECK (total_commission >= 0),
  ADD COLUMN IF NOT EXISTS prize_pool numeric(20,2) NOT NULL DEFAULT 0 CHECK (prize_pool >= 0),
  ADD COLUMN IF NOT EXISTS economy_charged_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement jsonb;

ALTER TABLE public.two_vs_two_rooms
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'fun' CHECK (currency IN ('fun','aznif')),
  ADD COLUMN IF NOT EXISTS entry_fee numeric(20,2) NOT NULL DEFAULT 0 CHECK (entry_fee >= 0),
  ADD COLUMN IF NOT EXISTS commission_rate numeric(6,5) NOT NULL DEFAULT 0 CHECK (commission_rate BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS commission_per_player numeric(20,2) NOT NULL DEFAULT 0 CHECK (commission_per_player >= 0),
  ADD COLUMN IF NOT EXISTS total_entry numeric(20,2) NOT NULL DEFAULT 0 CHECK (total_entry >= 0),
  ADD COLUMN IF NOT EXISTS total_commission numeric(20,2) NOT NULL DEFAULT 0 CHECK (total_commission >= 0),
  ADD COLUMN IF NOT EXISTS prize_pool numeric(20,2) NOT NULL DEFAULT 0 CHECK (prize_pool >= 0),
  ADD COLUMN IF NOT EXISTS economy_charged_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement jsonb;

ALTER TABLE public.one_vs_one_matchmaking_queue
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'fun' CHECK (currency IN ('fun','aznif')),
  ADD COLUMN IF NOT EXISTS entry_fee numeric(20,2) NOT NULL DEFAULT 0 CHECK (entry_fee >= 0);
ALTER TABLE public.two_vs_two_matchmaking_queue
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'fun' CHECK (currency IN ('fun','aznif')),
  ADD COLUMN IF NOT EXISTS entry_fee numeric(20,2) NOT NULL DEFAULT 0 CHECK (entry_fee >= 0);

CREATE INDEX IF NOT EXISTS domino_1v1_queue_economy_idx
  ON public.one_vs_one_matchmaking_queue(currency,entry_fee,status,created_at) WHERE status='searching';
CREATE INDEX IF NOT EXISTS domino_2v2_room_economy_idx
  ON public.two_vs_two_rooms(currency,entry_fee,status,created_at) WHERE status='waiting';

CREATE TABLE public.domino_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  mode text NOT NULL CHECK (mode IN ('1v1','2v2')),
  room_id uuid NOT NULL,
  currency text NOT NULL CHECK (currency IN ('fun','aznif')),
  amount numeric(20,2) NOT NULL CHECK (amount <> 0),
  reason text NOT NULL CHECK (reason IN ('entry_fee','commission_burn','prize','refund')),
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX domino_wallet_ledger_room_idx ON public.domino_wallet_ledger(mode,room_id,created_at);
ALTER TABLE public.domino_wallet_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.domino_wallet_ledger FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.domino_wallet_ledger TO service_role;

CREATE TABLE public.domino_fun_match_rewards (
  mode text NOT NULL CHECK (mode IN ('1v1','2v2')),
  room_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id text NOT NULL CHECK (team_id IN ('teamA','teamB')),
  point_delta integer NOT NULL,
  gem_delta numeric(20,2) NOT NULL CHECK (gem_delta >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(mode,room_id,user_id)
);
ALTER TABLE public.domino_fun_match_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.domino_fun_match_rewards FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.domino_fun_match_rewards TO service_role;

-- Economy is always derived server-side. Private 10-Aznif rooms are covered too.
CREATE OR REPLACE FUNCTION public.domino_configure_room_economy()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_players integer:=CASE WHEN TG_TABLE_NAME='one_vs_one_rooms' THEN 2 ELSE 4 END;
BEGIN
  IF NEW.entry_fee<=0 AND NEW.bet_amount>0 THEN NEW.entry_fee:=NEW.bet_amount; NEW.currency:='aznif'; END IF;
  IF NEW.entry_fee<=0 THEN
    NEW.entry_fee:=CASE WHEN TG_TABLE_NAME='one_vs_one_rooms' THEN 500 ELSE 3500 END;
    NEW.currency:='fun';
  END IF;
  NEW.entry_fee:=round(NEW.entry_fee,2);
  NEW.commission_rate:=CASE WHEN NEW.currency='aznif' THEN 0.05 ELSE 0 END;
  NEW.commission_per_player:=round(NEW.entry_fee*NEW.commission_rate,2);
  NEW.total_entry:=round(NEW.entry_fee*v_players,2);
  NEW.total_commission:=round(NEW.commission_per_player*v_players,2);
  NEW.prize_pool:=round(NEW.total_entry-NEW.total_commission,2);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS domino_configure_1v1_economy ON public.one_vs_one_rooms;
CREATE TRIGGER domino_configure_1v1_economy BEFORE INSERT ON public.one_vs_one_rooms FOR EACH ROW EXECUTE FUNCTION public.domino_configure_room_economy();
DROP TRIGGER IF EXISTS domino_configure_2v2_economy ON public.two_vs_two_rooms;
CREATE TRIGGER domino_configure_2v2_economy BEFORE INSERT ON public.two_vs_two_rooms FOR EACH ROW EXECUTE FUNCTION public.domino_configure_room_economy();

-- Charge all players atomically in the same transaction that creates the authoritative private state.
CREATE OR REPLACE FUNCTION public.domino_charge_room_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_mode text:=CASE WHEN TG_TABLE_NAME='one_vs_one_private_states' THEN '1v1' ELSE '2v2' END;
  v_expected integer:=CASE WHEN TG_TABLE_NAME='one_vs_one_private_states' THEN 2 ELSE 4 END;
  v_room record; v_player record; v_count integer; v_distinct integer; v_before numeric; v_after numeric;
BEGIN
  IF v_mode='1v1' THEN
    SELECT * INTO v_room FROM public.one_vs_one_rooms WHERE id=NEW.room_id FOR UPDATE;
    SELECT count(*),count(DISTINCT user_id) INTO v_count,v_distinct FROM public.one_vs_one_players WHERE room_id=NEW.room_id AND user_id IS NOT NULL;
  ELSE
    SELECT * INTO v_room FROM public.two_vs_two_rooms WHERE id=NEW.room_id FOR UPDATE;
    SELECT count(*),count(DISTINCT user_id) INTO v_count,v_distinct FROM public.two_vs_two_players WHERE room_id=NEW.room_id AND user_id IS NOT NULL;
  END IF;
  IF v_room.economy_charged_at IS NOT NULL THEN RETURN NEW; END IF;
  IF v_count<>v_expected OR v_distinct<>v_expected THEN RAISE EXCEPTION 'match_requires_%_unique_players',v_expected; END IF;
  IF v_room.currency='fun' AND (v_room.total_commission<>0 OR v_room.prize_pool<>v_room.total_entry) THEN RAISE EXCEPTION 'invalid_fun_economy_configuration'; END IF;
  IF v_room.currency='aznif' AND v_room.commission_rate<>0.05 THEN RAISE EXCEPTION 'invalid_aznif_commission_rate'; END IF;

  FOR v_player IN EXECUTE format('SELECT user_id,player_index,team_id FROM public.%I WHERE room_id=$1 AND user_id IS NOT NULL ORDER BY user_id',CASE WHEN v_mode='1v1' THEN 'one_vs_one_players' ELSE 'two_vs_two_players' END) USING NEW.room_id LOOP
    IF v_room.currency='aznif' THEN
      SELECT mc INTO v_before FROM public.wallets WHERE user_id=v_player.user_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_initialized'; END IF;
      IF v_before<v_room.entry_fee THEN RAISE EXCEPTION 'insufficient_entry_balance'; END IF;
      UPDATE public.wallets SET mc=mc-v_room.entry_fee,updated_at=now() WHERE user_id=v_player.user_id RETURNING mc INTO v_after;
    ELSE
      SELECT coin INTO v_before FROM public.wallets WHERE user_id=v_player.user_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_initialized'; END IF;
      IF v_before<v_room.entry_fee THEN RAISE EXCEPTION 'insufficient_entry_balance'; END IF;
      UPDATE public.wallets SET coin=coin-v_room.entry_fee,updated_at=now() WHERE user_id=v_player.user_id RETURNING coin INTO v_after;
    END IF;
    INSERT INTO public.domino_wallet_ledger(user_id,mode,room_id,currency,amount,reason,idempotency_key,metadata)
    VALUES(v_player.user_id,v_mode,NEW.room_id,v_room.currency,-v_room.entry_fee,'entry_fee',v_mode||':'||NEW.room_id||':entry:'||v_player.user_id,
      jsonb_build_object('playerIndex',v_player.player_index,'teamId',v_player.team_id,'balanceBefore',v_before,'balanceAfter',v_after,'entryFee',v_room.entry_fee,'commissionPart',v_room.commission_per_player));
  END LOOP;
  IF v_room.currency='aznif' AND v_room.total_commission>0 THEN
    INSERT INTO public.domino_wallet_ledger(user_id,mode,room_id,currency,amount,reason,idempotency_key,metadata)
    VALUES(NULL,v_mode,NEW.room_id,'aznif',v_room.total_commission,'commission_burn',v_mode||':'||NEW.room_id||':commission-burn',jsonb_build_object('burned',true,'creditedToWallet',false,'totalCommission',v_room.total_commission));
  END IF;
  IF v_mode='1v1' THEN UPDATE public.one_vs_one_rooms SET economy_charged_at=now() WHERE id=NEW.room_id;
  ELSE UPDATE public.two_vs_two_rooms SET economy_charged_at=now() WHERE id=NEW.room_id; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS domino_charge_1v1_entry ON public.one_vs_one_private_states;
CREATE TRIGGER domino_charge_1v1_entry BEFORE INSERT ON public.one_vs_one_private_states FOR EACH ROW EXECUTE FUNCTION public.domino_charge_room_entry();
DROP TRIGGER IF EXISTS domino_charge_2v2_entry ON public.two_vs_two_private_states;
CREATE TRIGGER domino_charge_2v2_entry BEFORE INSERT ON public.two_vs_two_private_states FOR EACH ROW EXECUTE FUNCTION public.domino_charge_room_entry();

CREATE OR REPLACE FUNCTION public.domino_settle_match(p_mode text,p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_room record; v_player record; v_winner text; v_slots integer; v_payout numeric;
  v_before numeric; v_after numeric; v_left boolean; v_points integer; v_gems numeric; v_result jsonb;
BEGIN
  IF p_mode='1v1' THEN SELECT * INTO v_room FROM public.one_vs_one_rooms WHERE id=p_room_id FOR UPDATE;
  ELSIF p_mode='2v2' THEN SELECT * INTO v_room FROM public.two_vs_two_rooms WHERE id=p_room_id FOR UPDATE;
  ELSE RAISE EXCEPTION 'invalid_match_mode'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'match_not_found'; END IF;
  IF v_room.settlement_at IS NOT NULL THEN RETURN v_room.settlement; END IF;
  IF v_room.status<>'finished' THEN RAISE EXCEPTION 'match_not_finished'; END IF;
  IF v_room.economy_charged_at IS NULL THEN RAISE EXCEPTION 'entry_fee_not_charged'; END IF;
  v_winner:=v_room.state->>'winningTeamId';
  IF v_winner NOT IN ('teamA','teamB') THEN
    v_result:=jsonb_build_object('type','no_winner','currency',v_room.currency,'entryFeePerPlayer',v_room.entry_fee,'totalEntry',v_room.total_entry,'totalCommission',v_room.total_commission,'prizePool',v_room.prize_pool,'payoutPerWinner',0,'refundedPlayers',0);
  ELSE
    v_slots:=CASE WHEN p_mode='1v1' THEN 1 ELSE 2 END;
    v_payout:=round(v_room.prize_pool/v_slots,2);
    IF round(v_payout*v_slots,2)<>v_room.prize_pool THEN RAISE EXCEPTION 'prize_pool_not_evenly_divisible'; END IF;
    FOR v_player IN EXECUTE format('SELECT user_id,team_id FROM public.%I WHERE room_id=$1 AND user_id IS NOT NULL ORDER BY player_index',CASE WHEN p_mode='1v1' THEN 'one_vs_one_players' ELSE 'two_vs_two_players' END) USING p_room_id LOOP
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE room_id=$1 AND player_id=$2 AND action=''manual_leave_takeover'')',CASE WHEN p_mode='1v1' THEN 'one_vs_one_moves' ELSE 'two_vs_two_moves' END) INTO v_left USING p_room_id,v_player.user_id;
      IF v_player.team_id=v_winner AND NOT v_left THEN
        IF v_room.currency='aznif' THEN
          SELECT mc INTO v_before FROM public.wallets WHERE user_id=v_player.user_id FOR UPDATE;
          UPDATE public.wallets SET mc=mc+v_payout,updated_at=now() WHERE user_id=v_player.user_id RETURNING mc INTO v_after;
        ELSE
          SELECT coin INTO v_before FROM public.wallets WHERE user_id=v_player.user_id FOR UPDATE;
          UPDATE public.wallets SET coin=coin+v_payout,updated_at=now() WHERE user_id=v_player.user_id RETURNING coin INTO v_after;
        END IF;
        IF v_before IS NULL OR v_after IS NULL THEN RAISE EXCEPTION 'wallet_not_initialized'; END IF;
        INSERT INTO public.domino_wallet_ledger(user_id,mode,room_id,currency,amount,reason,idempotency_key,metadata)
        VALUES(v_player.user_id,p_mode,p_room_id,v_room.currency,v_payout,'prize',p_mode||':'||p_room_id||':prize:'||v_player.user_id,jsonb_build_object('winnerTeamId',v_winner,'balanceBefore',v_before,'balanceAfter',v_after,'payout',v_payout));
      END IF;
      IF v_room.currency='fun' THEN
        v_points:=CASE WHEN v_player.team_id=v_winner AND NOT v_left THEN 35 ELSE -15 END;
        v_gems:=CASE WHEN v_player.team_id=v_winner AND NOT v_left THEN 10 ELSE 0 END;
        INSERT INTO public.domino_fun_match_rewards(mode,room_id,user_id,team_id,point_delta,gem_delta)
        VALUES(p_mode,p_room_id,v_player.user_id,v_player.team_id,v_points,v_gems) ON CONFLICT DO NOTHING;
        IF FOUND THEN
          UPDATE public.profiles SET points=greatest(0,coalesce(points,0)+v_points),updated_at=now() WHERE id=v_player.user_id;
          IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_initialized'; END IF;
          IF v_gems>0 THEN UPDATE public.wallets SET gem=gem+v_gems,updated_at=now() WHERE user_id=v_player.user_id; IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_initialized'; END IF; END IF;
        END IF;
      END IF;
    END LOOP;
    v_result:=jsonb_build_object('type','winner','currency',v_room.currency,'winnerTeamId',v_winner,'entryFeePerPlayer',v_room.entry_fee,'commissionRate',v_room.commission_rate,'commissionPerPlayer',v_room.commission_per_player,'totalEntry',v_room.total_entry,'totalCommission',v_room.total_commission,'commissionBurned',v_room.currency='aznif' AND v_room.total_commission>0,'prizePool',v_room.prize_pool,'payoutPerWinner',v_payout);
  END IF;
  IF p_mode='1v1' THEN UPDATE public.one_vs_one_rooms SET settlement_at=now(),settlement=v_result WHERE id=p_room_id;
  ELSE UPDATE public.two_vs_two_rooms SET settlement_at=now(),settlement=v_result WHERE id=p_room_id; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.domino_settle_finished_room()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.status='finished' AND OLD.status IS DISTINCT FROM 'finished' AND NEW.settlement_at IS NULL THEN
    PERFORM public.domino_settle_match(CASE WHEN TG_TABLE_NAME='one_vs_one_rooms' THEN '1v1' ELSE '2v2' END,NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS domino_settle_1v1 ON public.one_vs_one_rooms;
CREATE TRIGGER domino_settle_1v1 AFTER UPDATE OF status ON public.one_vs_one_rooms FOR EACH ROW EXECUTE FUNCTION public.domino_settle_finished_room();
DROP TRIGGER IF EXISTS domino_settle_2v2 ON public.two_vs_two_rooms;
CREATE TRIGGER domino_settle_2v2 AFTER UPDATE OF status ON public.two_vs_two_rooms FOR EACH ROW EXECUTE FUNCTION public.domino_settle_finished_room();

CREATE OR REPLACE FUNCTION public.domino_cancel_match_and_refund(p_mode text,p_room_id uuid,p_reason text DEFAULT 'match_cancelled')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_room record; v_entry record; v_before numeric; v_after numeric; v_count integer:=0; v_result jsonb;
BEGIN
  IF v_uid IS NULL AND auth.role()<>'service_role' THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_mode='1v1' THEN SELECT * INTO v_room FROM public.one_vs_one_rooms WHERE id=p_room_id FOR UPDATE; IF v_uid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.one_vs_one_players WHERE room_id=p_room_id AND user_id=v_uid) THEN RAISE EXCEPTION 'not_room_member'; END IF;
  ELSIF p_mode='2v2' THEN SELECT * INTO v_room FROM public.two_vs_two_rooms WHERE id=p_room_id FOR UPDATE; IF v_uid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.two_vs_two_players WHERE room_id=p_room_id AND user_id=v_uid) THEN RAISE EXCEPTION 'not_room_member'; END IF;
  ELSE RAISE EXCEPTION 'invalid_match_mode'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'match_not_found'; END IF;
  IF v_room.settlement_at IS NOT NULL THEN IF v_room.settlement->>'type'='refund' THEN RETURN v_room.settlement; END IF; RAISE EXCEPTION 'match_already_settled'; END IF;
  IF v_room.status='finished' THEN RAISE EXCEPTION 'match_not_cancellable'; END IF;
  FOR v_entry IN SELECT * FROM public.domino_wallet_ledger WHERE mode=p_mode AND room_id=p_room_id AND reason='entry_fee' ORDER BY created_at,id LOOP
    IF v_room.currency='aznif' THEN SELECT mc INTO v_before FROM public.wallets WHERE user_id=v_entry.user_id FOR UPDATE; UPDATE public.wallets SET mc=mc+abs(v_entry.amount),updated_at=now() WHERE user_id=v_entry.user_id RETURNING mc INTO v_after;
    ELSE SELECT coin INTO v_before FROM public.wallets WHERE user_id=v_entry.user_id FOR UPDATE; UPDATE public.wallets SET coin=coin+abs(v_entry.amount),updated_at=now() WHERE user_id=v_entry.user_id RETURNING coin INTO v_after; END IF;
    IF v_before IS NULL OR v_after IS NULL THEN RAISE EXCEPTION 'wallet_not_initialized'; END IF;
    INSERT INTO public.domino_wallet_ledger(user_id,mode,room_id,currency,amount,reason,idempotency_key,metadata)
    VALUES(v_entry.user_id,p_mode,p_room_id,v_room.currency,abs(v_entry.amount),'refund',p_mode||':'||p_room_id||':refund:'||v_entry.user_id,jsonb_build_object('balanceBefore',v_before,'balanceAfter',v_after,'reason',p_reason));
    v_count:=v_count+1;
  END LOOP;
  IF v_room.currency='aznif' AND v_room.total_commission>0 AND v_count>0 THEN
    INSERT INTO public.domino_wallet_ledger(user_id,mode,room_id,currency,amount,reason,idempotency_key,metadata)
    VALUES(NULL,p_mode,p_room_id,'aznif',-v_room.total_commission,'commission_burn',p_mode||':'||p_room_id||':commission-burn-reversal',jsonb_build_object('reversal',true,'burned',false,'reason',p_reason));
  END IF;
  v_result:=jsonb_build_object('type','refund','currency',v_room.currency,'reason',p_reason,'refundPerPlayer',v_room.entry_fee,'refundedPlayers',v_count,'totalRefund',v_room.entry_fee*v_count,'commissionReversed',CASE WHEN v_room.currency='aznif' AND v_count>0 THEN v_room.total_commission ELSE 0 END);
  IF p_mode='1v1' THEN UPDATE public.one_vs_one_rooms SET status='cancelled',settlement_at=now(),settlement=v_result,current_turn_player_id=NULL,version=version+1,updated_at=now() WHERE id=p_room_id;
  ELSE UPDATE public.two_vs_two_rooms SET status='cancelled',settlement_at=now(),settlement=v_result,current_turn_player_id=NULL,version=version+1,updated_at=now() WHERE id=p_room_id; END IF;
  RETURN v_result;
END;
$$;

-- The old post-match reward and loser-only Aznif settlement are no longer economic authorities.
CREATE OR REPLACE FUNCTION public.settle_finished_match_rewards(p_mode text,p_room_id uuid)
RETURNS TABLE(reward_id uuid,rewarded_user_id uuid,awarded_points integer,awarded_gold numeric,already_claimed boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT NULL::uuid,NULL::uuid,NULL::integer,NULL::numeric,true WHERE false $$;
CREATE OR REPLACE FUNCTION public.settle_one_vs_one_bet(p_room_id uuid)
RETURNS TABLE(settlement_id uuid,winner_user_id uuid,loser_user_id uuid,bet_amount numeric,winner_payout numeric,burned_amount numeric,already_settled boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT NULL::uuid,NULL::uuid,NULL::uuid,NULL::numeric,NULL::numeric,NULL::numeric,true WHERE false $$;

REVOKE ALL ON FUNCTION public.domino_configure_room_economy() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.domino_charge_room_entry() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.domino_settle_match(text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.domino_settle_finished_room() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.domino_cancel_match_and_refund(text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.domino_cancel_match_and_refund(text,uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.settle_finished_match_rewards(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_finished_match_rewards(text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.settle_one_vs_one_bet(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_one_vs_one_bet(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.find_domino_match(p_mode text,p_currency text,p_entry_fee numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_room record; v_waiter record; v_count integer; v_index integer; v_seat text; v_team text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_mode NOT IN ('1v1','2v2') OR p_currency NOT IN ('fun','aznif') THEN RAISE EXCEPTION 'invalid_match_configuration'; END IF;
  IF (p_mode='1v1' AND NOT ((p_currency='fun' AND p_entry_fee=500) OR (p_currency='aznif' AND p_entry_fee IN (5,10)))) OR
     (p_mode='2v2' AND NOT ((p_currency='fun' AND p_entry_fee=3500) OR (p_currency='aznif' AND p_entry_fee IN (15,20)))) THEN RAISE EXCEPTION 'unsupported_domino_entry'; END IF;
  IF p_currency='aznif' AND coalesce((SELECT mc FROM public.wallets WHERE user_id=v_uid),0)<p_entry_fee THEN RAISE EXCEPTION 'insufficient_entry_balance'; END IF;
  IF p_currency='fun' AND coalesce((SELECT coin FROM public.wallets WHERE user_id=v_uid),0)<p_entry_fee THEN RAISE EXCEPTION 'insufficient_entry_balance'; END IF;

  IF p_mode='1v1' THEN
    DELETE FROM public.one_vs_one_matchmaking_queue WHERE user_id=v_uid OR (status='searching' AND created_at<now()-interval '5 minutes');
    SELECT * INTO v_waiter FROM public.one_vs_one_matchmaking_queue q WHERE q.status='searching' AND q.user_id<>v_uid AND q.currency=p_currency AND q.entry_fee=p_entry_fee
      AND CASE WHEN p_currency='aznif' THEN coalesce((SELECT mc FROM public.wallets WHERE user_id=q.user_id),0)>=p_entry_fee ELSE coalesce((SELECT coin FROM public.wallets WHERE user_id=q.user_id),0)>=p_entry_fee END
      ORDER BY q.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      INSERT INTO public.one_vs_one_matchmaking_queue(user_id,status,bet_amount,currency,entry_fee) VALUES(v_uid,'searching',0,p_currency,p_entry_fee);
      RETURN jsonb_build_object('status','searching','mode',p_mode,'currency',p_currency,'entry_fee',p_entry_fee);
    END IF;
    INSERT INTO public.one_vs_one_rooms(host_user_id,room_code,status,bet_amount,player_count,metadata,currency,entry_fee)
    VALUES(v_uid,public.generate_one_vs_one_room_code(),'waiting',0,2,jsonb_build_object('economy','okey_model'),p_currency,p_entry_fee) RETURNING * INTO v_room;
    SELECT seat,team_id INTO v_seat,v_team FROM public.resolve_one_vs_one_seat_assignment(0);
    INSERT INTO public.one_vs_one_players(room_id,user_id,kind,seat,team_id,player_index,is_ready,connected) VALUES(v_room.id,v_waiter.user_id,'human',v_seat,v_team,0,true,true);
    SELECT seat,team_id INTO v_seat,v_team FROM public.resolve_one_vs_one_seat_assignment(1);
    INSERT INTO public.one_vs_one_players(room_id,user_id,kind,seat,team_id,player_index,is_ready,connected) VALUES(v_room.id,v_uid,'human',v_seat,v_team,1,true,true);
    UPDATE public.one_vs_one_matchmaking_queue SET status='matched',matched_room_id=v_room.id,ended_at=now() WHERE user_id=v_waiter.user_id;
    INSERT INTO public.one_vs_one_matchmaking_queue(user_id,status,matched_room_id,ended_at,bet_amount,currency,entry_fee) VALUES(v_uid,'matched',v_room.id,now(),0,p_currency,p_entry_fee);
    RETURN jsonb_build_object('status','matched','room_id',v_room.id,'mode',p_mode,'currency',p_currency,'entry_fee',p_entry_fee);
  END IF;

  DELETE FROM public.two_vs_two_matchmaking_queue WHERE user_id=v_uid OR (status='searching' AND created_at<now()-interval '5 minutes');
  SELECT * INTO v_room FROM public.two_vs_two_rooms r WHERE r.status='waiting' AND r.player_count<4 AND r.currency=p_currency AND r.entry_fee=p_entry_fee
    AND NOT EXISTS(SELECT 1 FROM public.two_vs_two_players p WHERE p.room_id=r.id AND p.user_id=v_uid) ORDER BY r.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
    SELECT count(*) INTO v_count FROM public.two_vs_two_players WHERE room_id=v_room.id; v_index:=v_count;
    SELECT seat,team_id INTO v_seat,v_team FROM public.resolve_two_vs_two_seat_assignment(v_index);
    INSERT INTO public.two_vs_two_players(room_id,user_id,kind,seat,team_id,player_index,is_ready,connected) VALUES(v_room.id,v_uid,'human',v_seat,v_team,v_index,true,true);
    UPDATE public.two_vs_two_rooms SET player_count=player_count+1,status=CASE WHEN v_index+1=4 THEN 'active' ELSE status END,version=version+1 WHERE id=v_room.id RETURNING * INTO v_room;
  ELSE
    INSERT INTO public.two_vs_two_rooms(host_user_id,room_code,status,bet_amount,player_count,metadata,currency,entry_fee)
    VALUES(v_uid,public.generate_two_vs_two_room_code(),'waiting',0,1,jsonb_build_object('economy','okey_model'),p_currency,p_entry_fee) RETURNING * INTO v_room;
    SELECT seat,team_id INTO v_seat,v_team FROM public.resolve_two_vs_two_seat_assignment(0);
    INSERT INTO public.two_vs_two_players(room_id,user_id,kind,seat,team_id,player_index,is_ready,connected) VALUES(v_room.id,v_uid,'human',v_seat,v_team,0,true,true);
  END IF;
  INSERT INTO public.two_vs_two_matchmaking_queue(user_id,status,matched_room_id,ended_at,currency,entry_fee)
  VALUES(v_uid,CASE WHEN v_room.status='active' THEN 'matched' ELSE 'searching' END,v_room.id,CASE WHEN v_room.status='active' THEN now() ELSE NULL END,p_currency,p_entry_fee)
  ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,matched_room_id=excluded.matched_room_id,ended_at=excluded.ended_at,currency=excluded.currency,entry_fee=excluded.entry_fee;
  IF v_room.status='active' THEN UPDATE public.two_vs_two_matchmaking_queue SET status='matched',ended_at=now() WHERE user_id IN(SELECT user_id FROM public.two_vs_two_players WHERE room_id=v_room.id); END IF;
  RETURN jsonb_build_object('status',CASE WHEN v_room.status='active' THEN 'matched' ELSE 'searching' END,'room_id',v_room.id,'mode',p_mode,'currency',p_currency,'entry_fee',p_entry_fee);
END;
$$;
-- Obsolete loser-only Aznif settlement storage is removed; the unified ledger is authoritative.
DROP FUNCTION IF EXISTS public.retry_one_vs_one_bet_settlement(uuid);
DROP FUNCTION IF EXISTS public.execute_one_vs_one_bet_settlement(uuid);
DROP TABLE IF EXISTS public.one_vs_one_bet_settlement_jobs;
DROP TABLE IF EXISTS public.one_vs_one_bet_settlements;

REVOKE ALL ON FUNCTION public.find_domino_match(text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.find_domino_match(text,text,numeric) TO authenticated;

