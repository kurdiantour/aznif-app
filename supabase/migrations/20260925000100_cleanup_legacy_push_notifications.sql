-- Cleanup migration for legacy push notification system

-- Drop triggers that fed the legacy notification system
DROP TRIGGER IF EXISTS notification_game_invite ON public.game_invites;
DROP TRIGGER IF EXISTS notification_friend_invite ON public.friendships;
DROP TRIGGER IF EXISTS notification_okey_started ON okey.matches;
DROP TRIGGER IF EXISTS notification_domino1_started ON public.one_vs_one_rooms;
DROP TRIGGER IF EXISTS notification_domino2_started ON public.two_vs_two_rooms;

-- Drop legacy public functions related to campaigns and targets
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN (
   'notification_resolve_target',
   'notification_create_campaign',
   'notification_cancel_campaign',
   'notification_campaign_report',
   'notification_open',
   'notifications_authorize_worker',
   'notifications_prepare',
   'notifications_claim',
   'notifications_complete',
   'notifications_complete_batch'
 ) LOOP
 EXECUTE 'DROP FUNCTION ' || f.signature;
 END LOOP;
END $$;

-- Drop public legacy tables
DROP TABLE IF EXISTS public.user_notifications;
DROP TABLE IF EXISTS public.notification_campaigns;
DROP TABLE IF EXISTS public.notification_events;
DROP TABLE IF EXISTS public.notification_preferences;

-- Drop notification_private schema and all its objects (functions, tables)
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='notification_private' LOOP
 EXECUTE 'DROP FUNCTION ' || f.signature;
 END LOOP;
END $$;

DROP TABLE IF EXISTS notification_private.deliveries;
DROP TABLE IF EXISTS notification_private.outbox;
DROP TABLE IF EXISTS notification_private.campaign_recipients;
DROP TABLE IF EXISTS notification_private.audit_log;
DROP TABLE IF EXISTS notification_private.runtime;
DROP SCHEMA IF EXISTS notification_private;

-- Clean up any residual push_private routing functions if they were deployed as intermediates
DROP FUNCTION IF EXISTS push_private.notification_resolve_target(jsonb);
DROP FUNCTION IF EXISTS push_private.valid_target(jsonb);
DROP FUNCTION IF EXISTS push_private.push_register_device(uuid,uuid,text,text,text,text,text);

-- Remove legacy columns from push_devices if they were brought over initially
ALTER TABLE public.push_devices
  DROP COLUMN IF EXISTS app_version,
  DROP COLUMN IF EXISTS locale,
  DROP COLUMN IF EXISTS permission;
