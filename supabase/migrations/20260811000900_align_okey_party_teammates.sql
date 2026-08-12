-- Align an already matched two-player Party onto one Okey team before start.
-- Okey teams are opposite seats: 0+2 and 1+3.
CREATE OR REPLACE FUNCTION public.align_okey_party_teammates(p_match_id uuid,p_leader_id uuid,p_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,okey AS $$
DECLARE v_match okey.matches%ROWTYPE; v_leader okey.match_seats%ROWTYPE;
 v_member okey.match_seats%ROWTYPE; v_occupant okey.match_seats%ROWTYPE; v_target smallint;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING errcode='42501'; END IF;
 IF p_leader_id IS NULL OR p_member_id IS NULL OR p_leader_id=p_member_id THEN
  RAISE EXCEPTION 'invalid_party_members' USING errcode='22023'; END IF;
 SELECT * INTO v_match FROM okey.matches WHERE id=p_match_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'match_not_found' USING errcode='P0002'; END IF;
 IF v_match.status<>'waiting' THEN RAISE EXCEPTION 'match_already_started' USING errcode='P0001'; END IF;
 SELECT * INTO v_leader FROM okey.match_seats WHERE match_id=p_match_id AND user_id=p_leader_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'party_leader_seat_not_found'; END IF;
 SELECT * INTO v_member FROM okey.match_seats WHERE match_id=p_match_id AND user_id=p_member_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'party_member_seat_not_found'; END IF;
 v_target:=CASE v_leader.player_index WHEN 0 THEN 2 WHEN 2 THEN 0 WHEN 1 THEN 3 ELSE 1 END;
 IF v_member.player_index=v_target AND v_member.team_id=v_leader.team_id THEN
  RETURN jsonb_build_object('status','already_aligned'); END IF;
 SELECT * INTO v_occupant FROM okey.match_seats WHERE match_id=p_match_id AND player_index=v_target FOR UPDATE;
 DELETE FROM okey.match_seats WHERE match_id=p_match_id AND user_id=p_member_id;
 IF v_occupant.user_id IS NOT NULL THEN
  UPDATE okey.match_seats SET player_index=v_member.player_index,
   team_id=CASE WHEN v_member.player_index IN(0,2) THEN 'teamA' ELSE 'teamB' END
  WHERE match_id=p_match_id AND user_id=v_occupant.user_id;
 END IF;
 INSERT INTO okey.match_seats(match_id,user_id,player_index,team_id,joined_at,display_name,avatar_url,connected,last_seen_at,bot_since,bot_difficulty)
 VALUES(v_member.match_id,v_member.user_id,v_target,v_leader.team_id,v_member.joined_at,v_member.display_name,v_member.avatar_url,
  v_member.connected,v_member.last_seen_at,v_member.bot_since,v_member.bot_difficulty);
 RETURN jsonb_build_object('status','aligned','team_id',v_leader.team_id,'leader_index',v_leader.player_index,'member_index',v_target);
END;$$;
REVOKE ALL ON FUNCTION public.align_okey_party_teammates(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.align_okey_party_teammates(uuid,uuid,uuid) TO service_role;
