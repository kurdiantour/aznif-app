-- Mirror Domino Fun 1v1 reward semantics for Dama without relaxing
-- Domino's mode/game constraints.  The row is the idempotency key for
-- each player's point and gem result.
CREATE TABLE public.dama_fun_match_rewards (
  match_id uuid NOT NULL REFERENCES public.dama_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  piece_color text NOT NULL CHECK (piece_color IN ('cream','black')),
  point_delta integer NOT NULL,
  gem_delta numeric(20,2) NOT NULL CHECK (gem_delta >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (match_id,user_id)
);
ALTER TABLE public.dama_fun_match_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dama_fun_match_rewards FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.dama_fun_match_rewards TO service_role;

CREATE OR REPLACE FUNCTION public.dama_settle_match(p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_match public.dama_matches%ROWTYPE;
  v_economy public.dama_match_economy%ROWTYPE;
  v_player record;
  v_winner uuid;
  v_before numeric;
  v_after numeric;
  v_points integer;
  v_gems numeric(20,2);
  v_reward_inserted boolean;
  v_result jsonb;
BEGIN
  SELECT * INTO STRICT v_match FROM public.dama_matches WHERE id=p_match_id FOR UPDATE;
  SELECT * INTO STRICT v_economy FROM public.dama_match_economy WHERE match_id=p_match_id FOR UPDATE;
  IF v_economy.settled_at IS NOT NULL THEN RETURN v_economy.settlement; END IF;
  IF v_match.status<>'finished' THEN RAISE EXCEPTION 'dama_match_not_finished'; END IF;
  IF v_economy.charged_at IS NULL THEN RAISE EXCEPTION 'dama_entry_not_charged'; END IF;

  v_winner:=v_match.winner_user_id;
  IF v_winner IS NULL THEN
    -- Domino's no-winner contract does not invent a winner or distribute
    -- rank rewards. Entry fees remain charged unless this was cancelled and
    -- explicitly refunded through dama_cancel_and_refund.
    v_result:=jsonb_build_object('type','no_winner','currency','coin',
      'entryFeePerPlayer',500,'totalEntry',1000,'commission',0,
      'payout',0,'refund',0,'netCoinDelta',-500,
      'pointDelta',0,'gemDelta',0,'reason',v_match.finish_reason);
  ELSE
    FOR v_player IN
      SELECT user_id,piece_color FROM public.dama_match_players
      WHERE match_id=p_match_id AND user_id IS NOT NULL AND left_at IS NULL
      ORDER BY user_id FOR UPDATE
    LOOP
      IF v_player.user_id=v_winner THEN
        v_points:=35;
        v_gems:=10;
        SELECT coin INTO v_before FROM public.wallets WHERE user_id=v_player.user_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_initialized'; END IF;
        UPDATE public.wallets SET coin=coin+1000,updated_at=clock_timestamp()
          WHERE user_id=v_player.user_id RETURNING coin INTO v_after;
        INSERT INTO public.dama_wallet_ledger(match_id,user_id,amount,reason,idempotency_key,metadata)
          VALUES(p_match_id,v_player.user_id,1000,'prize',
            'dama:'||p_match_id||':prize:'||v_player.user_id,
            jsonb_build_object('balanceBefore',v_before,'balanceAfter',v_after,'payout',1000));
      ELSE
        v_points:=-15;
        v_gems:=0;
      END IF;

      INSERT INTO public.dama_fun_match_rewards(match_id,user_id,piece_color,point_delta,gem_delta)
        VALUES(p_match_id,v_player.user_id,v_player.piece_color,v_points,v_gems)
        ON CONFLICT(match_id,user_id) DO NOTHING;
      v_reward_inserted:=FOUND;
      IF v_reward_inserted THEN
        UPDATE public.profiles SET points=GREATEST(0,COALESCE(points,0)+v_points),updated_at=clock_timestamp()
          WHERE id=v_player.user_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_initialized'; END IF;
        IF v_gems>0 THEN
          UPDATE public.wallets SET gem=gem+v_gems,updated_at=clock_timestamp()
            WHERE user_id=v_player.user_id;
          IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_initialized'; END IF;
        END IF;
      END IF;
    END LOOP;

    v_result:=jsonb_build_object('type','winner','currency','coin','winnerUserId',v_winner,
      'entryFeePerPlayer',500,'totalEntry',1000,'commission',0,'payout',1000,
      'netCoinDelta',500,'winnerPointDelta',35,'winnerGemDelta',10,
      'loserPointDelta',-15,'loserGemDelta',0);
  END IF;

  UPDATE public.dama_match_economy SET settled_at=clock_timestamp(),settlement=v_result
    WHERE match_id=p_match_id;
  UPDATE public.dama_matches SET settlement=v_result,settlement_at=clock_timestamp()
    WHERE id=p_match_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.dama_settle_match(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dama_settle_match(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
