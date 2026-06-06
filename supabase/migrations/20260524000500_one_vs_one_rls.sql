GRANT SELECT, INSERT, UPDATE ON public.one_vs_one_rooms TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.one_vs_one_players TO authenticated;
GRANT SELECT ON public.one_vs_one_moves TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_one_vs_one_room(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_one_vs_one_room(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_one_vs_one_game(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_one_vs_one_move_sequence(uuid) TO authenticated;

ALTER TABLE public.one_vs_one_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.one_vs_one_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.one_vs_one_moves ENABLE ROW LEVEL SECURITY;