-- Configurable Daily Quest pool. This additive migration preserves the v1
-- progress/event tables for audit and moves future events to the v2 model.

CREATE TABLE IF NOT EXISTS public.daily_quest_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]+$'),
  game_type text NOT NULL CHECK (game_type IN ('domino', 'okey')),
  metric text NOT NULL CHECK (metric IN ('match_completed', 'match_won')),
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Each row is a dated snapshot. The same pool definition can be activated on
-- another date with different copy, target, reward and position.
CREATE TABLE IF NOT EXISTS public.daily_quest_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_date date NOT NULL,
  definition_id uuid NOT NULL
    REFERENCES public.daily_quest_definitions(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  description text,
  target integer NOT NULL CHECK (target > 0),
  reward_type text NOT NULL CHECK (reward_type IN ('coin', 'gem', 'mc')),
  reward_amount numeric NOT NULL CHECK (reward_amount > 0),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quest_date, definition_id),
  UNIQUE (quest_date, sort_order)
);

CREATE TABLE IF NOT EXISTS public.daily_quest_match_events_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quest_date date NOT NULL,
  game_type text NOT NULL CHECK (game_type IN ('domino', 'okey')),
  match_id uuid NOT NULL,
  won boolean NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_type, match_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.daily_quest_progress_v2 (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quest_instance_id uuid NOT NULL
    REFERENCES public.daily_quest_instances(id) ON DELETE CASCADE,
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, quest_instance_id)
);

CREATE TABLE IF NOT EXISTS public.daily_quest_event_applications (
  event_id uuid NOT NULL
    REFERENCES public.daily_quest_match_events_v2(id) ON DELETE CASCADE,
  quest_instance_id uuid NOT NULL
    REFERENCES public.daily_quest_instances(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, quest_instance_id)
);

CREATE INDEX IF NOT EXISTS daily_quest_instances_active_date_order_idx
  ON public.daily_quest_instances(quest_date, sort_order) WHERE active;
CREATE INDEX IF NOT EXISTS daily_quest_progress_v2_user_idx
  ON public.daily_quest_progress_v2(user_id, quest_instance_id);
CREATE INDEX IF NOT EXISTS daily_quest_events_v2_user_date_idx
  ON public.daily_quest_match_events_v2(user_id, quest_date, created_at DESC);

ALTER TABLE public.daily_quest_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_quest_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_quest_match_events_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_quest_progress_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_quest_event_applications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.daily_quest_definitions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.daily_quest_instances FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.daily_quest_match_events_v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.daily_quest_progress_v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.daily_quest_event_applications FROM PUBLIC, anon, authenticated;

-- Seed pool capabilities only. No dated daily schedule is hardcoded.
INSERT INTO public.daily_quest_definitions(code, game_type, metric)
VALUES
  ('domino_match_completed', 'domino', 'match_completed'),
  ('okey_match_completed', 'okey', 'match_completed'),
  ('okey_match_won', 'okey', 'match_won')
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.record_authoritative_daily_quest_match(
  p_game_type text,
  p_match_id uuid,
  p_user_id uuid,
  p_won boolean,
  p_completed_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_quest_date date;
  v_event_id uuid;
  v_instance record;
BEGIN
  IF p_game_type NOT IN ('domino', 'okey')
    OR p_match_id IS NULL OR p_user_id IS NULL OR p_completed_at IS NULL THEN
    RAISE EXCEPTION 'invalid_daily_quest_match_event';
  END IF;

  v_quest_date := (p_completed_at AT TIME ZONE 'Asia/Baghdad')::date;
  INSERT INTO public.daily_quest_match_events_v2(
    user_id, quest_date, game_type, match_id, won, completed_at
  ) VALUES (
    p_user_id, v_quest_date, p_game_type, p_match_id,
    COALESCE(p_won, false), p_completed_at
  )
  ON CONFLICT (game_type, match_id, user_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN RETURN; END IF;

  FOR v_instance IN
    SELECT instance.id, instance.target
    FROM public.daily_quest_instances AS instance
    JOIN public.daily_quest_definitions AS definition
      ON definition.id = instance.definition_id
    WHERE instance.quest_date = v_quest_date
      AND instance.active AND definition.enabled
      AND definition.game_type = p_game_type
      AND (definition.metric = 'match_completed'
        OR (definition.metric = 'match_won' AND COALESCE(p_won, false)))
    ORDER BY instance.sort_order
  LOOP
    INSERT INTO public.daily_quest_event_applications(
      event_id, quest_instance_id, user_id
    ) VALUES (v_event_id, v_instance.id, p_user_id)
    ON CONFLICT DO NOTHING;

    IF FOUND THEN
      INSERT INTO public.daily_quest_progress_v2(
        user_id, quest_instance_id, progress, completed_at
      ) VALUES (
        p_user_id, v_instance.id, 1,
        CASE WHEN v_instance.target <= 1 THEN p_completed_at ELSE NULL END
      )
      ON CONFLICT (user_id, quest_instance_id) DO UPDATE
        SET progress = LEAST(
              v_instance.target,
              daily_quest_progress_v2.progress + 1
            ),
            completed_at = CASE
              WHEN daily_quest_progress_v2.progress + 1 >= v_instance.target
                THEN COALESCE(daily_quest_progress_v2.completed_at, p_completed_at)
              ELSE daily_quest_progress_v2.completed_at
            END,
            updated_at = now();
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.record_authoritative_daily_quest_match(
  text, uuid, uuid, boolean, timestamptz
) FROM PUBLIC, anon, authenticated;

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

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'instanceId', instance.id,
      'definitionCode', definition.code,
      'gameType', definition.game_type,
      'metric', definition.metric,
      'title', instance.title,
      'description', instance.description,
      'target', instance.target,
      'progress', LEAST(instance.target, COALESCE(progress.progress, 0)),
      'completed', COALESCE(progress.progress, 0) >= instance.target,
      'rewardType', instance.reward_type,
      'rewardAmount', instance.reward_amount,
      'sortOrder', instance.sort_order
    ) ORDER BY instance.sort_order
  ), '[]'::jsonb) INTO v_quests
  FROM public.daily_quest_instances AS instance
  JOIN public.daily_quest_definitions AS definition
    ON definition.id = instance.definition_id
  LEFT JOIN public.daily_quest_progress_v2 AS progress
    ON progress.quest_instance_id = instance.id AND progress.user_id = v_user_id
  WHERE instance.quest_date = v_today
    AND instance.active AND definition.enabled;

  RETURN jsonb_build_object(
    'serverDate', v_today,
    'nextResetAt', ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Baghdad'),
    'quests', v_quests
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_quests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_quests() TO authenticated;

-- Repoint future authoritative events. Existing v1 data remains untouched.
DROP TRIGGER IF EXISTS capture_one_vs_one_daily_quest_progress
  ON public.one_vs_one_rooms;
DROP TRIGGER IF EXISTS capture_two_vs_two_daily_quest_progress
  ON public.two_vs_two_rooms;
DROP TRIGGER IF EXISTS capture_okey_daily_quest_progress ON okey.matches;

CREATE OR REPLACE FUNCTION public.capture_domino_daily_quest_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player record;
  v_winning_team text := NEW.state ->> 'winningTeamId';
BEGIN
  IF NEW.status <> 'finished' OR OLD.status = 'finished'
    OR v_winning_team NOT IN ('teamA', 'teamB') THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'one_vs_one_rooms' THEN
    FOR v_player IN SELECT user_id, team_id FROM public.one_vs_one_players
      WHERE room_id = NEW.id AND user_id IS NOT NULL AND kind = 'human'
    LOOP
      PERFORM public.record_authoritative_daily_quest_match(
        'domino', NEW.id, v_player.user_id,
        v_player.team_id = v_winning_team, NEW.updated_at);
    END LOOP;
  ELSE
    FOR v_player IN SELECT user_id, team_id FROM public.two_vs_two_players
      WHERE room_id = NEW.id AND user_id IS NOT NULL AND kind = 'human'
    LOOP
      PERFORM public.record_authoritative_daily_quest_match(
        'domino', NEW.id, v_player.user_id,
        v_player.team_id = v_winning_team, NEW.updated_at);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_domino_daily_quest_progress()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER capture_one_vs_one_daily_quest_progress
AFTER UPDATE OF status ON public.one_vs_one_rooms
FOR EACH ROW EXECUTE FUNCTION public.capture_domino_daily_quest_progress();
CREATE TRIGGER capture_two_vs_two_daily_quest_progress
AFTER UPDATE OF status ON public.two_vs_two_rooms
FOR EACH ROW EXECUTE FUNCTION public.capture_domino_daily_quest_progress();

CREATE OR REPLACE FUNCTION public.capture_okey_daily_quest_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, okey, pg_temp
AS $$
DECLARE
  v_seat record;
  v_winning_team text := NEW.settlement ->> 'winnerTeamId';
BEGIN
  IF NEW.status <> 'finished' OR OLD.status = 'finished'
    OR v_winning_team NOT IN ('teamA', 'teamB') THEN RETURN NEW; END IF;
  FOR v_seat IN SELECT user_id, team_id FROM okey.match_seats
    WHERE match_id = NEW.id AND user_id IS NOT NULL
  LOOP
    PERFORM public.record_authoritative_daily_quest_match(
      'okey', NEW.id, v_seat.user_id,
      v_seat.team_id = v_winning_team,
      COALESCE(NEW.finished_at, NEW.updated_at, now()));
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_okey_daily_quest_progress()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER capture_okey_daily_quest_progress
AFTER UPDATE OF status ON okey.matches
FOR EACH ROW EXECUTE FUNCTION public.capture_okey_daily_quest_progress();
