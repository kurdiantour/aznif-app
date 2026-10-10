DO $patch$
DECLARE
  src text;
  oldfrag text := 'p_table_id like ''1v1:%''';
  newfrag text := 'trim(p_table_id) in (''fun:1v1'', ''aznif:1v1'')';
  anchor text := 'if p_action = ''matchmake'' then';
  validation text := 'trim(p_table_id) NOT IN';
  n_old integer;
BEGIN
  SELECT pg_get_functiondef('public.okey_room_action(uuid,text,uuid,text,text,text,jsonb,jsonb,timestamptz)'::regprocedure) INTO src;
  n_old := (length(src)-length(replace(src,oldfrag,'')))/length(oldfrag);
  IF n_old=3 THEN
    src := replace(src,oldfrag,newfrag);
    IF position(anchor IN src)=0 THEN RAISE EXCEPTION 'anchor_missing'; END IF;
    src := replace(src,anchor,anchor || $insert$

    IF p_table_id IS NOT NULL AND trim(p_table_id) NOT IN
      ('fun:1v1','fun:2v2','aznif:1v1','aznif:2v2')
    THEN RAISE EXCEPTION 'unknown_table' USING errcode='22023'; END IF;
$insert$);
    EXECUTE src;
  ELSIF n_old<>0 THEN
    RAISE EXCEPTION 'unrecognized_old_modes_count: %',n_old;
  END IF;
  SELECT pg_get_functiondef('public.okey_room_action(uuid,text,uuid,text,text,text,jsonb,jsonb,timestamptz)'::regprocedure) INTO src;
  IF (length(src)-length(replace(src,newfrag,'')))/length(newfrag)<>3
    OR position(validation IN src)=0
    OR position('''fun:2v2''' IN src)=0
    OR position('''aznif:2v2''' IN src)=0
  THEN RAISE EXCEPTION 'four_modes_contract_not_verified'; END IF;
END $patch$;;
