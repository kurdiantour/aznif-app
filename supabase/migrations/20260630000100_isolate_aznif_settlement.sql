-- Keep Aznif settlement failures isolated from match completion and the
-- existing Gold/Points reward settlement. The original settlement function
-- becomes the restricted executor; callers use the non-throwing wrapper.

ALTER FUNCTION public.settle_one_vs_one_bet(uuid)
RENAME TO execute_one_vs_one_bet_settlement;
REVOKE ALL ON FUNCTION public.execute_one_vs_one_bet_settlement(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_one_vs_one_bet_settlement(uuid)
TO service_role;
CREATE TABLE public.one_vs_one_bet_settlement_jobs (
  room_id uuid PRIMARY KEY REFERENCES public.one_vs_one_rooms(id) ON DELETE CASCADE,
  bet_amount numeric NOT NULL CHECK (bet_amount > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'settled', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  last_attempt_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.one_vs_one_bet_settlement_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "one_vs_one_bet_settlement_jobs_select_players"
ON public.one_vs_one_bet_settlement_jobs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.one_vs_one_players AS player
    WHERE player.room_id = one_vs_one_bet_settlement_jobs.room_id
      AND player.user_id = auth.uid()
  )
);
GRANT SELECT ON public.one_vs_one_bet_settlement_jobs TO authenticated;
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
  v_existing_status text;
BEGIN
  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  -- Free Lobby matches have no Aznif settlement and retain bet_amount = 0.
  IF v_room.bet_amount <= 0
    OR COALESCE(v_room.metadata ->> 'aznif_betting', 'false') <> 'true'
  THEN
    RETURN;
  END IF;

  SELECT job.status INTO v_existing_status
  FROM public.one_vs_one_bet_settlement_jobs AS job
  WHERE job.room_id = p_room_id;

  IF v_existing_status = 'settled' THEN
    RETURN QUERY
    SELECT settled.*
    FROM public.execute_one_vs_one_bet_settlement(p_room_id) AS settled;
    RETURN;
  END IF;

  INSERT INTO public.one_vs_one_bet_settlement_jobs (
    room_id, bet_amount, status, attempt_count, last_attempt_at, updated_at
  ) VALUES (
    p_room_id, v_room.bet_amount, 'processing', 1, now(), now()
  )
  ON CONFLICT (room_id) DO UPDATE
  SET status = 'processing',
      attempt_count = one_vs_one_bet_settlement_jobs.attempt_count + 1,
      last_error = NULL,
      last_attempt_at = now(),
      updated_at = now();

  BEGIN
    RETURN QUERY
    SELECT settled.*
    FROM public.execute_one_vs_one_bet_settlement(p_room_id) AS settled;

    UPDATE public.one_vs_one_bet_settlement_jobs
    SET status = 'settled',
        last_error = NULL,
        settled_at = now(),
        updated_at = now()
    WHERE room_id = p_room_id;
  EXCEPTION WHEN OTHERS THEN
    -- The exception block is a PostgreSQL subtransaction: partial Aznif wallet
    -- writes are rolled back, while match completion and Gold/Points survive.
    UPDATE public.one_vs_one_bet_settlement_jobs
    SET status = 'failed',
        last_error = SQLERRM,
        settled_at = NULL,
        updated_at = now()
    WHERE room_id = p_room_id;
    RETURN;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_one_vs_one_bet(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_one_vs_one_bet(uuid)
TO service_role;
CREATE OR REPLACE FUNCTION public.retry_one_vs_one_bet_settlement(p_room_id uuid)
RETURNS public.one_vs_one_bet_settlement_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.one_vs_one_bet_settlement_jobs%ROWTYPE;
BEGIN
  PERFORM public.settle_one_vs_one_bet(p_room_id);

  SELECT * INTO v_job
  FROM public.one_vs_one_bet_settlement_jobs
  WHERE room_id = p_room_id;

  RETURN v_job;
END;
$$;
REVOKE ALL ON FUNCTION public.retry_one_vs_one_bet_settlement(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_one_vs_one_bet_settlement(uuid)
TO service_role;
