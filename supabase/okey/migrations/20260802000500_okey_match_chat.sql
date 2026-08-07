-- ============================================================================
-- Okey match chat
--
-- Responsibility:
--   - store chat messages for one Okey match
--   - allow only match participants to post messages
--   - keep chat isolated from economy, settlement, refund, and gameplay state
--
-- This migration assumes these objects already exist:
--   - okey schema
--   - okey.matches
--   - okey.match_seats
--   - auth.users
-- ============================================================================


-- ============================================================================
-- 1. Chat table
-- ============================================================================

create table if not exists okey.match_chat_messages (
  id uuid primary key default gen_random_uuid(),

  match_id uuid not null
    references okey.matches(id)
    on delete cascade,

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  body text not null
    check (char_length(body) between 1 and 500),

  created_at timestamptz not null default now()
);


-- ============================================================================
-- 2. Indexes
-- ============================================================================

create index if not exists okey_match_chat_messages_match_created_idx
  on okey.match_chat_messages(match_id, created_at, id);

create index if not exists okey_match_chat_messages_user_created_idx
  on okey.match_chat_messages(user_id, created_at);


-- ============================================================================
-- 3. RLS and table permissions
-- ============================================================================

alter table okey.match_chat_messages
  enable row level security;

revoke all on table okey.match_chat_messages
  from public, anon, authenticated;

grant select, insert, update, delete
  on table okey.match_chat_messages
  to service_role;


-- ============================================================================
-- 4. Post chat message
--
-- Rules:
--   - service_role only
--   - user must occupy a seat in the match
--   - message is trimmed
--   - empty messages are rejected
--   - body length is limited to 500 characters
-- ============================================================================

create or replace function public.okey_post_chat_message(
  p_match_id uuid,
  p_user_id uuid,
  p_body text
)
returns okey.match_chat_messages
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_message okey.match_chat_messages%rowtype;
  v_body text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_match_id is null then
    raise exception 'match_id_required'
      using errcode = '22023';
  end if;

  if p_user_id is null then
    raise exception 'user_id_required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from okey.matches match
    where match.id = p_match_id
  ) then
    raise exception 'match_not_found'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from okey.match_seats seat
    where seat.match_id = p_match_id
      and seat.user_id = p_user_id
  ) then
    raise exception 'not_a_participant'
      using errcode = '42501';
  end if;

  v_body :=
    left(
      trim(
        coalesce(p_body, '')
      ),
      500
    );

  if char_length(v_body) = 0 then
    raise exception 'empty_message'
      using errcode = '22023';
  end if;

  insert into okey.match_chat_messages (
    match_id,
    user_id,
    body
  )
  values (
    p_match_id,
    p_user_id,
    v_body
  )
  returning *
  into v_message;

  return v_message;
end;
$$;


-- ============================================================================
-- 5. Function permissions
-- ============================================================================

revoke all on function public.okey_post_chat_message(
  uuid,
  uuid,
  text
)
from public, anon, authenticated;

grant execute on function public.okey_post_chat_message(
  uuid,
  uuid,
  text
)
to service_role;