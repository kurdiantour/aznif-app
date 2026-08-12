-- Persistent two-player parties for Domino. Game invites now form a party;
-- only the leader can enqueue it, and a two-person party is compatible with 2v2.

CREATE TABLE IF NOT EXISTS public.domino_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disbanded')),
  flow_status text NOT NULL DEFAULT 'idle' CHECK (flow_status IN ('idle', 'matchmaking')),
  current_room_id uuid,
  current_mode text CHECK (current_mode IS NULL OR current_mode IN ('2v2')),
  current_currency text CHECK (current_currency IS NULL OR current_currency IN ('fun', 'aznif')),
  current_entry_fee numeric,
  command_version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.domino_party_members (
  party_id uuid NOT NULL REFERENCES public.domino_parties(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('leader', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (party_id, user_id),
  UNIQUE (user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS domino_parties_one_active_per_leader
ON public.domino_parties(leader_id) WHERE status = 'active';

ALTER TABLE public.game_invites
ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.domino_parties(id) ON DELETE SET NULL;

ALTER TABLE public.domino_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domino_party_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_domino_party_member(p_party_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.domino_party_members
    WHERE party_id=p_party_id AND user_id=auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_domino_party_member(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_domino_party_member(uuid) TO authenticated;

DROP POLICY IF EXISTS domino_parties_select_members ON public.domino_parties;
CREATE POLICY domino_parties_select_members ON public.domino_parties
FOR SELECT TO authenticated USING (public.is_domino_party_member(id));

DROP POLICY IF EXISTS domino_party_members_select_party ON public.domino_party_members;
CREATE POLICY domino_party_members_select_party ON public.domino_party_members
FOR SELECT TO authenticated USING (public.is_domino_party_member(party_id));

REVOKE ALL ON public.domino_parties FROM anon,authenticated;
REVOKE ALL ON public.domino_party_members FROM anon,authenticated;
GRANT SELECT ON public.domino_parties,public.domino_party_members TO authenticated;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.domino_parties;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.domino_party_members;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.get_my_domino_party()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_party public.domino_parties%ROWTYPE; v_members jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT p.* INTO v_party
  FROM public.domino_parties p
  JOIN public.domino_party_members pm ON pm.party_id=p.id
  WHERE pm.user_id=auth.uid() AND p.status='active'
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'user_id',pm.user_id,'role',pm.role,'avatar_id',pr.avatar_id,
    'name',coalesce(pr.full_name,pr.username,pm.user_id::text)
  ) ORDER BY CASE WHEN pm.role='leader' THEN 0 ELSE 1 END)
  INTO v_members
  FROM public.domino_party_members pm
  LEFT JOIN public.profiles pr ON pr.id=pm.user_id
  WHERE pm.party_id=v_party.id;

  RETURN jsonb_build_object(
    'id',v_party.id,'leader_id',v_party.leader_id,'status',v_party.status,
    'flow_status',v_party.flow_status,'current_room_id',v_party.current_room_id,
    'current_mode',v_party.current_mode,'current_currency',v_party.current_currency,
    'current_entry_fee',v_party.current_entry_fee,'command_version',v_party.command_version,
    'updated_at',v_party.updated_at,'members',coalesce(v_members,'[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_domino_party() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_domino_party() TO authenticated;

CREATE OR REPLACE FUNCTION public.send_game_invite(p_recipient_id uuid,p_mode text DEFAULT '1v1')
RETURNS public.game_invites LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_invite public.game_invites%ROWTYPE; v_status text; v_last_seen timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_recipient_id=auth.uid() THEN RAISE EXCEPTION 'Cannot invite yourself'; END IF;
  IF p_mode<>'1v1' THEN RAISE EXCEPTION 'Unsupported game mode'; END IF;
  IF NOT public.are_friends(auth.uid(),p_recipient_id) THEN RAISE EXCEPTION 'You can only invite confirmed friends'; END IF;
  IF EXISTS(SELECT 1 FROM public.domino_party_members WHERE user_id IN(auth.uid(),p_recipient_id)) THEN
    RAISE EXCEPTION 'player_already_in_party';
  END IF;
  PERFORM public.expire_stale_game_invites();
  SELECT status,last_seen_at INTO v_status,v_last_seen FROM public.user_presence WHERE user_id=p_recipient_id;
  IF v_status IS DISTINCT FROM 'online_available' OR v_last_seen IS NULL OR v_last_seen<now()-interval '35 seconds' THEN
    RAISE EXCEPTION 'Player is not available';
  END IF;
  IF EXISTS(SELECT 1 FROM public.game_invites WHERE status='pending' AND
    LEAST(sender_id,recipient_id)=LEAST(auth.uid(),p_recipient_id) AND
    GREATEST(sender_id,recipient_id)=GREATEST(auth.uid(),p_recipient_id)) THEN
    RAISE EXCEPTION 'An invitation is already pending';
  END IF;
  INSERT INTO public.game_invites(sender_id,recipient_id,mode)
  VALUES(auth.uid(),p_recipient_id,p_mode) RETURNING * INTO v_invite;
  RETURN v_invite;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_game_invite(p_invite_id uuid,p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_invite public.game_invites%ROWTYPE; v_party public.domino_parties%ROWTYPE;
  v_sender_status text; v_sender_seen timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_invite FROM public.game_invites
  WHERE id=p_invite_id AND recipient_id=auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_invite.status<>'pending' THEN RAISE EXCEPTION 'Pending invitation not found'; END IF;
  IF v_invite.expires_at<=now() THEN
    UPDATE public.game_invites SET status='expired',updated_at=now() WHERE id=v_invite.id;
    RETURN jsonb_build_object('status','expired');
  END IF;
  IF NOT p_accept THEN
    UPDATE public.game_invites SET status='declined',responded_at=now(),updated_at=now() WHERE id=v_invite.id;
    RETURN jsonb_build_object('status','declined');
  END IF;
  IF NOT public.are_friends(v_invite.sender_id,v_invite.recipient_id) THEN RAISE EXCEPTION 'Players are no longer friends'; END IF;
  SELECT status,last_seen_at INTO v_sender_status,v_sender_seen
  FROM public.user_presence WHERE user_id=v_invite.sender_id;
  IF v_sender_status IS DISTINCT FROM 'online_available' OR v_sender_seen IS NULL OR
     v_sender_seen<now()-interval '35 seconds' THEN RAISE EXCEPTION 'Party leader is not available'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(LEAST(v_invite.sender_id::text,v_invite.recipient_id::text),0));
  IF EXISTS(SELECT 1 FROM public.domino_party_members WHERE user_id IN(v_invite.sender_id,v_invite.recipient_id)) THEN
    RAISE EXCEPTION 'player_already_in_party';
  END IF;

  INSERT INTO public.domino_parties(leader_id) VALUES(v_invite.sender_id) RETURNING * INTO v_party;
  INSERT INTO public.domino_party_members(party_id,user_id,role) VALUES
    (v_party.id,v_invite.sender_id,'leader'),(v_party.id,v_invite.recipient_id,'member');
  UPDATE public.game_invites SET status='accepted',party_id=v_party.id,responded_at=now(),updated_at=now() WHERE id=v_invite.id;
  UPDATE public.game_invites SET status='cancelled',responded_at=now(),updated_at=now()
  WHERE status='pending' AND id<>v_invite.id AND
    (sender_id IN(v_invite.sender_id,v_invite.recipient_id) OR recipient_id IN(v_invite.sender_id,v_invite.recipient_id));
  RETURN jsonb_build_object('status','accepted','party_id',v_party.id,'leader_id',v_party.leader_id);
END;
$$;

REVOKE ALL ON FUNCTION public.send_game_invite(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.respond_game_invite(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.send_game_invite(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_game_invite(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.find_domino_match(p_mode text,p_currency text,p_entry_fee numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_room record; v_waiter record; v_count integer; v_index integer;
  v_seat text; v_team text; v_party_id uuid; v_leader_id uuid; v_members uuid[]; v_member uuid;
  v_party_size integer:=1; v_first_index integer; v_second_index integer; v_final_count integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_mode NOT IN ('1v1','2v2') OR p_currency NOT IN ('fun','aznif') THEN RAISE EXCEPTION 'invalid_match_configuration'; END IF;
  IF (p_mode='1v1' AND NOT ((p_currency='fun' AND p_entry_fee=500) OR (p_currency='aznif' AND p_entry_fee IN(5,10)))) OR
     (p_mode='2v2' AND NOT ((p_currency='fun' AND p_entry_fee=3500) OR (p_currency='aznif' AND p_entry_fee IN(15,20)))) THEN RAISE EXCEPTION 'unsupported_domino_entry'; END IF;

  SELECT p.id,p.leader_id INTO v_party_id,v_leader_id
  FROM public.domino_parties p JOIN public.domino_party_members pm ON pm.party_id=p.id
  WHERE pm.user_id=v_uid AND p.status='active' LIMIT 1 FOR UPDATE OF p;
  IF v_party_id IS NOT NULL THEN
    IF v_leader_id<>v_uid THEN RAISE EXCEPTION 'party_leader_required'; END IF;
    SELECT array_agg(pm.user_id ORDER BY CASE WHEN pm.role='leader' THEN 0 ELSE 1 END),count(*)
    INTO v_members,v_party_size FROM public.domino_party_members pm WHERE pm.party_id=v_party_id;
    IF v_party_size<>2 THEN RAISE EXCEPTION 'invalid_party_size'; END IF;
    IF p_mode<>'2v2' THEN RAISE EXCEPTION 'party_mode_incompatible'; END IF;
  ELSE
    v_members:=ARRAY[v_uid];
  END IF;

  IF EXISTS(
    SELECT 1 FROM unnest(v_members) member_id
    WHERE CASE WHEN p_currency='aznif'
      THEN coalesce((SELECT mc FROM public.wallets WHERE user_id=member_id),0)<p_entry_fee
      ELSE coalesce((SELECT coin FROM public.wallets WHERE user_id=member_id),0)<p_entry_fee END
  ) THEN RAISE EXCEPTION 'party_member_insufficient_entry_balance'; END IF;
  IF v_party_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM unnest(v_members) member_id
    LEFT JOIN public.user_presence presence ON presence.user_id=member_id
    WHERE presence.status IS DISTINCT FROM 'online_available' OR presence.last_seen_at IS NULL OR
      presence.last_seen_at<now()-interval '35 seconds'
  ) THEN RAISE EXCEPTION 'party_member_unavailable'; END IF;

  IF p_mode='1v1' THEN
    DELETE FROM public.one_vs_one_matchmaking_queue WHERE user_id=v_uid OR(status='searching' AND created_at<now()-interval '5 minutes');
    SELECT * INTO v_waiter FROM public.one_vs_one_matchmaking_queue q
    WHERE q.status='searching' AND q.user_id<>v_uid AND q.currency=p_currency AND q.entry_fee=p_entry_fee AND
      CASE WHEN p_currency='aznif' THEN coalesce((SELECT mc FROM public.wallets WHERE user_id=q.user_id),0)>=p_entry_fee
      ELSE coalesce((SELECT coin FROM public.wallets WHERE user_id=q.user_id),0)>=p_entry_fee END
    ORDER BY q.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      INSERT INTO public.one_vs_one_matchmaking_queue(user_id,status,bet_amount,currency,entry_fee) VALUES(v_uid,'searching',0,p_currency,p_entry_fee);
      RETURN jsonb_build_object('status','searching','mode',p_mode,'currency',p_currency,'entry_fee',p_entry_fee);
    END IF;
    INSERT INTO public.one_vs_one_rooms(host_user_id,room_code,status,bet_amount,player_count,metadata,currency,entry_fee)
    VALUES(v_uid,public.generate_one_vs_one_room_code(),'waiting',0,2,jsonb_build_object('economy','okey_model'),p_currency,p_entry_fee) RETURNING * INTO v_room;
    SELECT seat,team_id INTO v_seat,v_team FROM public.resolve_one_vs_one_seat_assignment(0);
    INSERT INTO public.one_vs_one_players(room_id,user_id,kind,seat,team_id,player_index,is_ready,connected) VALUES(v_room.id,v_waiter.user_id,'human',v_seat,v_team,0,true,true);
    SELECT seat,team_id INTO v_seat,v_team FROM public.resolve_one_vs_one_seat_assignment(1);
    INSERT INTO public.one_vs_one_players(room_id,user_id,kind,seat,team_id,player_index,is_ready,connected) VALUES(v_room.id,v_uid,'human',v_seat,v_team,1,true,true);
    UPDATE public.one_vs_one_matchmaking_queue SET status='matched',matched_room_id=v_room.id,ended_at=now() WHERE user_id=v_waiter.user_id;
    INSERT INTO public.one_vs_one_matchmaking_queue(user_id,status,matched_room_id,ended_at,bet_amount,currency,entry_fee) VALUES(v_uid,'matched',v_room.id,now(),0,p_currency,p_entry_fee);
    RETURN jsonb_build_object('status','matched','room_id',v_room.id,'mode',p_mode,'currency',p_currency,'entry_fee',p_entry_fee);
  END IF;

  DELETE FROM public.two_vs_two_matchmaking_queue WHERE user_id=ANY(v_members) OR(status='searching' AND created_at<now()-interval '5 minutes');
  SELECT r.* INTO v_room FROM public.two_vs_two_rooms r
  WHERE r.status='waiting'
    AND COALESCE(r.metadata ->> 'source','') NOT IN ('private_room','private_room_10')
    AND (SELECT count(*) FROM public.two_vs_two_players member WHERE member.room_id=r.id) <= 4-v_party_size
    AND r.currency=p_currency AND r.entry_fee=p_entry_fee
    AND CASE WHEN v_party_size=2 THEN
      (NOT EXISTS(SELECT 1 FROM public.two_vs_two_players p WHERE p.room_id=r.id AND p.player_index IN(0,2)) OR
       NOT EXISTS(SELECT 1 FROM public.two_vs_two_players p WHERE p.room_id=r.id AND p.player_index IN(1,3)))
    ELSE EXISTS(SELECT 1 FROM generate_series(0,3) i WHERE NOT EXISTS(
      SELECT 1 FROM public.two_vs_two_players p WHERE p.room_id=r.id AND p.player_index=i)) END
  ORDER BY r.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    INSERT INTO public.two_vs_two_rooms(host_user_id,room_code,status,bet_amount,player_count,metadata,currency,entry_fee)
    VALUES(v_uid,public.generate_two_vs_two_room_code(),'waiting',0,v_party_size,
      jsonb_build_object('economy','okey_model','party_id',v_party_id),p_currency,p_entry_fee) RETURNING * INTO v_room;
    v_first_index:=0; v_second_index:=2;
  ELSIF v_party_size=2 THEN
    IF NOT EXISTS(SELECT 1 FROM public.two_vs_two_players WHERE room_id=v_room.id AND player_index IN(0,2)) THEN
      v_first_index:=0; v_second_index:=2;
    ELSE v_first_index:=1; v_second_index:=3; END IF;
  ELSE
    SELECT i INTO v_first_index FROM generate_series(0,3) i
    WHERE NOT EXISTS(SELECT 1 FROM public.two_vs_two_players WHERE room_id=v_room.id AND player_index=i)
    ORDER BY i LIMIT 1;
  END IF;

  v_count:=0;
  FOREACH v_member IN ARRAY v_members LOOP
    v_index:=CASE WHEN v_count=0 THEN v_first_index ELSE v_second_index END;
    SELECT seat,team_id INTO v_seat,v_team FROM public.resolve_two_vs_two_seat_assignment(v_index);
    INSERT INTO public.two_vs_two_players(room_id,user_id,kind,seat,team_id,player_index,is_ready,connected)
    VALUES(v_room.id,v_member,'human',v_seat,v_team,v_index,true,true);
    v_count:=v_count+1;
  END LOOP;

  SELECT count(*) INTO v_final_count
  FROM public.two_vs_two_players WHERE room_id=v_room.id;
  UPDATE public.two_vs_two_rooms SET player_count=v_final_count,
    status=CASE WHEN v_final_count=4 THEN 'active' ELSE 'waiting' END,version=version+1
  WHERE id=v_room.id RETURNING * INTO v_room;

  FOREACH v_member IN ARRAY v_members LOOP
    INSERT INTO public.two_vs_two_matchmaking_queue(user_id,status,matched_room_id,ended_at,currency,entry_fee)
    VALUES(v_member,CASE WHEN v_room.status='active' THEN 'matched' ELSE 'searching' END,v_room.id,
      CASE WHEN v_room.status='active' THEN now() ELSE NULL END,p_currency,p_entry_fee)
    ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,matched_room_id=excluded.matched_room_id,
      ended_at=excluded.ended_at,currency=excluded.currency,entry_fee=excluded.entry_fee;
  END LOOP;
  IF v_room.status='active' THEN
    UPDATE public.two_vs_two_matchmaking_queue SET status='matched',ended_at=now()
    WHERE user_id IN(SELECT user_id FROM public.two_vs_two_players WHERE room_id=v_room.id);
  END IF;
  IF v_party_id IS NOT NULL THEN
    UPDATE public.domino_parties SET flow_status='matchmaking',current_room_id=v_room.id,current_mode='2v2',
      current_currency=p_currency,current_entry_fee=p_entry_fee,command_version=command_version+1,updated_at=now()
    WHERE id=v_party_id;
  END IF;
  RETURN jsonb_build_object('status',CASE WHEN v_room.status='active' THEN 'matched' ELSE 'searching' END,
    'room_id',v_room.id,'mode',p_mode,'currency',p_currency,'entry_fee',p_entry_fee,'party_id',v_party_id);
END;
$$;

REVOKE ALL ON FUNCTION public.find_domino_match(text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.find_domino_match(text,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_two_vs_two_matchmaking(p_room_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_party_id uuid; v_leader_id uuid; v_users uuid[];
  v_remaining_count integer:=0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT p.id,p.leader_id INTO v_party_id,v_leader_id FROM public.domino_parties p
  JOIN public.domino_party_members pm ON pm.party_id=p.id
  WHERE pm.user_id=v_uid AND p.status='active' LIMIT 1 FOR UPDATE OF p;
  IF v_party_id IS NOT NULL THEN
    IF v_leader_id<>v_uid THEN RAISE EXCEPTION 'party_leader_required'; END IF;
    SELECT array_agg(user_id) INTO v_users FROM public.domino_party_members WHERE party_id=v_party_id;
  ELSE v_users:=ARRAY[v_uid]; END IF;

  IF p_room_id IS NOT NULL THEN
    PERFORM 1 FROM public.two_vs_two_rooms WHERE id=p_room_id FOR UPDATE;
    IF FOUND THEN
      IF EXISTS(SELECT 1 FROM public.two_vs_two_private_states WHERE room_id=p_room_id) THEN
        RAISE EXCEPTION 'match_already_started';
      END IF;
      DELETE FROM public.two_vs_two_players
      WHERE room_id=p_room_id AND user_id=ANY(v_users);
      SELECT count(*) INTO v_remaining_count
      FROM public.two_vs_two_players WHERE room_id=p_room_id;
      UPDATE public.two_vs_two_rooms
      SET player_count=GREATEST(1,v_remaining_count),
          status=CASE WHEN v_remaining_count=0 THEN 'cancelled' ELSE 'waiting' END,
          current_turn_player_id=NULL,version=version+1,updated_at=now()
      WHERE id=p_room_id;
    END IF;
  END IF;

  UPDATE public.two_vs_two_matchmaking_queue
  SET status='cancelled',matched_room_id=NULL,ended_at=now(),updated_at=now()
  WHERE user_id=ANY(v_users) AND status IN('searching','matched');
  UPDATE public.user_presence
  SET status='online_available',last_seen_at=now(),updated_at=now()
  WHERE user_id=ANY(v_users);
  IF v_party_id IS NOT NULL THEN
    UPDATE public.domino_parties SET flow_status='idle',current_room_id=NULL,current_mode=NULL,
      current_currency=NULL,current_entry_fee=NULL,command_version=command_version+1,updated_at=now()
    WHERE id=v_party_id;
  END IF;
  RETURN jsonb_build_object('status','cancelled','remaining_count',v_remaining_count);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_two_vs_two_matchmaking(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_two_vs_two_matchmaking(uuid) TO authenticated;
