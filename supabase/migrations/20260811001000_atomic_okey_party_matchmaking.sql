-- Atomically allocate a Party to one Okey team (0+2 or 1+3).
CREATE OR REPLACE FUNCTION public.matchmake_okey_party(
 p_party_id uuid,p_leader_id uuid,p_member_id uuid,p_table_id text,
 p_leader_name text,p_leader_avatar text,p_member_name text,p_member_avatar text,
 p_currency text,p_entry_fee numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,okey AS $$
DECLARE v_match okey.matches%ROWTYPE; v_l okey.match_seats%ROWTYPE; v_m okey.match_seats%ROWTYPE;
 v_first smallint; v_second smallint; v_count integer;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING errcode='42501'; END IF;
 IF p_party_id IS NULL OR p_leader_id IS NULL OR p_member_id IS NULL OR p_leader_id=p_member_id
 OR nullif(trim(p_table_id),'') IS NULL THEN RAISE EXCEPTION 'invalid_party_request' USING errcode='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('okey-party:'||p_party_id::text));
 PERFORM pg_advisory_xact_lock(hashtext('okey-matchmaking:'||trim(p_table_id)));
 PERFORM 1 FROM public.domino_parties p WHERE p.id=p_party_id AND p.status='active' AND p.leader_id=p_leader_id
 AND (SELECT count(*) FROM public.domino_party_members pm WHERE pm.party_id=p.id)=2
 AND EXISTS(SELECT 1 FROM public.domino_party_members pm WHERE pm.party_id=p.id AND pm.user_id=p_leader_id)
 AND EXISTS(SELECT 1 FROM public.domino_party_members pm WHERE pm.party_id=p.id AND pm.user_id=p_member_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'party_not_active' USING errcode='P0001'; END IF;
 SELECT s.* INTO v_l FROM okey.match_seats s JOIN okey.matches m ON m.id=s.match_id
  WHERE s.user_id=p_leader_id AND m.status IN('waiting','playing') ORDER BY m.created_at DESC LIMIT 1 FOR UPDATE OF m,s;
 SELECT s.* INTO v_m FROM okey.match_seats s JOIN okey.matches m ON m.id=s.match_id
  WHERE s.user_id=p_member_id AND m.status IN('waiting','playing') ORDER BY m.created_at DESC LIMIT 1 FOR UPDATE OF m,s;
 IF v_l.match_id IS NOT NULL AND v_m.match_id=v_l.match_id AND v_m.team_id=v_l.team_id THEN
  SELECT * INTO v_match FROM okey.matches WHERE id=v_l.match_id AND status='waiting' AND table_id=trim(p_table_id) FOR UPDATE;
  IF FOUND THEN RETURN v_match.id; END IF;
 END IF;
 IF v_l.match_id IS NOT NULL OR v_m.match_id IS NOT NULL THEN RAISE EXCEPTION 'party_member_already_in_match' USING errcode='P0001'; END IF;
 SELECT m.* INTO v_match FROM okey.matches m WHERE m.status='waiting' AND m.table_id=trim(p_table_id) AND (
  NOT EXISTS(SELECT 1 FROM okey.match_seats s WHERE s.match_id=m.id AND s.player_index IN(0,2)) OR
  NOT EXISTS(SELECT 1 FROM okey.match_seats s WHERE s.match_id=m.id AND s.player_index IN(1,3)))
  ORDER BY m.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN INSERT INTO okey.matches(status,table_id,created_by,room_code,countdown_deadline_at)
  VALUES('waiting',trim(p_table_id),p_leader_id,upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),null) RETURNING * INTO v_match; END IF;
 IF NOT EXISTS(SELECT 1 FROM okey.match_seats WHERE match_id=v_match.id AND player_index IN(0,2)) THEN v_first:=0;v_second:=2;
 ELSIF NOT EXISTS(SELECT 1 FROM okey.match_seats WHERE match_id=v_match.id AND player_index IN(1,3)) THEN v_first:=1;v_second:=3;
 ELSE RAISE EXCEPTION 'party_team_pair_unavailable' USING errcode='P0001'; END IF;
 INSERT INTO okey.match_seats(match_id,user_id,player_index,team_id,display_name,avatar_url,connected,last_seen_at) VALUES
 (v_match.id,p_leader_id,v_first,CASE WHEN v_first=0 THEN 'teamA' ELSE 'teamB' END,left(coalesce(nullif(trim(p_leader_name),''),'Player'),64),p_leader_avatar,true,now()),
 (v_match.id,p_member_id,v_second,CASE WHEN v_second=2 THEN 'teamA' ELSE 'teamB' END,left(coalesce(nullif(trim(p_member_name),''),'Player'),64),p_member_avatar,true,now());
 SELECT count(*) INTO v_count FROM okey.match_seats WHERE match_id=v_match.id;
 UPDATE okey.matches SET countdown_deadline_at=CASE WHEN v_count=4 THEN now()+interval '5 seconds' ELSE null END,updated_at=now() WHERE id=v_match.id;
 UPDATE public.domino_parties SET flow_status='matchmaking',current_game='okey',current_room_id=v_match.id,current_mode='2v2',
 current_currency=p_currency,current_entry_fee=p_entry_fee,current_table_id=trim(p_table_id),command_version=command_version+1,updated_at=now()
 WHERE id=p_party_id AND status='active';
 RETURN v_match.id;
END;$$;
REVOKE ALL ON FUNCTION public.matchmake_okey_party(uuid,uuid,uuid,text,text,text,text,text,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.matchmake_okey_party(uuid,uuid,uuid,text,text,text,text,text,text,numeric) TO service_role;
