-- ============================================================================
-- Shop gem purchases — FINAL CONSOLIDATED MIGRATION
--
-- Consolidates:
--   20260622000100_shop_gem_purchases.sql
--   20260622000200_fix_purchase_or_equip_shop_item_ambiguity.sql
--   20260622000300_fix_purchase_or_equip_shop_item_category_ambiguity.sql
--
-- Final behavior:
--   - durable ownership
--   - one equipped item per supported category
--   - atomic gem/gold purchase
--   - wallet transaction audit
--   - no PL/pgSQL output-column ambiguity
-- ============================================================================



-- ============================================================================
-- 0. Shop foundation
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.shop_items (
  id text PRIMARY KEY,

  title text NOT NULL,

  description text NOT NULL,

  category text NOT NULL
    CHECK (
      category IN (
        'tables',
        'domino-skins',
        'profile-covers',
        'table_skin',
        'tile_skin',
        'avatar_frame'
      )
    ),

  price_gold integer NOT NULL
    CHECK (price_gold >= 0),

  asset_key text NOT NULL,

  active boolean NOT NULL
    DEFAULT true,

  sort_order integer NOT NULL
    DEFAULT 0,

  created_at timestamptz NOT NULL
    DEFAULT now(),

  updated_at timestamptz NOT NULL
    DEFAULT now()
);


CREATE TABLE IF NOT EXISTS public.user_shop_items (
  id uuid PRIMARY KEY
    DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  item_id text NOT NULL
    REFERENCES public.shop_items(id)
    ON DELETE RESTRICT,

  purchased_at timestamptz NOT NULL
    DEFAULT now(),

  UNIQUE (user_id, item_id)
);


CREATE INDEX IF NOT EXISTS idx_user_shop_items_user
ON public.user_shop_items (
  user_id,
  purchased_at DESC
);


ALTER TABLE public.shop_items
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_shop_items
  ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS
  "shop_items_read_active"
ON public.shop_items;

CREATE POLICY
  "shop_items_read_active"
ON public.shop_items
FOR SELECT
TO authenticated
USING (active = true);


DROP POLICY IF EXISTS
  "user_shop_items_read_own"
ON public.user_shop_items;

CREATE POLICY
  "user_shop_items_read_own"
ON public.user_shop_items
FOR SELECT
TO authenticated
USING (user_id = auth.uid());


GRANT SELECT
ON public.shop_items
TO authenticated;

GRANT SELECT
ON public.user_shop_items
TO authenticated;


-- Original production catalog entries.
INSERT INTO public.shop_items (
  id,
  title,
  description,
  category,
  price_gold,
  asset_key,
  sort_order
)
VALUES
  (
    'table-skin-midnight',
    'Midnight Table',
    'A deep blue cosmetic table finish.',
    'table_skin',
    45,
    'table-midnight',
    10
  ),
  (
    'tile-skin-ivory',
    'Ivory Tiles',
    'A clean ivory domino tile style.',
    'tile_skin',
    60,
    'tiles-ivory',
    20
  ),
  (
    'avatar-frame-violet',
    'Violet Frame',
    'A violet profile avatar frame.',
    'avatar_frame',
    30,
    'frame-violet',
    30
  )
ON CONFLICT (id) DO UPDATE
SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  price_gold = EXCLUDED.price_gold,
  asset_key = EXCLUDED.asset_key,
  sort_order = EXCLUDED.sort_order,
  active = true,
  updated_at = now();



-- ============================================================================
-- 1. Shop item constraints
-- ============================================================================

ALTER TABLE public.shop_items
  DROP CONSTRAINT IF EXISTS shop_items_price_gold_check;

ALTER TABLE public.shop_items
  ADD CONSTRAINT shop_items_price_gold_check
  CHECK (price_gold >= 0);


ALTER TABLE public.shop_items
  DROP CONSTRAINT IF EXISTS shop_items_category_check;

ALTER TABLE public.shop_items
  ADD CONSTRAINT shop_items_category_check
  CHECK (
    category IN (
      'tables',
      'domino-skins',
      'profile-covers',
      'table_skin',
      'tile_skin',
      'avatar_frame'
    )
  );


-- ============================================================================
-- 2. Equipped cosmetics
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_equipped_shop_items (
  user_id uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  category text NOT NULL
    CHECK (
      category IN (
      'tables',
      'domino-skins',
      'profile-covers',
      'table_skin',
      'tile_skin',
      'avatar_frame'
      )
    ),

  item_id text NOT NULL
    REFERENCES public.shop_items(id)
    ON DELETE RESTRICT,

  equipped_at timestamptz NOT NULL
    DEFAULT now(),

  PRIMARY KEY (user_id, category)
);


ALTER TABLE public.user_equipped_shop_items
  ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS
  "user_equipped_shop_items_read_own"
ON public.user_equipped_shop_items;

CREATE POLICY
  "user_equipped_shop_items_read_own"
ON public.user_equipped_shop_items
FOR SELECT
TO authenticated
USING (user_id = auth.uid());


GRANT SELECT
ON public.user_equipped_shop_items
TO authenticated;


-- ============================================================================
-- 3. Default shop catalog
-- ============================================================================

INSERT INTO public.shop_items (
  id,
  title,
  description,
  category,
  price_gold,
  asset_key,
  sort_order
)
VALUES
  (
    'table-classic',
    'Classic table',
    'Classic game table.',
    'tables',
    0,
    'table-classic',
    10
  ),
  (
    'table-midnight',
    'Midnight table',
    'Purple game table.',
    'tables',
    350,
    'table-midnight',
    20
  ),
  (
    'table-royal',
    'Royal table',
    'Black and gold game table.',
    'tables',
    520,
    'table-royal',
    30
  ),
  (
    'skin-ivory',
    'Ivory skin',
    'Ivory domino skin.',
    'domino-skins',
    0,
    'skin-ivory',
    10
  ),
  (
    'skin-obsidian',
    'Obsidian skin',
    'Obsidian domino skin.',
    'domino-skins',
    430,
    'skin-obsidian',
    20
  ),
  (
    'skin-aurora',
    'Aurora skin',
    'Aurora domino skin.',
    'domino-skins',
    650,
    'skin-aurora',
    30
  ),
  (
    'cover-dusk',
    'Dusk cover',
    'Dusk profile cover.',
    'profile-covers',
    0,
    'cover-dusk',
    10
  ),
  (
    'cover-gold',
    'Gold cover',
    'Gold profile cover.',
    'profile-covers',
    300,
    'cover-gold',
    20
  ),
  (
    'cover-oasis',
    'Oasis cover',
    'Oasis profile cover.',
    'profile-covers',
    480,
    'cover-oasis',
    30
  )
ON CONFLICT (id) DO UPDATE
SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  price_gold = EXCLUDED.price_gold,
  asset_key = EXCLUDED.asset_key,
  sort_order = EXCLUDED.sort_order,
  active = true,
  updated_at = now();


-- ============================================================================
-- 4. Atomic purchase or equip RPC
--
-- Output-column names from RETURNS TABLE are in PL/pgSQL scope.
-- Scalar variables and explicit aliases avoid all column ambiguity.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purchase_or_equip_shop_item(
  p_item_id text
)
RETURNS TABLE (
  status text,
  item_id text,
  category text,
  balance_after numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();

  v_item_id text;
  v_category text;
  v_price_gold integer;

  v_wallet_gold numeric;
  v_new_gold numeric;

  v_is_owned boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;


  SELECT
    si.id,
    si.category,
    si.price_gold
  INTO
    v_item_id,
    v_category,
    v_price_gold
  FROM public.shop_items AS si
  WHERE si.id = p_item_id
    AND si.active = true;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop item is unavailable';
  END IF;


  INSERT INTO public.wallets (
    user_id,
    mc,
    gold,
    updated_at
  )
  VALUES (
    v_user_id,
    0,
    0,
    now()
  )
  ON CONFLICT (user_id) DO NOTHING;


  SELECT w.gold
  INTO v_wallet_gold
  FROM public.wallets AS w
  WHERE w.user_id = v_user_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet is unavailable';
  END IF;


  v_wallet_gold := COALESCE(v_wallet_gold, 0);


  SELECT EXISTS (
    SELECT 1
    FROM public.user_shop_items AS usi
    WHERE usi.user_id = v_user_id
      AND usi.item_id = v_item_id
  )
  INTO v_is_owned;


  -- Already owned: equip without charging again.
  IF v_is_owned THEN
    INSERT INTO public.user_equipped_shop_items AS uesi (
      user_id,
      category,
      item_id,
      equipped_at
    )
    VALUES (
      v_user_id,
      v_category,
      v_item_id,
      now()
    )
    ON CONFLICT ON CONSTRAINT user_equipped_shop_items_pkey
    DO UPDATE
    SET
      item_id = EXCLUDED.item_id,
      equipped_at = EXCLUDED.equipped_at;


    RETURN QUERY
    SELECT
      'equipped'::text,
      v_item_id,
      v_category,
      v_wallet_gold;

    RETURN;
  END IF;


  -- Not enough gems/gold: do not purchase or equip.
  IF v_price_gold > 0
     AND v_wallet_gold < v_price_gold THEN
    RETURN QUERY
    SELECT
      'insufficient_gems'::text,
      v_item_id,
      v_category,
      v_wallet_gold;

    RETURN;
  END IF;


  -- Paid item: debit wallet and audit the purchase.
  IF v_price_gold > 0 THEN
    UPDATE public.wallets AS w
    SET
      gold = COALESCE(w.gold, 0) - v_price_gold,
      updated_at = now()
    WHERE w.user_id = v_user_id
    RETURNING w.gold
    INTO v_new_gold;


    INSERT INTO public.wallet_transactions (
      user_id,
      from_user_id,
      amount,
      currency,
      transaction_type,
      status,
      metadata,
      balance_before,
      balance_after
    )
    VALUES (
      v_user_id,
      v_user_id,
      v_price_gold,
      'Gold',
      'shop_purchase',
      'completed',
      jsonb_build_object(
        'item_id', v_item_id,
        'category', v_category
      ),
      v_wallet_gold,
      v_new_gold
    );
  ELSE
    v_new_gold := v_wallet_gold;
  END IF;


  -- Persist ownership.
  INSERT INTO public.user_shop_items AS usi (
    user_id,
    item_id
  )
  VALUES (
    v_user_id,
    v_item_id
  );


  -- Newly purchased/claimed items are equipped immediately.
  INSERT INTO public.user_equipped_shop_items AS uesi (
    user_id,
    category,
    item_id,
    equipped_at
  )
  VALUES (
    v_user_id,
    v_category,
    v_item_id,
    now()
  )
  ON CONFLICT ON CONSTRAINT user_equipped_shop_items_pkey
  DO UPDATE
  SET
    item_id = EXCLUDED.item_id,
    equipped_at = EXCLUDED.equipped_at;


  RETURN QUERY
  SELECT
    CASE
      WHEN v_price_gold = 0 THEN 'claimed'
      ELSE 'purchased'
    END,
    v_item_id,
    v_category,
    v_new_gold;
END;
$$;


-- ============================================================================
-- 5. Function permissions
-- ============================================================================

REVOKE ALL
ON FUNCTION public.purchase_or_equip_shop_item(text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.purchase_or_equip_shop_item(text)
TO authenticated;


-- Remove obsolete shop RPCs when they exist.
DROP FUNCTION IF EXISTS public.purchase_shop_item(text);

DROP FUNCTION IF EXISTS public.spend_gold_shop(
  uuid,
  numeric,
  jsonb
);