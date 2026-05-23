-- Multiplayer room permissions
-- Grants required access for realtime multiplayer system

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT ON public.game_rooms TO authenticated;
GRANT SELECT ON public.game_players TO authenticated;
GRANT SELECT ON public.game_moves TO authenticated;
GRANT SELECT ON public.matchmaking_queue TO authenticated;

GRANT INSERT ON public.game_rooms TO authenticated;
GRANT INSERT ON public.game_players TO authenticated;
GRANT INSERT ON public.matchmaking_queue TO authenticated;

GRANT UPDATE ON public.game_rooms TO authenticated;
GRANT UPDATE ON public.game_players TO authenticated;
GRANT UPDATE ON public.matchmaking_queue TO authenticated;

GRANT DELETE ON public.matchmaking_queue TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_room(text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_room(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_match_opponent(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_matchmaking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_matchmaking_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_game(uuid) TO authenticated;