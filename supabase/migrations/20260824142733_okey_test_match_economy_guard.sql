create or replace function okey.reject_test_match_wallet_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.match_id is not null and exists (
    select 1
    from okey.matches m
    where m.id = new.match_id
      and m.is_test
  ) then
    raise exception 'test_match_economy_forbidden'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function okey.reject_test_match_wallet_ledger() from public, anon, authenticated;

drop trigger if exists reject_test_match_wallet_ledger
  on okey.wallet_ledger;

create trigger reject_test_match_wallet_ledger
before insert or update of match_id
on okey.wallet_ledger
for each row
execute function okey.reject_test_match_wallet_ledger();
