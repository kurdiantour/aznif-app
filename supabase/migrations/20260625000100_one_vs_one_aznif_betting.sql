-- 1v1 Aznif betting for create-room flows only.
-- Free lobby matchmaking remains bet_amount = 0 and has no aznif_betting flag.

ALTER TABLE public.one_vs_one_matchmaking_queue
ADD COLUMN IF NOT EXISTS bet_amount numeric NOT NULL DEFAULT 0 CHECK (bet_amount >= 0);

CREATE INDEX IF NOT EXISTS idx_one_vs_one_matchmaking_bet_status_created
ON public.one_vs_one_matchmaking_queue(bet_amount, status, created_at)
WHERE status = 'searching';

CREATE TABLE IF NOT EXISTS public.one_vs_one_bet_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL UNIQUE REFERENCES public.one_vs_one_rooms(id) ON DELETE CASCADE,
  winner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  loser_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bet_amount numeric NOT NULL CHECK (bet_amount > 0),
  winner_payout numeric NOT NULL CHECK (winner_payout >= 0),
  burned_amount numeric NOT NULL CHECK (burned_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_one_vs_one_bet_settlements_winner
ON public.one_vs_one_bet_settlements(winner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_one_vs_one_bet_settlements_loser
ON public.one_vs_one_bet_settlements(loser_user_id, created_at DESC);

ALTER TABLE public.one_vs_one_bet_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "one_vs_one_bet_settlements_select_own"
ON public.one_vs_one_bet_settlements;

CREATE POLICY "one_vs_one_bet_settlements_select_own"
ON public.one_vs_one_bet_settlements
FOR SELECT
TO authenticated
USING (winner_user_id = auth.uid() OR loser_user_id = auth.uid());

GRANT SELECT ON public.one_vs_one_bet_settlements TO authenticated;

CREATE OR REPLACE FUNCTION public.create_one_vs_one_room(p_bet_amount numeric DEFAULT 0)
RETURNS public.one_vs_one_rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_seat text;
  v_team text;
  v_wallet_mc numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_bet_amount < 0 THEN
    RAISE EXCEPTION 'bet_amount must be non-negative';
  END IF;

  IF p_bet_amount > 0 THEN
    SELECT mc INTO v_wallet_mc
    FROM public.wallets
    WHERE user_id = v_user_id;

    IF COALESCE(v_wallet_mc, 0) < p_bet_amount THEN
      RAISE EXCEPTION 'Insufficient MC balance';
    END IF;
  END IF;

  INSERT INTO public.one_vs_one_rooms (
    host_user_id,
    room_code,
    status,
    bet_amount,
    player_count,
    metadata
  ) VALUES (
    v_user_id,
    public.generate_one_vs_one_room_code(),
    'waiting',
    p_bet_amount,
    1,
    CASE
      WHEN p_bet_amount > 0 THEN jsonb_build_object('aznif_betting', true)
      ELSE '{}'::jsonb
    END
  )
  RETURNING * INTO v_room;

  SELECT seat, team_id
  INTO v_seat, v_team
  FROM public.resolve_one_vs_one_seat_assignment(0);

  INSERT INTO public.one_vs_one_players (
    room_id,
    user_id,
    kind,
    seat,
    team_id,
    player_index,
    is_ready,
    connected
  ) VALUES (
    v_room.id,
    v_user_id,
    'human',
    v_seat,
    v_team,
    0,
    true,
    true
  );

  INSERT INTO public.one_vs_one_moves (
    room_id,
    player_id,
    sequence,
    action,
    payload
  ) VALUES (
    v_room.id,
    v_user_id,
    public.next_one_vs_one_move_sequence(v_room.id),
    'room_created',
    jsonb_build_object(
      'room_code', v_room.room_code,
      'bet_amount', v_room.bet_amount,
      'aznif_betting', p_bet_amount > 0,
      'host_user_id', v_user_id,
      'seat', v_seat,
      'team_id', v_team
    )
  );

  RETURN v_room;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_one_vs_one_room(p_room_code text)
RETURNS public.one_vs_one_players
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player_count int;
  v_seat text;
  v_team text;
  v_player public.one_vs_one_players%ROWTYPE;
  v_sequence int;
  v_wallet_mc numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_room_code IS NULL OR trim(p_room_code) = '' THEN
    RAISE EXCEPTION 'room_code is required';
  END IF;

  SELECT *
  INTO v_room
  FROM public.one_vs_one_rooms
  WHERE room_code = p_room_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.status <> 'waiting' THEN
    RAISE EXCEPTION '1v1 room is not joinable';
  END IF;

  IF v_room.bet_amount > 0
    AND COALESCE(v_room.metadata ->> 'aznif_betting', 'false') = 'true'
  THEN
    SELECT mc INTO v_wallet_mc
    FROM public.wallets
    WHERE user_id = v_user_id;

    IF COALESCE(v_wallet_mc, 0) < v_room.bet_amount THEN
      RAISE EXCEPTION 'Insufficient MC balance';
    END IF;
  END IF;

  SELECT COUNT(*)
  INTO v_player_count
  FROM public.one_vs_one_players
  WHERE room_id = v_room.id;

  IF v_player_count >= 2 THEN
    RAISE EXCEPTION '1v1 room is full';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.one_vs_one_players
    WHERE room_id = v_room.id
      AND user_id = v_user_id
  ) THEN
    RETURN (
      SELECT * FROM public.one_vs_one_players
      WHERE room_id = v_room.id
        AND user_id = v_user_id
      LIMIT 1
    );
  END IF;

  SELECT seat, team_id
  INTO v_seat, v_team
  FROM public.resolve_one_vs_one_seat_assignment(v_player_count);

  INSERT INTO public.one_vs_one_players (
    room_id,
    user_id,
    kind,
    seat,
    team_id,
    player_index,
    is_ready,
    connected
  ) VALUES (
    v_room.id,
    v_user_id,
    'human',
    v_seat,
    v_team,
    v_player_count,
    true,
    true
  )
  RETURNING * INTO v_player;

  UPDATE public.one_vs_one_rooms
  SET
    player_count = player_count + 1,
    status = CASE WHEN v_player_count + 1 = 2 THEN 'active' ELSE status END,
    version = version + 1
  WHERE id = v_room.id;

  v_sequence := public.next_one_vs_one_move_sequence(v_room.id);

  INSERT INTO public.one_vs_one_moves (
    room_id,
    player_id,
    sequence,
    action,
    payload
  ) VALUES (
    v_room.id,
    v_user_id,
    v_sequence,
    'room_joined',
    jsonb_build_object(
      'room_code', v_room.room_code,
      'user_id', v_user_id,
      'seat', v_seat,
      'team_id', v_team,
      'player_index', v_player_count
    )
  );

  RETURN v_player;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_one_vs_one_opponent()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_opponent public.one_vs_one_matchmaking_queue%ROWTYPE;
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_seat text;
  v_team text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  DELETE FROM public.one_vs_one_matchmaking_queue
  WHERE user_id = v_user_id
     OR (status = 'searching' AND created_at < now() - interval '5 minutes');

  SELECT *
  INTO v_opponent
  FROM public.one_vs_one_matchmaking_queue
  WHERE status = 'searching'
    AND user_id <> v_user_id
    AND bet_amount = 0
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    INSERT INTO public.one_vs_one_rooms (
      host_user_id,
      room_code,
      status,
      bet_amount,
      player_count,
      metadata
    ) VALUES (
      v_user_id,
      public.generate_one_vs_one_room_code(),
      'active',
      0,
      2,
      '{}'::jsonb
    )
    RETURNING * INTO v_room;

    SELECT seat, team_id INTO v_seat, v_team
    FROM public.resolve_one_vs_one_seat_assignment(0);

    INSERT INTO public.one_vs_one_players (
      room_id, user_id, kind, seat, team_id, player_index, is_ready, connected
    ) VALUES (
      v_room.id, v_opponent.user_id, 'human', v_seat, v_team, 0, true, true
    );

    SELECT seat, team_id INTO v_seat, v_team
    FROM public.resolve_one_vs_one_seat_assignment(1);

    INSERT INTO public.one_vs_one_players (
      room_id, user_id, kind, seat, team_id, player_index, is_ready, connected
    ) VALUES (
      v_room.id, v_user_id, 'human', v_seat, v_team, 1, true, true
    );

    UPDATE public.one_vs_one_matchmaking_queue
    SET status = 'matched',
        matched_room_id = v_room.id,
        ended_at = now()
    WHERE user_id = v_opponent.user_id;

    INSERT INTO public.one_vs_one_matchmaking_queue (
      user_id,
      status,
      matched_room_id,
      ended_at,
      bet_amount
    ) VALUES (
      v_user_id,
      'matched',
      v_room.id,
      now(),
      0
    );

    INSERT INTO public.one_vs_one_moves (
      room_id, player_id, sequence, action, payload
    ) VALUES (
      v_room.id,
      v_user_id,
      public.next_one_vs_one_move_sequence(v_room.id),
      'match_created',
      jsonb_build_object('player_1', v_opponent.user_id, 'player_2', v_user_id, 'bet_amount', 0)
    );

    RETURN jsonb_build_object(
      'status', 'matched',
      'room_id', v_room.id,
      'room_code', v_room.room_code,
      'opponent_user_id', v_opponent.user_id
    );
  END IF;

  INSERT INTO public.one_vs_one_matchmaking_queue (user_id, status, bet_amount)
  VALUES (v_user_id, 'searching', 0);

  RETURN jsonb_build_object('status', 'searching');
END;
$$;

CREATE OR REPLACE FUNCTION public.find_one_vs_one_bet_match(p_bet_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_opponent public.one_vs_one_matchmaking_queue%ROWTYPE;
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_seat text;
  v_team text;
  v_wallet_mc numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_bet_amount <= 0 THEN
    RAISE EXCEPTION 'bet_amount must be positive';
  END IF;

  IF p_bet_amount NOT IN (1, 5) THEN
    RAISE EXCEPTION 'Unsupported 1v1 bet amount';
  END IF;

  SELECT mc INTO v_wallet_mc
  FROM public.wallets
  WHERE user_id = v_user_id;

  IF COALESCE(v_wallet_mc, 0) < p_bet_amount THEN
    RAISE EXCEPTION 'Insufficient MC balance';
  END IF;

  DELETE FROM public.one_vs_one_matchmaking_queue
  WHERE user_id = v_user_id
     OR (status = 'searching' AND created_at < now() - interval '5 minutes');

  SELECT q.*
  INTO v_opponent
  FROM public.one_vs_one_matchmaking_queue AS q
  JOIN public.wallets AS w ON w.user_id = q.user_id
  WHERE q.status = 'searching'
    AND q.user_id <> v_user_id
    AND q.bet_amount = p_bet_amount
    AND w.mc >= p_bet_amount
  ORDER BY q.created_at ASC
  LIMIT 1
  FOR UPDATE OF q SKIP LOCKED;

  IF FOUND THEN
    INSERT INTO public.one_vs_one_rooms (
      host_user_id,
      room_code,
      status,
      bet_amount,
      player_count,
      metadata
    ) VALUES (
      v_user_id,
      public.generate_one_vs_one_room_code(),
      'active',
      p_bet_amount,
      2,
      jsonb_build_object('aznif_betting', true, 'source', 'create_room_public')
    )
    RETURNING * INTO v_room;

    SELECT seat, team_id INTO v_seat, v_team
    FROM public.resolve_one_vs_one_seat_assignment(0);

    INSERT INTO public.one_vs_one_players (
      room_id, user_id, kind, seat, team_id, player_index, is_ready, connected
    ) VALUES (
      v_room.id, v_opponent.user_id, 'human', v_seat, v_team, 0, true, true
    );

    SELECT seat, team_id INTO v_seat, v_team
    FROM public.resolve_one_vs_one_seat_assignment(1);

    INSERT INTO public.one_vs_one_players (
      room_id, user_id, kind, seat, team_id, player_index, is_ready, connected
    ) VALUES (
      v_room.id, v_user_id, 'human', v_seat, v_team, 1, true, true
    );

    UPDATE public.one_vs_one_matchmaking_queue
    SET status = 'matched',
        matched_room_id = v_room.id,
        ended_at = now()
    WHERE user_id = v_opponent.user_id;

    INSERT INTO public.one_vs_one_matchmaking_queue (
      user_id,
      status,
      matched_room_id,
      ended_at,
      bet_amount
    ) VALUES (
      v_user_id,
      'matched',
      v_room.id,
      now(),
      p_bet_amount
    );

    INSERT INTO public.one_vs_one_moves (
      room_id, player_id, sequence, action, payload
    ) VALUES (
      v_room.id,
      v_user_id,
      public.next_one_vs_one_move_sequence(v_room.id),
      'paid_match_created',
      jsonb_build_object(
        'player_1', v_opponent.user_id,
        'player_2', v_user_id,
        'bet_amount', p_bet_amount,
        'aznif_betting', true
      )
    );

    RETURN jsonb_build_object(
      'status', 'matched',
      'room_id', v_room.id,
      'room_code', v_room.room_code,
      'opponent_user_id', v_opponent.user_id,
      'bet_amount', p_bet_amount
    );
  END IF;

  INSERT INTO public.one_vs_one_matchmaking_queue (user_id, status, bet_amount)
  VALUES (v_user_id, 'searching', p_bet_amount);

  RETURN jsonb_build_object('status', 'searching', 'bet_amount', p_bet_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_one_vs_one_bet(p_room_id uuid)
RETURNS TABLE(
  settlement_id uuid,
  winner_user_id uuid,
  loser_user_id uuid,
  bet_amount numeric,
  winner_payout numeric,
  burned_amount numeric,
  already_settled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_winning_team text;
  v_winner public.one_vs_one_players%ROWTYPE;
  v_loser public.one_vs_one_players%ROWTYPE;
  v_existing public.one_vs_one_bet_settlements%ROWTYPE;
  v_inserted public.one_vs_one_bet_settlements%ROWTYPE;
  v_winner_before numeric;
  v_winner_after numeric;
  v_loser_before numeric;
  v_loser_after numeric;
  v_winner_payout numeric;
  v_burned_amount numeric;
BEGIN
  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.bet_amount <= 0
    OR COALESCE(v_room.metadata ->> 'aznif_betting', 'false') <> 'true'
  THEN
    RETURN;
  END IF;

  SELECT * INTO v_existing
  FROM public.one_vs_one_bet_settlements
  WHERE room_id = p_room_id;

  IF FOUND THEN
    settlement_id := v_existing.id;
    winner_user_id := v_existing.winner_user_id;
    loser_user_id := v_existing.loser_user_id;
    bet_amount := v_existing.bet_amount;
    winner_payout := v_existing.winner_payout;
    burned_amount := v_existing.burned_amount;
    already_settled := true;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_room.status <> 'finished' THEN
    RAISE EXCEPTION '1v1 match is not finished';
  END IF;

  v_winning_team := v_room.state ->> 'winningTeamId';

  IF v_winning_team NOT IN ('teamA', 'teamB') THEN
    RAISE EXCEPTION 'Finished 1v1 match has no winning team';
  END IF;

  SELECT * INTO v_winner
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND team_id = v_winning_team
    AND user_id IS NOT NULL
  ORDER BY player_index
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Winning player not found';
  END IF;

  SELECT * INTO v_loser
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND team_id <> v_winning_team
    AND user_id IS NOT NULL
  ORDER BY player_index
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Losing player not found';
  END IF;

  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (v_winner.user_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (v_loser.user_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM 1
  FROM public.wallets
  WHERE user_id IN (v_winner.user_id, v_loser.user_id)
  ORDER BY user_id
  FOR UPDATE;

  SELECT mc INTO v_loser_before
  FROM public.wallets
  WHERE user_id = v_loser.user_id;

  IF COALESCE(v_loser_before, 0) < v_room.bet_amount THEN
    RAISE EXCEPTION 'Insufficient MC balance';
  END IF;

  SELECT mc INTO v_winner_before
  FROM public.wallets
  WHERE user_id = v_winner.user_id;

  v_winner_payout := v_room.bet_amount * 0.93;
  v_burned_amount := v_room.bet_amount - v_winner_payout;
  v_loser_after := v_loser_before - v_room.bet_amount;
  v_winner_after := COALESCE(v_winner_before, 0) + v_winner_payout;

  INSERT INTO public.one_vs_one_bet_settlements (
    room_id,
    winner_user_id,
    loser_user_id,
    bet_amount,
    winner_payout,
    burned_amount
  ) VALUES (
    p_room_id,
    v_winner.user_id,
    v_loser.user_id,
    v_room.bet_amount,
    v_winner_payout,
    v_burned_amount
  )
  RETURNING * INTO v_inserted;

  UPDATE public.wallets
  SET mc = v_loser_after,
      updated_at = now()
  WHERE user_id = v_loser.user_id;

  UPDATE public.wallets
  SET mc = v_winner_after,
      updated_at = now()
  WHERE user_id = v_winner.user_id;

  INSERT INTO public.wallet_transactions (
    user_id,
    from_user_id,
    amount,
    currency,
    transaction_type,
    status,
    metadata,
    balance_before,
    balance_after
  ) VALUES (
    v_loser.user_id,
    v_loser.user_id,
    v_room.bet_amount,
    'MC',
    'bet_loss',
    'completed',
    jsonb_build_object('room_id', p_room_id, 'winner_user_id', v_winner.user_id, 'settlement_id', v_inserted.id),
    v_loser_before,
    v_loser_after
  );

  INSERT INTO public.wallet_transactions (
    user_id,
    to_user_id,
    amount,
    currency,
    transaction_type,
    status,
    metadata,
    balance_before,
    balance_after
  ) VALUES (
    v_winner.user_id,
    v_winner.user_id,
    v_winner_payout,
    'MC',
    'bet_win',
    'completed',
    jsonb_build_object('room_id', p_room_id, 'loser_user_id', v_loser.user_id, 'settlement_id', v_inserted.id),
    COALESCE(v_winner_before, 0),
    v_winner_after
  );

  INSERT INTO public.wallet_transactions (
    user_id,
    from_user_id,
    amount,
    currency,
    transaction_type,
    status,
    metadata,
    balance_before,
    balance_after
  ) VALUES (
    v_loser.user_id,
    v_loser.user_id,
    v_burned_amount,
    'MC',
    'bet_burn',
    'completed',
    jsonb_build_object('room_id', p_room_id, 'settlement_id', v_inserted.id, 'note', 'Aznif burned; no wallet credited'),
    v_loser_after,
    v_loser_after
  );

  settlement_id := v_inserted.id;
  winner_user_id := v_inserted.winner_user_id;
  loser_user_id := v_inserted.loser_user_id;
  bet_amount := v_inserted.bet_amount;
  winner_payout := v_inserted.winner_payout;
  burned_amount := v_inserted.burned_amount;
  already_settled := false;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_multiplayer_action(
  p_mode text,
  p_room_id uuid,
  p_expected_version bigint,
  p_state jsonb,
  p_hands jsonb,
  p_boneyard jsonb,
  p_current_turn_player_id uuid,
  p_status text,
  p_player_id uuid,
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room jsonb;
  v_sequence bigint;
  v_effective_status text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  IF p_mode = '1v1' THEN
    UPDATE public.one_vs_one_rooms
    SET state = p_state,
        version = version + 1,
        current_turn_player_id = p_current_turn_player_id,
        status = COALESCE(p_status, status),
        updated_at = now()
    WHERE id = p_room_id AND version = p_expected_version
    RETURNING to_jsonb(one_vs_one_rooms.*), status INTO v_room, v_effective_status;

    IF NOT FOUND THEN RAISE EXCEPTION 'STALE_GAME_STATE'; END IF;

    INSERT INTO public.one_vs_one_private_states(room_id, hands, boneyard)
    VALUES (p_room_id, p_hands, p_boneyard)
    ON CONFLICT (room_id) DO UPDATE
    SET hands = EXCLUDED.hands, boneyard = EXCLUDED.boneyard, updated_at = now();

    v_sequence := public.next_one_vs_one_move_sequence(p_room_id);
    INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
    VALUES (p_room_id, p_player_id, v_sequence, p_action, COALESCE(p_payload, '{}'::jsonb));
  ELSIF p_mode = '2v2' THEN
    UPDATE public.two_vs_two_rooms
    SET state = p_state,
        version = version + 1,
        current_turn_player_id = p_current_turn_player_id,
        status = COALESCE(p_status, status),
        updated_at = now()
    WHERE id = p_room_id AND version = p_expected_version
    RETURNING to_jsonb(two_vs_two_rooms.*), status INTO v_room, v_effective_status;

    IF NOT FOUND THEN RAISE EXCEPTION 'STALE_GAME_STATE'; END IF;

    INSERT INTO public.two_vs_two_private_states(room_id, hands, boneyard)
    VALUES (p_room_id, p_hands, p_boneyard)
    ON CONFLICT (room_id) DO UPDATE
    SET hands = EXCLUDED.hands, boneyard = EXCLUDED.boneyard, updated_at = now();

    v_sequence := public.next_two_vs_two_move_sequence(p_room_id);
    INSERT INTO public.two_vs_two_moves(room_id, player_id, sequence, action, payload)
    VALUES (p_room_id, p_player_id, v_sequence, p_action, COALESCE(p_payload, '{}'::jsonb));
  ELSE
    RAISE EXCEPTION 'Invalid game mode';
  END IF;

  IF v_effective_status = 'finished' THEN
    PERFORM public.settle_finished_match_rewards(p_mode, p_room_id);
    IF p_mode = '1v1' THEN
      PERFORM public.settle_one_vs_one_bet(p_room_id);
    END IF;
  END IF;

  RETURN v_room;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_one_vs_one_round_leave_forfeits(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player public.one_vs_one_players%ROWTYPE;
  v_winning_team text;
  v_state jsonb;
BEGIN
  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.status <> 'active' THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  SELECT * INTO v_player
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND bot_takeover = true
    AND connected = false
    AND abandoned = false
  ORDER BY takeover_started_at ASC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  v_winning_team := CASE WHEN v_player.team_id = 'teamA' THEN 'teamB' ELSE 'teamA' END;
  v_state := COALESCE(v_room.state, '{}'::jsonb)
    || jsonb_build_object(
      'winningTeamId', v_winning_team,
      'forfeitByPlayerId', v_player.user_id,
      'forfeitReason', 'left_until_round_end',
      'canDrawTile', false
    );

  UPDATE public.one_vs_one_players
  SET abandoned = true,
      connected = false,
      bot_takeover = true,
      updated_at = now()
  WHERE id = v_player.id;

  UPDATE public.one_vs_one_rooms
  SET status = 'finished',
      state = v_state,
      current_turn_player_id = NULL,
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id;

  INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_player.user_id,
    public.next_one_vs_one_move_sequence(p_room_id),
    'round_end_leave_forfeit',
    jsonb_build_object('user_id', v_player.user_id, 'team_id', v_player.team_id, 'winner_team', v_winning_team)
  );

  PERFORM public.settle_finished_match_rewards('1v1', p_room_id);
  PERFORM public.settle_one_vs_one_bet(p_room_id);

  RETURN jsonb_build_object('forfeit', true, 'winner_team', v_winning_team);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_one_vs_one_room(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_leaver public.one_vs_one_players%ROWTYPE;
  v_winning_team text;
  v_state jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  SELECT * INTO v_leaver
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a player in this 1v1 room';
  END IF;

  UPDATE public.one_vs_one_players
  SET connected = false,
      left_at = now(),
      updated_at = now()
  WHERE id = v_leaver.id;

  IF v_room.status = 'active' THEN
    v_winning_team := CASE WHEN v_leaver.team_id = 'teamA' THEN 'teamB' ELSE 'teamA' END;
    v_state := COALESCE(v_room.state, '{}'::jsonb)
      || jsonb_build_object(
        'winningTeamId', v_winning_team,
        'forfeitByPlayerId', v_user_id,
        'matchReward', jsonb_build_object('tier', 'normal', 'gold', 6, 'points', 20),
        'canDrawTile', false
      );

    UPDATE public.one_vs_one_rooms
    SET status = 'finished',
        state = v_state,
        current_turn_player_id = NULL,
        version = version + 1,
        updated_at = now()
    WHERE id = p_room_id;

    PERFORM public.settle_finished_match_rewards('1v1', p_room_id);
    PERFORM public.settle_one_vs_one_bet(p_room_id);
  ELSE
    UPDATE public.one_vs_one_rooms
    SET status = 'cancelled',
        version = version + 1,
        updated_at = now()
    WHERE id = p_room_id;
  END IF;

  INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_user_id,
    public.next_one_vs_one_move_sequence(p_room_id),
    CASE WHEN v_room.status = 'active' THEN 'player_forfeited' ELSE 'room_cancelled' END,
    jsonb_build_object('user_id', v_user_id, 'previous_status', v_room.status)
  );

  RETURN jsonb_build_object('status', 'success', 'room_id', p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_one_vs_one_abandonments_and_forfeits(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player public.one_vs_one_players%ROWTYPE;
  v_winning_team text;
  v_state jsonb;
BEGIN
  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.status <> 'active' THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  SELECT * INTO v_player
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND bot_takeover = true
    AND abandoned = false
  ORDER BY takeover_started_at ASC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  v_winning_team := CASE WHEN v_player.team_id = 'teamA' THEN 'teamB' ELSE 'teamA' END;
  v_state := COALESCE(v_room.state, '{}'::jsonb)
    || jsonb_build_object(
      'winningTeamId', v_winning_team,
      'forfeitByPlayerId', v_player.user_id,
      'forfeitReason', 'abandoned',
      'matchReward', jsonb_build_object('tier', 'normal', 'gold', 6, 'points', 20),
      'canDrawTile', false
    );

  UPDATE public.one_vs_one_players
  SET abandoned = true,
      connected = false,
      updated_at = now()
  WHERE id = v_player.id;

  UPDATE public.one_vs_one_rooms
  SET status = 'finished',
      state = v_state,
      current_turn_player_id = NULL,
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id;

  INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_player.user_id,
    public.next_one_vs_one_move_sequence(p_room_id),
    'player_abandoned_forfeit',
    jsonb_build_object('user_id', v_player.user_id, 'team_id', v_player.team_id, 'winner_team', v_winning_team)
  );

  PERFORM public.settle_finished_match_rewards('1v1', p_room_id);
  PERFORM public.settle_one_vs_one_bet(p_room_id);

  RETURN jsonb_build_object('forfeit', true, 'winner_team', v_winning_team);
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_one_vs_one_bet_match(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_one_vs_one_bet(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_one_vs_one_room(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_one_vs_one_room(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_one_vs_one_opponent() TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_multiplayer_action(
  text, uuid, bigint, jsonb, jsonb, jsonb, uuid, text, uuid, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_one_vs_one_round_leave_forfeits(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_one_vs_one_room(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_one_vs_one_abandonments_and_forfeits(uuid) TO authenticated;
