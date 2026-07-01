ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS games_played integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS games_won integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS games_lost integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.record_finished_match_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_winning_team text := NEW.state ->> 'winningTeamId';
  v_players_table regclass := TG_ARGV[0]::regclass;
BEGIN
  IF v_winning_team NOT IN ('teamA', 'teamB')
     OR COALESCE(OLD.state ->> 'winningTeamId', '') IN ('teamA', 'teamB') THEN
    RETURN NEW;
  END IF;

  EXECUTE format(
    'UPDATE public.profiles p
       SET games_played = games_played + 1,
           games_won = games_won + CASE WHEN rp.team_id = $2 THEN 1 ELSE 0 END,
           games_lost = games_lost + CASE WHEN rp.team_id <> $2 THEN 1 ELSE 0 END
      FROM %s rp
     WHERE rp.room_id = $1 AND rp.kind = ''human'' AND rp.user_id = p.id',
    v_players_table
  ) USING NEW.id, v_winning_team;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_one_vs_one_match_stats ON public.one_vs_one_rooms;
CREATE TRIGGER record_one_vs_one_match_stats
AFTER UPDATE OF state ON public.one_vs_one_rooms
FOR EACH ROW EXECUTE FUNCTION public.record_finished_match_stats('public.one_vs_one_players');

DROP TRIGGER IF EXISTS record_two_vs_two_match_stats ON public.two_vs_two_rooms;
CREATE TRIGGER record_two_vs_two_match_stats
AFTER UPDATE OF state ON public.two_vs_two_rooms
FOR EACH ROW EXECUTE FUNCTION public.record_finished_match_stats('public.two_vs_two_players');

CREATE OR REPLACE FUNCTION public.get_public_player_card(p_player_id uuid)
RETURNS TABLE(
  username text,
  player_id text,
  avatar_id text,
  level integer,
  points integer,
  aznif numeric,
  gems numeric,
  games_played integer,
  games_won integer,
  games_lost integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.username, p.player_id, p.avatar_id, p.level, p.points,
         COALESCE(w.mc, 0), COALESCE(w.gold, 0),
         p.games_played, p.games_won, p.games_lost
  FROM public.profiles p
  LEFT JOIN public.wallets w ON w.user_id = p.id
  WHERE p.id = p_player_id;
$$;

REVOKE ALL ON FUNCTION public.get_public_player_card(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_player_card(uuid) TO authenticated;
