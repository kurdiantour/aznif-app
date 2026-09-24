-- Central notification service: implementations and device helpers are not exposed by the Data API.
CREATE SCHEMA IF NOT EXISTS push_private;
REVOKE ALL ON SCHEMA push_private FROM PUBLIC;
GRANT USAGE ON SCHEMA push_private TO authenticated,service_role;
CREATE TABLE IF NOT EXISTS public.push_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 expo_push_token text NOT NULL UNIQUE,platform text NOT NULL CHECK(platform IN ('android','ios')),active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.push_devices ADD COLUMN IF NOT EXISTS installation_id uuid;
ALTER TABLE public.push_devices ADD COLUMN IF NOT EXISTS installation_secret uuid;
ALTER TABLE public.push_devices ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production';
CREATE UNIQUE INDEX IF NOT EXISTS push_devices_installation ON public.push_devices(installation_id) WHERE installation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS push_devices_active_user ON public.push_devices(user_id,environment) WHERE active;
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_devices FROM anon,authenticated;

GRANT SELECT,UPDATE ON public.push_devices TO service_role;
-- Retire the old seven-argument public overload before exposing the minimal API.
DROP FUNCTION IF EXISTS public.push_register_device(uuid,uuid,text,text,text,text,text);
CREATE FUNCTION push_private.push_register_device(p_installation uuid,p_secret uuid,p_token text,p_platform text,p_environment text DEFAULT 'production')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.push_devices; uid uuid:=auth.uid(); BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF p_token IS NULL OR p_platform IS NULL OR p_environment IS NULL OR p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' OR p_platform NOT IN ('android','ios') OR p_environment NOT IN ('production','development')
 OR p_installation IS NULL OR p_secret IS NULL THEN RAISE EXCEPTION 'Invalid device'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_token,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_installation::text,1));
 SELECT * INTO d FROM public.push_devices WHERE installation_id=p_installation FOR UPDATE;
 IF FOUND AND d.installation_secret IS DISTINCT FROM p_secret THEN RAISE EXCEPTION 'Invalid installation proof'; END IF;
 IF EXISTS(SELECT 1 FROM public.push_devices WHERE expo_push_token=p_token AND user_id<>uid
 AND (installation_id IS DISTINCT FROM p_installation OR installation_secret IS DISTINCT FROM p_secret)) THEN RAISE EXCEPTION 'Token belongs to another installation'; END IF;
 DELETE FROM public.push_devices WHERE expo_push_token=p_token AND installation_id IS DISTINCT FROM p_installation AND user_id=uid;
 INSERT INTO public.push_devices(user_id,expo_push_token,platform,installation_id,installation_secret,environment,active)
 VALUES(uid,p_token,p_platform,p_installation,p_secret,p_environment,true)
 ON CONFLICT(installation_id) WHERE installation_id IS NOT NULL DO UPDATE SET
 user_id=EXCLUDED.user_id,expo_push_token=EXCLUDED.expo_push_token,platform=EXCLUDED.platform,environment=EXCLUDED.environment,
 active=true,updated_at=now() RETURNING * INTO d;
 RETURN d.id;
END $$;
CREATE FUNCTION push_private.push_unregister_device(p_installation uuid,p_secret uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 UPDATE public.push_devices SET active=false,updated_at=now() WHERE installation_id=p_installation AND installation_secret=p_secret AND user_id=auth.uid();
END $$;
DO $$ DECLARE f record; arglist text; BEGIN
 FOR f IN SELECT p.*,pg_get_function_identity_arguments(p.oid) identity_args,pg_get_function_arguments(p.oid) args,pg_get_function_result(p.oid) result
 FROM pg_proc p WHERE p.pronamespace='push_private'::regnamespace LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION push_private.%I(%s) FROM PUBLIC,anon,authenticated,service_role',f.proname,f.identity_args);
 IF f.proname NOT IN ('push_register_device','push_unregister_device') THEN CONTINUE; END IF;
 SELECT string_agg(quote_ident(a),',') INTO arglist FROM unnest(f.proargnames) a;
 EXECUTE format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql SECURITY INVOKER SET search_path='''' AS %L',f.proname,f.args,f.result,'SELECT push_private.'||quote_ident(f.proname)||'('||COALESCE(arglist,'')||')');
 EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated,service_role',f.proname,f.identity_args);
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',f.proname,f.identity_args);
 EXECUTE format('GRANT EXECUTE ON FUNCTION push_private.%I(%s) TO authenticated',f.proname,f.identity_args);
 END LOOP;
END $$;
