-- MANUAL ONLY. Never run automatically. Back up old notification data first.
-- Apply immediate_push_devices and replace send-push-notification before this script.
-- Transaction rolls back if an unknown dependent object exists (no CASCADE).
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('push_private.push_register_device(uuid,uuid,text,text,text)') IS NULL THEN
 RAISE EXCEPTION 'Apply immediate_push_devices first'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='push_register_device' AND pg_get_functiondef(p.oid) LIKE '%push_private.push_register_device%') THEN
 RAISE EXCEPTION 'Public device API must use push_private first'; END IF;
 IF to_regclass('notification_private.runtime') IS NOT NULL THEN
 EXECUTE 'UPDATE notification_private.runtime SET enabled=false,worker_url=NULL,worker_secret=gen_random_uuid()::text'; END IF;
 IF to_regclass('cron.job') IS NOT NULL THEN
 PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='aznif-notification-dispatch'; END IF;
END $$;
DROP TRIGGER IF EXISTS notification_game_invite ON public.game_invites;
DROP TRIGGER IF EXISTS notification_friend_invite ON public.friendships;
DROP TRIGGER IF EXISTS notification_okey_started ON okey.matches;
DROP TRIGGER IF EXISTS notification_domino1_started ON public.one_vs_one_rooms;
DROP TRIGGER IF EXISTS notification_domino2_started ON public.two_vs_two_rooms;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('notification_resolve_target','notification_create_campaign','notification_cancel_campaign','notification_campaign_report','notification_open','notifications_authorize_worker','notifications_prepare','notifications_claim','notifications_complete','notifications_complete_batch') LOOP
 EXECUTE 'DROP FUNCTION '||f.signature; END LOOP;
END $$;
DROP TABLE IF EXISTS notification_private.deliveries,notification_private.outbox,notification_private.campaign_recipients,notification_private.audit_log;
DROP TABLE IF EXISTS public.user_notifications,public.notification_campaigns,public.notification_events,public.notification_preferences;
-- Remove functions before runtime (wake declares its row type).
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='notification_private' LOOP
 EXECUTE 'DROP FUNCTION '||f.signature; END LOOP;
END $$;
DROP TABLE IF EXISTS notification_private.runtime;
DROP SCHEMA IF EXISTS notification_private;
-- Only needed if the earlier intermediate push_private routing helpers were deployed.
DROP FUNCTION IF EXISTS push_private.notification_resolve_target(jsonb);
DROP FUNCTION IF EXISTS push_private.valid_target(jsonb);
DROP FUNCTION IF EXISTS push_private.push_register_device(uuid,uuid,text,text,text,text,text);
ALTER TABLE public.push_devices DROP COLUMN IF EXISTS app_version, DROP COLUMN IF EXISTS locale, DROP COLUMN IF EXISTS permission;
COMMIT;
