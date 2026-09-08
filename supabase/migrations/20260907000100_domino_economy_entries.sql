-- Canonical Domino public-table economy:
-- Fun 1v1=500, Fun 2v2=1500, Aznif 1v1=3, Aznif 2v2=7.

DO $migration$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  v_definition := pg_get_functiondef(
    'public.find_domino_match(text,text,numeric)'::regprocedure
  );
  v_updated := replace(
    v_definition,
    $old$IF (p_mode='1v1' AND NOT ((p_currency='fun' AND p_entry_fee=500) OR (p_currency='aznif' AND p_entry_fee IN(5,10)))) OR
     (p_mode='2v2' AND NOT ((p_currency='fun' AND p_entry_fee=3500) OR (p_currency='aznif' AND p_entry_fee IN(15,20)))) THEN RAISE EXCEPTION 'unsupported_domino_entry'; END IF;$old$,
    $new$IF (p_mode='1v1' AND NOT ((p_currency='fun' AND p_entry_fee=500) OR (p_currency='aznif' AND p_entry_fee=3))) OR
     (p_mode='2v2' AND NOT ((p_currency='fun' AND p_entry_fee=1500) OR (p_currency='aznif' AND p_entry_fee=7))) THEN RAISE EXCEPTION 'unsupported_domino_entry'; END IF;$new$
  );

  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'find_domino_match economy contract was not updated';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.domino_configure_room_economy()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_players integer:=CASE WHEN TG_TABLE_NAME='one_vs_one_rooms' THEN 2 ELSE 4 END;
BEGIN
  IF NEW.entry_fee<=0 AND NEW.bet_amount>0 THEN NEW.entry_fee:=NEW.bet_amount; NEW.currency:='aznif'; END IF;
  IF NEW.entry_fee<=0 THEN
    NEW.entry_fee:=CASE WHEN TG_TABLE_NAME='one_vs_one_rooms' THEN 500 ELSE 1500 END;
    NEW.currency:='fun';
  END IF;
  NEW.entry_fee:=round(NEW.entry_fee,2);
  NEW.commission_rate:=CASE WHEN NEW.currency='aznif' THEN 0.05 ELSE 0 END;
  NEW.commission_per_player:=round(NEW.entry_fee*NEW.commission_rate,2);
  NEW.total_entry:=round(NEW.entry_fee*v_players,2);
  NEW.total_commission:=round(NEW.commission_per_player*v_players,2);
  NEW.prize_pool:=round(NEW.total_entry-NEW.total_commission,2);
  RETURN NEW;
END;
$$;

-- Retire every unmatched queue lane using a removed entry configuration.
DELETE FROM public.one_vs_one_matchmaking_queue
WHERE status = 'searching'
  AND ((currency = 'aznif' AND entry_fee IN (5, 10))
    OR (currency = 'fun' AND entry_fee <> 500));

DELETE FROM public.two_vs_two_matchmaking_queue
WHERE status = 'searching'
  AND ((currency = 'aznif' AND entry_fee IN (15, 20))
    OR (currency = 'fun' AND entry_fee <> 1500));

UPDATE public.two_vs_two_rooms
SET status = 'cancelled', version = version + 1
WHERE status = 'waiting'
  AND COALESCE(metadata ->> 'source', '') NOT IN ('private_room', 'private_room_10')
  AND ((currency = 'aznif' AND entry_fee IN (15, 20))
    OR (currency = 'fun' AND entry_fee <> 1500));

UPDATE public.domino_parties party
SET flow_status = 'idle', current_room_id = NULL, current_mode = NULL,
    current_currency = NULL, current_entry_fee = NULL,
    command_version = command_version + 1, updated_at = now()
WHERE flow_status = 'matchmaking'
  AND current_game = 'domino'
  AND ((current_currency = 'aznif' AND current_entry_fee IN (15, 20))
    OR (current_currency = 'fun' AND current_entry_fee <> 1500));

REVOKE ALL ON FUNCTION public.find_domino_match(text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.find_domino_match(text,text,numeric) TO authenticated;
