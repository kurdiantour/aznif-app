-- Ensure the legacy Okey match invalidate bridge is absent.
drop trigger if exists trg_okey_match_invalidate
on okey.matches;

drop function if exists okey.broadcast_match_invalidate();
