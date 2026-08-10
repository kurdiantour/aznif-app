-- Server-authoritative progress for the three fixed Daily Quests.
-- Progress can only be written by triggers on authoritative finished matches.

CREATE TABLE IF NOT EXISTS public.daily_quest_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quest_date date NOT NULL,
  quest_key text NOT NULL CHECK (
    quest_key IN ('domino_complete_1', 'okey_complete_2', 'okey_win_1')
  ),
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, quest_date, quest_key)
);

-- One authoritative match may affect more than one quest, but it may only be
-- consumed once per player. This is the idempotency/audit boundary.
CREATE TABLE IF NOT EXISTS public.daily_quest_match_events (
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

CREATE INDEX IF NOT EXISTS daily_quest_progress_user_date_idx
  ON public.daily_quest_progress(user_id, quest_date);
CREATE INDEX IF NOT EXISTS daily_quest_match_events_user_date_idx
  ON public.daily_quest_match_events(user_id, quest_date, created_at DESC);

ALTER TABLE public.daily_quest_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_quest_match_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_quest_progress FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.daily_quest_match_events FROM PUBLIC, anon, authenticated;

-- Internal-only function. Triggers call it under the table owner's authority;
-- mobile clients receive no EXECUTE grant.
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
  v_inserted_id uuid;
BEGIN
  IF p_game_type NOT IN ('domino', 'okey')
    OR p_match_id IS NULL
    OR p_user_id IS NULL
    OR p_completed_at IS NULL THEN
    RAISE EXCEPTION 'invalid_daily_quest_match_event';
  END IF;

  v_quest_date := (p_completed_at AT TIME ZONE 'Asia/Baghdad')::date;

  INSERT INTO public.daily_quest_match_events(
    user_id, quest_date, game_type, match_id, won, completed_at
  ) VALUES (
    p_user_id, v_quest_date, p_game_type, p_match_id,
    COALESCE(p_won, false), p_completed_at
  )
  ON CONFLICT (game_type, match_id, user_id) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    RETURN;
  END IF;

  IF p_game_type = 'domino' THEN
    INSERT INTO public.daily_quest_progress(
      user_id, quest_date, quest_key, progress
    ) VALUES (
      p_user_id, v_quest_date, 'domino_complete_1', 1
    )
    ON CONFLICT (user_id, quest_date, quest_key) DO UPDATE
      SET progress = LEAST(1, daily_quest_progress.progress + 1),
          updated_at = now();
  ELSE
    INSERT INTO public.daily_quest_progress(
      user_id, quest_date, quest_key, progress
    ) VALUES (
      p_user_id, v_quest_date, 'okey_complete_2', 1
    )
    ON CONFLICT (user_id, quest_date, quest_key) DO UPDATE
      SET progress = LEAST(2, daily_quest_progress.progress + 1),
          updated_at = now();

    IF p_won THEN
      INSERT INTO public.daily_quest_progress(
        user_id, quest_date, quest_key, progress
      ) VALUES (
        p_user_id, v_quest_date, 'okey_win_1', 1
      )
      ON CONFLICT (user_id, quest_date, quest_key) DO UPDATE
        SET progress = LEAST(1, daily_quest_progress.progress + 1),
            updated_at = now();
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_authoritative_daily_quest_match(
  text, uuid, uuid, boolean, timestamptz
) FROM PUBLIC, anon, authenticated;

-- Read-only authenticated snapshot for the future client integration.
CREATE OR REPLACE FUNCTION public.get_daily_quests()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Baghdad')::date;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'serverDate', v_today,
    'nextResetAt', ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Baghdad'),
    'quests', jsonb_build_array(
      jsonb_build_object(
        'key', 'domino_complete_1',
        'progress', COALESCE((SELECT progress FROM public.daily_quest_progress
          WHERE user_id = v_user_id AND quest_date = v_today
            AND quest_key = 'domino_complete_1'), 0),
        'target', 1,
        'completed', COALESCE((SELECT progress FROM public.daily_quest_progress
          WHERE user_id = v_user_id AND quest_date = v_today
            AND quest_key = 'domino_complete_1'), 0) >= 1
      ),
      jsonb_build_object(
        'key', 'okey_complete_2',
        'progress', COALESCE((SELECT progress FROM public.daily_quest_progress
          WHERE user_id = v_user_id AND quest_date = v_today
            AND quest_key = 'okey_complete_2'), 0),
        'target', 2,
        'completed', COALESCE((SELECT progress FROM public.daily_quest_progress
          WHERE user_id = v_user_id AND quest_date = v_today
            AND quest_key = 'okey_complete_2'), 0) >= 2
      ),
      jsonb_build_object(
        'key', 'okey_win_1',
        'progress', COALESCE((SELECT progress FROM public.daily_quest_progress
          WHERE user_id = v_user_id AND quest_date = v_today
            AND quest_key = 'okey_win_1'), 0),
        'target', 1,
        'completed', COALESCE((SELECT progress FROM public.daily_quest_progress
          WHERE user_id = v_user_id AND quest_date = v_today
            AND quest_key = 'okey_win_1'), 0) >= 1
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_quests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_quests() TO authenticated;

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
  IF NEW.status <> 'finished'
    OR OLD.status = 'finished'
    OR v_winning_team NOT IN ('teamA', 'teamB') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'one_vs_one_rooms' THEN
    FOR v_player IN
      SELECT user_id, team_id FROM public.one_vs_one_players
      WHERE room_id = NEW.id AND user_id IS NOT NULL AND kind = 'human'
    LOOP
      PERFORM public.record_authoritative_daily_quest_match(
        'domino', NEW.id, v_player.user_id,
        v_player.team_id = v_winning_team, NEW.updated_at
      );
    END LOOP;
  ELSIF TG_TABLE_NAME = 'two_vs_two_rooms' THEN
    FOR v_player IN
      SELECT user_id, team_id FROM public.two_vs_two_players
      WHERE room_id = NEW.id AND user_id IS NOT NULL AND kind = 'human'
    LOOP
      PERFORM public.record_authoritative_daily_quest_match(
        'domino', NEW.id, v_player.user_id,
        v_player.team_id = v_winning_team, NEW.updated_at
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_domino_daily_quest_progress()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS capture_one_vs_one_daily_quest_progress
  ON public.one_vs_one_rooms;
CREATE TRIGGER capture_one_vs_one_daily_quest_progress
AFTER UPDATE OF status ON public.one_vs_one_rooms
FOR EACH ROW
EXECUTE FUNCTION public.capture_domino_daily_quest_progress();

DROP TRIGGER IF EXISTS capture_two_vs_two_daily_quest_progress
  ON public.two_vs_two_rooms;
CREATE TRIGGER capture_two_vs_two_daily_quest_progress
AFTER UPDATE OF status ON public.two_vs_two_rooms
FOR EACH ROW
EXECUTE FUNCTION public.capture_domino_daily_quest_progress();

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
  IF NEW.status <> 'finished'
    OR OLD.status = 'finished'
    OR v_winning_team NOT IN ('teamA', 'teamB') THEN
    RETURN NEW;
  END IF;

  FOR v_seat IN
    SELECT user_id, team_id FROM okey.match_seats
    WHERE match_id = NEW.id AND user_id IS NOT NULL
  LOOP
    PERFORM public.record_authoritative_daily_quest_match(
      'okey', NEW.id, v_seat.user_id,
      v_seat.team_id = v_winning_team,
      COALESCE(NEW.finished_at, NEW.updated_at, now())
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_okey_daily_quest_progress()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS capture_okey_daily_quest_progress ON okey.matches;
CREATE TRIGGER capture_okey_daily_quest_progress
AFTER UPDATE OF status ON okey.matches
FOR EACH ROW
EXECUTE FUNCTION public.capture_okey_daily_quest_progress();
