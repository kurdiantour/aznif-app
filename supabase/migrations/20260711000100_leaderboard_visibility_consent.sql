ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS leaderboard_visible boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles
ALTER COLUMN leaderboard_visible SET DEFAULT false;
UPDATE public.profiles
SET leaderboard_visible = false
WHERE leaderboard_visible = true;
GRANT UPDATE (leaderboard_visible) ON public.profiles TO authenticated;
CREATE OR REPLACE FUNCTION public.get_leaderboard(p_limit int DEFAULT 50)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  avatar_id text,
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
      p.username,
      p.avatar_id,
      COALESCE(p.points, 0) AS points,
      RANK() OVER (
        ORDER BY COALESCE(p.points, 0) DESC, p.created_at ASC, p.id ASC
      ) AS rank
    FROM public.profiles p
    WHERE p.leaderboard_visible = true
  )
  SELECT
    rp.id AS user_id,
    rp.username AS display_name,
    rp.avatar_id,
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
CREATE OR REPLACE FUNCTION public.get_my_leaderboard_rank()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  WITH ranked_profiles AS (
    SELECT
      p.id,
      RANK() OVER (
        ORDER BY COALESCE(p.points, 0) DESC, p.created_at ASC, p.id ASC
      ) AS rank
    FROM public.profiles p
    WHERE p.leaderboard_visible = true
  )
  SELECT rp.rank::integer
  FROM ranked_profiles rp
  WHERE rp.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_my_leaderboard_rank() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_leaderboard_rank() TO authenticated;
NOTIFY pgrst, 'reload schema';
