CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested_username text;
  v_username text;
  v_avatar_url text;
BEGIN
  v_requested_username := NULLIF(
    trim(NEW.raw_user_meta_data->>'username'),
    ''
  );

  v_username := COALESCE(
    v_requested_username,
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'name'), '')
  );

  v_avatar_url := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'avatar_url'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'picture'), '')
  );

  INSERT INTO public.profiles (
    email,
    player_id,
    username,
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
    avatar_id = COALESCE(public.profiles.avatar_id, EXCLUDED.avatar_id),
    avatar_url = COALESCE(
      public.profiles.avatar_url,
      EXCLUDED.avatar_url
    ),
    updated_at = now();

  RETURN NEW;
END;
$$;