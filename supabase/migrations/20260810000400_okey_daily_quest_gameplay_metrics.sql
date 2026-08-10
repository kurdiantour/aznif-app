-- Server-authoritative Okey gameplay metrics for configurable Daily Quests.
-- The Edge Function derives events only from a command accepted by the Okey
-- engine. The wrapper below commits game state and applies those events in the
-- same database transaction.

ALTER TABLE public.daily_quest_definitions
  DROP CONSTRAINT IF EXISTS daily_quest_definitions_metric_check;

UPDATE public.daily_quest_definitions
SET metric = 'okey_match_completed'
WHERE game_type = 'okey' AND metric = 'match_completed';

UPDATE public.daily_quest_definitions
SET metric = 'okey_match_won'
WHERE game_type = 'okey' AND metric = 'match_won';

ALTER TABLE public.daily_quest_definitions
  ADD CONSTRAINT daily_quest_definitions_metric_check CHECK (
    (game_type = 'domino' AND metric IN ('match_completed', 'match_won'))
    OR
    (game_type = 'okey' AND metric IN (
      'okey_match_completed',
      'okey_match_won',
      'okey_konkan_entered',
      'okey_konkan_won',
      'okey_joker_stolen',
      'okey_meld_opened',
      'okey_opened_with_130_plus_points',
      'okey_tile_spent_on_meld'
    ))
  );

INSERT INTO public.daily_quest_definitions(code, game_type, metric)
VALUES
  ('okey_konkan_entered', 'okey', 'okey_konkan_entered'),
  ('okey_konkan_won', 'okey', 'okey_konkan_won'),
  ('okey_joker_stolen', 'okey', 'okey_joker_stolen'),
  ('okey_meld_opened', 'okey', 'okey_meld_opened'),
  ('okey_opened_with_130_plus_points', 'okey', 'okey_opened_with_130_plus_points'),
  ('okey_tile_spent_on_meld', 'okey', 'okey_tile_spent_on_meld')
ON CONFLICT (code) DO UPDATE SET
  game_type = EXCLUDED.game_type,
  metric = EXCLUDED.metric;

CREATE TABLE public.daily_quest_gameplay_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quest_date date NOT NULL,
  game_type text NOT NULL CHECK (game_type = 'okey'),
  match_id uuid NOT NULL,
  command_id uuid NOT NULL,
  metric text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  source_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.daily_quest_gameplay_applications (
  event_id uuid NOT NULL REFERENCES public.daily_quest_gameplay_events(id) ON DELETE CASCADE,
  quest_instance_id uuid NOT NULL REFERENCES public.daily_quest_instances(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (event_id, quest_instance_id)
);

CREATE INDEX daily_quest_gameplay_events_user_date_idx
  ON public.daily_quest_gameplay_events(user_id, quest_date, occurred_at DESC);

ALTER TABLE public.daily_quest_gameplay_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_quest_gameplay_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_quest_gameplay_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.daily_quest_gameplay_applications FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_authoritative_okey_gameplay_events(
  p_match_id uuid,
  p_command_id uuid,
  p_events jsonb,
  p_occurred_at timestamptz DEFAULT clock_timestamp()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, okey, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_user_id uuid;
  v_metric text;
  v_amount integer;
  v_source_key text;
  v_metadata jsonb;
  v_event_id uuid;
  v_quest_date date := (p_occurred_at AT TIME ZONE 'Asia/Baghdad')::date;
  v_instance record;
BEGIN
  IF p_match_id IS NULL OR p_command_id IS NULL
    OR jsonb_typeof(COALESCE(p_events, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_events, '[]'::jsonb)) > 32 THEN
    RAISE EXCEPTION 'invalid_okey_gameplay_events';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_events, '[]'::jsonb))
  LOOP
    BEGIN
      v_user_id := (v_item ->> 'userId')::uuid;
      v_metric := v_item ->> 'metric';
      v_amount := (v_item ->> 'amount')::integer;
      v_source_key := v_item ->> 'sourceKey';
      v_metadata := COALESCE(v_item -> 'metadata', '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_okey_gameplay_event';
    END;

    IF v_metric NOT IN (
      'okey_match_completed', 'okey_match_won', 'okey_konkan_entered',
      'okey_konkan_won', 'okey_joker_stolen', 'okey_meld_opened',
      'okey_opened_with_130_plus_points',
      'okey_tile_spent_on_meld'
    ) OR v_amount NOT BETWEEN 1 AND 100
      OR v_source_key IS NULL
      OR jsonb_typeof(v_metadata) <> 'object'
      OR (
        v_metric = 'okey_opened_with_130_plus_points'
        AND (
          COALESCE(jsonb_typeof(v_metadata -> 'score'), 'null') <> 'number'
          OR COALESCE((v_metadata ->> 'score')::numeric, 0) < 130
        )
      )
      OR split_part(v_source_key, ':', 1) <> p_command_id::text
      OR NOT EXISTS (
        SELECT 1 FROM okey.match_seats AS seat
        WHERE seat.match_id = p_match_id AND seat.user_id = v_user_id
      ) THEN
      RAISE EXCEPTION 'invalid_okey_gameplay_event';
    END IF;

    v_event_id := NULL;
    INSERT INTO public.daily_quest_gameplay_events(
      user_id, quest_date, game_type, match_id, command_id,
      metric, amount, source_key, metadata, occurred_at
    ) VALUES (
      v_user_id, v_quest_date, 'okey', p_match_id, p_command_id,
      v_metric, v_amount, v_source_key, v_metadata, p_occurred_at
    )
    ON CONFLICT (source_key) DO NOTHING
    RETURNING id INTO v_event_id;

    IF v_event_id IS NULL THEN CONTINUE; END IF;

    FOR v_instance IN
      SELECT instance.id, instance.target
      FROM public.daily_quest_instances AS instance
      JOIN public.daily_quest_definitions AS definition
        ON definition.id = instance.definition_id
      WHERE instance.quest_date = v_quest_date
        AND instance.active AND definition.enabled
        AND definition.game_type = 'okey'
        AND definition.metric = v_metric
      ORDER BY instance.sort_order
    LOOP
      INSERT INTO public.daily_quest_gameplay_applications(
        event_id, quest_instance_id, user_id
      ) VALUES (v_event_id, v_instance.id, v_user_id)
      ON CONFLICT DO NOTHING;

      IF FOUND THEN
        INSERT INTO public.daily_quest_progress_v2(
          user_id, quest_instance_id, progress, completed_at
        ) VALUES (
          v_user_id, v_instance.id, LEAST(v_instance.target, v_amount),
          CASE WHEN v_amount >= v_instance.target THEN p_occurred_at ELSE NULL END
        )
        ON CONFLICT (user_id, quest_instance_id) DO UPDATE
          SET progress = LEAST(
                v_instance.target,
                daily_quest_progress_v2.progress + v_amount
              ),
              completed_at = CASE
                WHEN daily_quest_progress_v2.progress + v_amount >= v_instance.target
                  THEN COALESCE(daily_quest_progress_v2.completed_at, p_occurred_at)
                ELSE daily_quest_progress_v2.completed_at
              END,
              updated_at = clock_timestamp();
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.record_authoritative_okey_gameplay_events(
  uuid, uuid, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated;

-- The old status trigger could count non-command updates. Okey progress now
-- comes exclusively from accepted authoritative command commits.
DROP TRIGGER IF EXISTS capture_okey_daily_quest_progress ON okey.matches;

CREATE OR REPLACE FUNCTION public.okey_commit_authoritative_command_with_events(
  p_match_id uuid,
  p_user_id uuid,
  p_command_id uuid,
  p_expected_version bigint,
  p_command_type text,
  p_state jsonb,
  p_projection jsonb,
  p_status text,
  p_turn_deadline_at timestamptz,
  p_gameplay_events jsonb
)
RETURNS TABLE (
  applied boolean,
  version bigint,
  state jsonb,
  turn_deadline_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, okey, pg_temp
AS $$
DECLARE
  v_result record;
BEGIN
  SELECT committed.applied, committed.version, committed.state,
         committed.turn_deadline_at
  INTO v_result
  FROM public.okey_commit_authoritative_command(
    p_match_id, p_user_id, p_command_id, p_expected_version,
    p_command_type, p_state, p_projection, p_status, p_turn_deadline_at
  ) AS committed;

  IF v_result.applied THEN
    PERFORM public.record_authoritative_okey_gameplay_events(
      p_match_id, p_command_id, COALESCE(p_gameplay_events, '[]'::jsonb),
      clock_timestamp()
    );
  END IF;

  RETURN QUERY SELECT v_result.applied, v_result.version, v_result.state,
                      v_result.turn_deadline_at;
END;
$$;

REVOKE ALL ON FUNCTION public.okey_commit_authoritative_command_with_events(
  uuid, uuid, uuid, bigint, text, jsonb, jsonb, text, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.okey_commit_authoritative_command_with_events(
  uuid, uuid, uuid, bigint, text, jsonb, jsonb, text, timestamptz, jsonb
) TO service_role;
