-- ============================================================================
-- Okey room lifecycle only
--
-- Handles:
--   matchmaking
--   four-player rooms
--   team assignment
--   heartbeat / presence
--   reconnect
--   waiting-room countdown
--   authoritative match start
--   leave lifecycle
--
-- No Domino object is referenced.
-- ============================================================================


-- ============================================================================
-- 1. Match and seat fields
-- ============================================================================

alter table okey.matches
  add column if not exists table_id text,

  add column if not exists room_code text,

  add column if not exists created_by uuid
    references auth.users(id)
    on delete set null,

  add column if not exists countdown_deadline_at timestamptz;


alter table okey.match_seats
  add column if not exists display_name text
    not null default '',

  add column if not exists avatar_url text,

  add column if not exists connected boolean
    not null default true,

  add column if not exists last_seen_at timestamptz
    not null default now(),

  add column if not exists membership_released_at timestamptz,

  add column if not exists membership_release_reason text;


-- Every generated room code must be unique.
create unique index if not exists okey_matches_room_code_uidx
  on okey.matches(room_code)
  where room_code is not null;


-- A player can occupy only one seat in a match.
create unique index if not exists okey_match_seats_match_user_uidx
  on okey.match_seats(match_id, user_id);


-- A player index can be occupied only once in a match.
create unique index if not exists okey_match_seats_match_player_index_uidx
  on okey.match_seats(match_id, player_index);


-- Speeds up searching for available waiting rooms.
create index if not exists okey_waiting_matchmaking_idx
  on okey.matches(table_id, created_at)
  where status = 'waiting';


-- Speeds up active-match lookup for reconnect and duplicate prevention.
create index if not exists okey_match_seats_user_idx
  on okey.match_seats(user_id, match_id);


-- ============================================================================
-- 2. Room action
-- ============================================================================

-- Final okey_room_action is defined in 20260813000400_okey_membership_release.sql.
