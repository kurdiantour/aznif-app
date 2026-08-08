-- FINAL RESET profiles table for Domino app
-- WARNING: This drops public.profiles and recreates it.

DROP TRIGGER IF EXISTS trigger_handle_new_user ON auth.users;
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trigger_set_profiles_updated_at ON public.profiles;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.set_profiles_updated_at();
DROP FUNCTION IF EXISTS public.generate_player_id();
DROP TABLE IF EXISTS public.profiles;
CREATE TABLE public.profiles (
  email text,
  player_id text UNIQUE NOT NULL,
  username text UNIQUE NOT NULL,
  avatar_id text NOT NULL DEFAULT 'avatar-1',
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  level integer NOT NULL DEFAULT 1,
  points integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_profiles_email ON public.profiles (email);
CREATE INDEX idx_profiles_player_id ON public.profiles (player_id);
CREATE INDEX idx_profiles_username ON public.profiles (username);
CREATE INDEX idx_profiles_points ON public.profiles (points DESC);
CREATE INDEX idx_profiles_created_at ON public.profiles (created_at);
CREATE OR REPLACE FUNCTION public.generate_player_id()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_player_id text;
BEGIN
  LOOP
    v_player_id := 'DV-' || lpad(floor(random() * 1000000)::text, 6, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE player_id = v_player_id
    );
  END LOOP;

  RETURN v_player_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.set_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trigger_set_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_profiles_updated_at();
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
BEGIN
  v_username := 'user_' || substring(NEW.id::text from 1 for 8);

  INSERT INTO public.profiles (
    email,
    player_id,
    username,
    avatar_id,
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
    'avatar-1',
    NEW.id,
    1,
    0,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    player_id = COALESCE(public.profiles.player_id, EXCLUDED.player_id),
    username = COALESCE(public.profiles.username, EXCLUDED.username),
    avatar_id = COALESCE(public.profiles.avatar_id, EXCLUDED.avatar_id),
    updated_at = now();

  RETURN NEW;
END;
$$;
CREATE TRIGGER trigger_handle_new_user
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
INSERT INTO public.profiles (
  email,
  player_id,
  username,
  avatar_id,
  id,
  level,
  points,
  created_at,
  updated_at
)
SELECT
  u.email,
  public.generate_player_id(),
  'user_' || substring(u.id::text from 1 for 8),
  'avatar-1',
  u.id,
  1,
  0,
  now(),
  now()
FROM auth.users u
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  player_id = COALESCE(public.profiles.player_id, EXCLUDED.player_id),
  username = COALESCE(public.profiles.username, EXCLUDED.username),
  avatar_id = COALESCE(public.profiles.avatar_id, EXCLUDED.avatar_id),
  updated_at = now();
