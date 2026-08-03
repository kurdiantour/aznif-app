ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS full_name text,
ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE INDEX IF NOT EXISTS idx_profiles_avatar_url
ON public.profiles (avatar_url)
WHERE avatar_url IS NOT NULL;

CREATE OR REPLACE FUNCTION public.profile_username_from_auth_user(
  p_user_id uuid,
  p_full_name text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_base text;
  v_candidate text;
  v_attempt integer := 0;
BEGIN
  v_base := lower(regexp_replace(coalesce(nullif(trim(p_full_name), ''), ''), '[^a-z0-9_]+', '_', 'g'));
  v_base := trim(both '_' from left(v_base, 18));

  IF v_base IS NULL OR v_base = '' THEN
    v_base := 'user_' || substring(p_user_id::text from 1 for 8);
  END IF;

  LOOP
    v_candidate := CASE
      WHEN v_attempt = 0 THEN v_base
      ELSE left(v_base, 18) || '_' || substring(p_user_id::text from 1 for 4) || '_' || (v_attempt + 1)::text
    END;

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE username = v_candidate
        AND id <> p_user_id
    );

    v_attempt := v_attempt + 1;
  END LOOP;

  RETURN v_candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_avatar_url text;
  v_username text;
BEGIN
  v_full_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'name'), '')
  );
  v_avatar_url := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'avatar_url'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'picture'), '')
  );
  v_username := public.profile_username_from_auth_user(NEW.id, v_full_name);

  INSERT INTO public.profiles (
    email,
    player_id,
    username,
    full_name,
    avatar_id,
    avatar_url,
    id,
    level,
    points,
    created_at,
    updated_at
  )
  VALUES (
    NEW.email,
    public.generate_player_id(),
    v_username,
    v_full_name,
    'avatar-1',
    v_avatar_url,
    NEW.id,
    1,
    0,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    player_id = COALESCE(public.profiles.player_id, EXCLUDED.player_id),
    username = COALESCE(public.profiles.username, EXCLUDED.username),
    full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
    avatar_id = COALESCE(public.profiles.avatar_id, EXCLUDED.avatar_id),
    avatar_url = COALESCE(public.profiles.avatar_url, EXCLUDED.avatar_url),
    updated_at = now();

  RETURN NEW;
END;
$$;

GRANT UPDATE (username, avatar_id, avatar_url) ON public.profiles TO authenticated;

DROP FUNCTION IF EXISTS public.get_leaderboard(int);

CREATE OR REPLACE FUNCTION public.get_leaderboard(p_limit int DEFAULT 50)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  avatar_id text,
  avatar_url text,
  level integer,
  points integer,
  rank bigint,
  aznif numeric,
  gold numeric
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  WITH ranked_profiles AS (
    SELECT
      p.id,
      COALESCE(NULLIF(p.full_name, ''), p.username) AS display_name,
      p.avatar_id,
      p.avatar_url,
      COALESCE(p.points, 0) AS points,
      RANK() OVER (
        ORDER BY COALESCE(p.points, 0) DESC, p.created_at ASC, p.id ASC
      ) AS rank
    FROM public.profiles p
    WHERE p.leaderboard_visible = true
  )
  SELECT
    rp.id AS user_id,
    rp.display_name,
    rp.avatar_id,
    rp.avatar_url,
    LEAST(5, FLOOR(GREATEST(rp.points, 0) / 150)::int + 1) AS level,
    rp.points,
    rp.rank,
    COALESCE(w.mc, 0) AS aznif,
    COALESCE(w.gold, 0) AS gold
  FROM ranked_profiles rp
  LEFT JOIN public.wallets w ON w.user_id = rp.id
  ORDER BY rp.rank ASC, rp.points DESC, rp.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard(int) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';