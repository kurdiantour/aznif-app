-- Keep the single 20-second Dama lobby clock: allow real matchmaking for
-- 15 seconds, assign a bot at 5 seconds remaining, and start at 0.
ALTER TABLE public.dama_bot_settings
  ALTER COLUMN wait_seconds SET DEFAULT 15;

UPDATE public.dama_bot_settings
SET wait_seconds = 15,
    updated_at = clock_timestamp()
WHERE singleton;
