-- Complete Daily Quests: automatic daily schedule, authoritative claims and wallet audit.

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS coin numeric NOT NULL DEFAULT 0 CHECK (coin >= 0),
  ADD COLUMN IF NOT EXISTS gem numeric NOT NULL DEFAULT 0 CHECK (gem >= 0);

ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_currency_check;
ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_currency_check
  CHECK (currency IN ('MC', 'Gold', 'Coin', 'Gem'));

CREATE TABLE IF NOT EXISTS public.daily_quest_reward_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quest_instance_id uuid NOT NULL REFERENCES public.daily_quest_instances(id) ON DELETE CASCADE,
  reward_type text NOT NULL CHECK (reward_type IN ('coin', 'gem', 'mc')),
  reward_amount numeric NOT NULL CHECK (reward_amount > 0),
  balance_before numeric NOT NULL,
  balance_after numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, quest_instance_id)
);
CREATE INDEX IF NOT EXISTS daily_quest_reward_claims_user_created_idx
  ON public.daily_quest_reward_claims(user_id, created_at DESC);
ALTER TABLE public.daily_quest_reward_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_quest_reward_claims FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_daily_quest_schedule(p_quest_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_quest_date IS NULL THEN RAISE EXCEPTION 'invalid_quest_date'; END IF;

  -- A custom schedule is authoritative. Defaults are only created for an empty day.
  IF EXISTS (SELECT 1 FROM public.daily_quest_instances WHERE quest_date = p_quest_date) THEN
    RETURN;
  END IF;

  INSERT INTO public.daily_quest_instances(
    quest_date, definition_id, title, description, target,
    reward_type, reward_amount, sort_order, active, metadata
  )
  SELECT p_quest_date, definition.id, defaults.title, defaults.description,
         defaults.target, defaults.reward_type, defaults.reward_amount,
         defaults.sort_order, true, jsonb_build_object('source', 'default_schedule')
  FROM (VALUES
    ('domino_match_completed', 'یەک یاریی دۆمینۆ تەواو بکە', 'یەک یاریی دۆمینۆی ڕاستەقینە تەواو بکە', 1, 'coin', 500::numeric, 0),
    ('okey_match_completed', 'دوو یاریی ئۆکەی تەواو بکە', 'دوو یاریی ئۆکەی ڕاستەقینە تەواو بکە', 2, 'gem', 10::numeric, 1),
    ('okey_match_won', 'یەک یاریی ئۆکەی ببەرەوە', 'یەک یاریی ئۆکەی ڕاستەقینە ببەرەوە', 1, 'coin', 1000::numeric, 2)
  ) AS defaults(code, title, description, target, reward_type, reward_amount, sort_order)
  JOIN public.daily_quest_definitions AS definition ON definition.code = defaults.code
  WHERE definition.enabled
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_daily_quest_schedule(date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_schedule_before_daily_quest_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.ensure_daily_quest_schedule(NEW.quest_date);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_schedule_before_daily_quest_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ensure_schedule_before_daily_quest_match_event ON public.daily_quest_match_events_v2;
CREATE TRIGGER ensure_schedule_before_daily_quest_match_event
BEFORE INSERT ON public.daily_quest_match_events_v2
FOR EACH ROW EXECUTE FUNCTION public.ensure_schedule_before_daily_quest_event();

DROP TRIGGER IF EXISTS ensure_schedule_before_daily_quest_gameplay_event ON public.daily_quest_gameplay_events;
CREATE TRIGGER ensure_schedule_before_daily_quest_gameplay_event
BEFORE INSERT ON public.daily_quest_gameplay_events
FOR EACH ROW EXECUTE FUNCTION public.ensure_schedule_before_daily_quest_event();

CREATE OR REPLACE FUNCTION public.get_daily_quests()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Baghdad')::date;
  v_quests jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.ensure_daily_quest_schedule(v_today);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'instanceId', instance.id, 'definitionCode', definition.code,
    'gameType', definition.game_type, 'metric', definition.metric,
    'title', instance.title, 'description', instance.description,
    'target', instance.target,
    'progress', LEAST(instance.target, COALESCE(progress.progress, 0)),
    'completed', COALESCE(progress.progress, 0) >= instance.target,
    'claimed', claim.id IS NOT NULL,
    'canClaim', COALESCE(progress.progress, 0) >= instance.target AND claim.id IS NULL,
    'rewardType', instance.reward_type, 'rewardAmount', instance.reward_amount,
    'sortOrder', instance.sort_order
  ) ORDER BY instance.sort_order), '[]'::jsonb) INTO v_quests
  FROM public.daily_quest_instances AS instance
  JOIN public.daily_quest_definitions AS definition ON definition.id = instance.definition_id
  LEFT JOIN public.daily_quest_progress_v2 AS progress
    ON progress.quest_instance_id = instance.id AND progress.user_id = v_user_id
  LEFT JOIN public.daily_quest_reward_claims AS claim
    ON claim.quest_instance_id = instance.id AND claim.user_id = v_user_id
  WHERE instance.quest_date = v_today AND instance.active AND definition.enabled;

  RETURN jsonb_build_object(
    'serverDate', v_today,
    'nextResetAt', ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Baghdad'),
    'quests', v_quests
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_daily_quests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_quests() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_daily_quest_reward(p_quest_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Baghdad')::date;
  v_instance record; v_progress integer; v_claim record;
  v_before numeric; v_after numeric; v_inserted_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  IF p_quest_instance_id IS NULL THEN RAISE EXCEPTION 'invalid_quest_instance'; END IF;

  SELECT instance.* INTO v_instance FROM public.daily_quest_instances AS instance
  JOIN public.daily_quest_definitions AS definition ON definition.id = instance.definition_id
  WHERE instance.id = p_quest_instance_id AND instance.quest_date = v_today
    AND instance.active AND definition.enabled
  FOR UPDATE OF instance;
  IF NOT FOUND THEN RAISE EXCEPTION 'quest_not_available'; END IF;

  SELECT progress INTO v_progress FROM public.daily_quest_progress_v2
  WHERE user_id = v_user_id AND quest_instance_id = p_quest_instance_id FOR UPDATE;
  IF COALESCE(v_progress, 0) < v_instance.target THEN RAISE EXCEPTION 'quest_not_completed'; END IF;

  SELECT * INTO v_claim FROM public.daily_quest_reward_claims
  WHERE user_id = v_user_id AND quest_instance_id = p_quest_instance_id;
  IF FOUND THEN
    RETURN jsonb_build_object('claimId', v_claim.id, 'instanceId', p_quest_instance_id,
      'alreadyClaimed', true, 'rewardType', v_claim.reward_type,
      'rewardAmount', v_claim.reward_amount, 'balanceBefore', v_claim.balance_before,
      'balanceAfter', v_claim.balance_after, 'dailyQuests', public.get_daily_quests());
  END IF;

  INSERT INTO public.wallets(user_id, mc, coin, gem, updated_at)
  VALUES(v_user_id, 0, 0, 0, clock_timestamp()) ON CONFLICT(user_id) DO NOTHING;
  IF v_instance.reward_type = 'coin' THEN
    SELECT coin INTO v_before FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;
    UPDATE public.wallets SET coin = coin + v_instance.reward_amount, updated_at = clock_timestamp()
      WHERE user_id = v_user_id RETURNING coin INTO v_after;
  ELSIF v_instance.reward_type = 'gem' THEN
    SELECT gem INTO v_before FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;
    UPDATE public.wallets SET gem = gem + v_instance.reward_amount, updated_at = clock_timestamp()
      WHERE user_id = v_user_id RETURNING gem INTO v_after;
  ELSIF v_instance.reward_type = 'mc' THEN
    SELECT mc INTO v_before FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;
    UPDATE public.wallets SET mc = mc + v_instance.reward_amount, updated_at = clock_timestamp()
      WHERE user_id = v_user_id RETURNING mc INTO v_after;
  ELSE RAISE EXCEPTION 'unsupported_quest_reward'; END IF;

  INSERT INTO public.daily_quest_reward_claims(
    user_id, quest_instance_id, reward_type, reward_amount, balance_before, balance_after
  ) VALUES(v_user_id, p_quest_instance_id, v_instance.reward_type,
    v_instance.reward_amount, v_before, v_after) RETURNING id INTO v_inserted_id;

  INSERT INTO public.wallet_transactions(user_id, to_user_id, amount, currency,
    transaction_type, status, metadata, balance_before, balance_after)
  VALUES(v_user_id, v_user_id, v_instance.reward_amount,
    CASE v_instance.reward_type WHEN 'coin' THEN 'Coin' WHEN 'gem' THEN 'Gem' ELSE 'MC' END,
    'daily_quest_reward', 'completed',
    jsonb_build_object('quest_instance_id', p_quest_instance_id), v_before, v_after);

  RETURN jsonb_build_object('claimId', v_inserted_id, 'instanceId', p_quest_instance_id,
    'alreadyClaimed', false, 'rewardType', v_instance.reward_type,
    'rewardAmount', v_instance.reward_amount, 'balanceBefore', v_before,
    'balanceAfter', v_after, 'dailyQuests', public.get_daily_quests());
END;
$$;
REVOKE ALL ON FUNCTION public.claim_daily_quest_reward(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_quest_reward(uuid) TO authenticated;

