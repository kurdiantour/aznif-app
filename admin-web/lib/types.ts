export type AdminPlayer = {
  user_id: string;
  email: string | null;
  player_id: string;
  username: string;
  avatar_id: string;
  points: number;
  games_played: number;
  games_won: number;
  games_lost: number;
  aznif: number;
  gold: number;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};
