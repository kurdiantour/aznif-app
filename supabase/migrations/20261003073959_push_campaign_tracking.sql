-- Extends the immediate push path. A claimed delivery is never sent twice.
CREATE TABLE public.push_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, body text NOT NULL,
 environment text NOT NULL CHECK (environment IN ('production','development')),
 audience text NOT NULL CHECK (audience IN ('all','users')), user_ids uuid[],
 deep_link text, status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','complete')),
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CHECK ((audience='all' AND user_ids IS NULL) OR (audience='users' AND cardinality(user_ids)>0))
);
CREATE TABLE public.push_campaign_devices (
 campaign_id uuid NOT NULL REFERENCES public.push_campaigns(id) ON DELETE CASCADE,
 device_id uuid NOT NULL,
 user_id uuid NOT NULL, platform text NOT NULL CHECK (platform IN ('ios','android')),
 status text NOT NULL DEFAULT 'target' CHECK (status IN ('target','accepted','error','inactive','unknown')),
 expo_ticket_id text, error_code text, targeted_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz, resolved_at timestamptz,
 PRIMARY KEY(campaign_id,device_id)
);
CREATE INDEX push_campaign_devices_status_idx ON public.push_campaign_devices(campaign_id,status);
CREATE TABLE public.push_opens (
 campaign_id uuid NOT NULL, device_id uuid NOT NULL, user_id uuid NOT NULL,
 platform text NOT NULL CHECK (platform IN ('ios','android')),
 opened_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(campaign_id,device_id),
 FOREIGN KEY(campaign_id,device_id) REFERENCES public.push_campaign_devices(campaign_id,device_id) ON DELETE CASCADE
);
CREATE INDEX push_opens_campaign_idx ON public.push_opens(campaign_id);
ALTER TABLE public.push_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_campaign_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_opens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_campaigns, public.push_campaign_devices, public.push_opens FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.push_campaigns, public.push_campaign_devices TO service_role;
GRANT SELECT,INSERT ON public.push_opens TO service_role;

-- Targeting is persisted before a send is claimed. A crashed unclaimed target can be resumed.
CREATE FUNCTION public.push_target_device(p_campaign uuid,p_device uuid,p_user uuid,p_platform text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 INSERT INTO public.push_campaign_devices(campaign_id,device_id,user_id,platform,status)
 VALUES(p_campaign,p_device,p_user,p_platform,'target') ON CONFLICT DO NOTHING
$$;
REVOKE ALL ON FUNCTION public.push_target_device(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.push_target_device(uuid,uuid,uuid,text) TO service_role;

-- Exactly one concurrent invocation can move an unclaimed target into the send state.
CREATE FUNCTION public.push_claim_device(p_campaign uuid,p_device uuid,p_user uuid,p_platform text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE inserted integer;
BEGIN
 UPDATE public.push_campaign_devices SET status='unknown',claimed_at=now()
 WHERE campaign_id=p_campaign AND device_id=p_device AND user_id=p_user AND platform=p_platform AND status='target';
 GET DIAGNOSTICS inserted = ROW_COUNT;
 RETURN inserted=1;
END $$;
REVOKE ALL ON FUNCTION public.push_claim_device(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.push_claim_device(uuid,uuid,uuid,text) TO service_role;

-- The client proves the installation as well as its authenticated user identity.
CREATE FUNCTION push_private.push_record_open(p_campaign uuid,p_device uuid,p_installation uuid,p_secret uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); inserted integer;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.push_campaign_devices cd
   JOIN public.push_devices d ON d.id=cd.device_id
   WHERE cd.campaign_id=p_campaign AND cd.device_id=p_device AND cd.user_id=uid
     AND d.user_id=uid AND d.installation_id=p_installation AND d.installation_secret=p_secret
     AND cd.status IN ('accepted','unknown')
 ) THEN RETURN false; END IF;
 INSERT INTO public.push_opens(campaign_id,device_id,user_id,platform)
 SELECT cd.campaign_id,cd.device_id,cd.user_id,cd.platform
 FROM public.push_campaign_devices cd WHERE cd.campaign_id=p_campaign AND cd.device_id=p_device
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted = ROW_COUNT;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION push_private.push_record_open(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION push_private.push_record_open(uuid,uuid,uuid,uuid) TO authenticated;
CREATE FUNCTION public.push_record_open(p_campaign uuid,p_device uuid,p_installation uuid,p_secret uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT push_private.push_record_open(p_campaign,p_device,p_installation,p_secret)
$$;
REVOKE ALL ON FUNCTION public.push_record_open(uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.push_record_open(uuid,uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.push_campaign_report(p_campaign uuid)
RETURNS TABLE(campaign_id uuid,campaign_status text,target bigint,accepted bigint,error bigint,inactive bigint,unknown bigint,opened bigint,open_rate numeric)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT c.id,c.status,count(d.device_id),count(*) FILTER (WHERE d.status='accepted'),
 count(*) FILTER (WHERE d.status='error'),count(*) FILTER (WHERE d.status='inactive'),
 count(*) FILTER (WHERE d.status='unknown'),count(o.device_id),
 CASE WHEN count(*) FILTER (WHERE d.status='accepted')=0 THEN 0
 ELSE round((count(o.device_id) FILTER (WHERE d.status='accepted'))::numeric / (count(*) FILTER (WHERE d.status='accepted')),4) END
 FROM public.push_campaigns c LEFT JOIN public.push_campaign_devices d ON d.campaign_id=c.id
 LEFT JOIN public.push_opens o ON o.campaign_id=d.campaign_id AND o.device_id=d.device_id
 WHERE c.id=p_campaign GROUP BY c.id,c.status
$$;
REVOKE ALL ON FUNCTION public.push_campaign_report(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.push_campaign_report(uuid) TO service_role;
