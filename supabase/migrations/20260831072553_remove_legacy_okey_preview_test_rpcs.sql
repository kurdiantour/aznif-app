-- These preview-test RPCs predate the current admin-only okey_test_match
-- gateway. Drop every legacy overload so old environments converge with the
-- repository source of truth without affecting okey_create_preview_test_match.
do $$
declare
  legacy_function record;
begin
  for legacy_function in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc as p
    join pg_namespace as n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname::text = any (array[
        'okey_get_active_preview_test_match',
        'okey_get_preview_test_bot_accounts',
        'okey_register_preview_test_bot_account'
      ])
  loop
    execute format(
      'drop function if exists %I.%I(%s)',
      legacy_function.schema_name,
      legacy_function.function_name,
      legacy_function.identity_arguments
    );
  end loop;
end;
$$;
