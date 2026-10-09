-- Update the displayed progression ranks to five 150-point levels.
-- Points and leaderboard ordering remain unchanged.

CREATE OR REPLACE FUNCTION public.get_leaderboard(p_limit int DEFAULT 50)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  avatar_id text,
  level integer,
  points integer,
  rank bigint,
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
  )
  SELECT
    rp.id AS user_id,
    rp.username AS display_name,
    rp.avatar_id,
    LEAST(5, FLOOR(GREATEST(rp.points, 0) / 150)::int + 1) AS level,
    rp.points,
    rp.rank,
    COALESCE(w.gold, 0) AS gold
  FROM ranked_profiles rp
  LEFT JOIN public.wallets w ON w.user_id = rp.id
  ORDER BY rp.rank ASC, rp.points DESC, rp.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(int) TO authenticated, service_role;
