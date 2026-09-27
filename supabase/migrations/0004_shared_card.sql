-- A card record the operator writes by hand, and who is allowed to read it.
--
-- ## This reverses 0001's header, deliberately
--
-- 0001 says "No card data anywhere … PAN and CVV are read per view and never
-- written down", and 0003 repeated it. That promise held because the provider
-- was the source of truth and every view cost a call to it. It does not hold
-- here: the card in `shared_card` is created in the provider's dashboard by a
-- person, not by `POST /cards`, so there is no binding to look it up from and
-- nothing to read per view. The numbers either live in this table or the
-- feature does not exist.
--
-- What that costs, written down so nobody has to rediscover it:
--
--   * a PAN and a CVV sit at rest here, and therefore in every backup, in any
--     query log, and in front of anyone with dashboard access;
--   * everyone on `shared_card_member` reads the same numbers, so the balance
--     is spent in common and no row here attributes a charge to anybody;
--   * removing an address from the member list stops the app showing them the
--     card. It does not unsee a number they already copied. Rotating the card
--     in the provider is the only revocation that is worth anything.
--
-- `card_owner` is untouched and still means what it meant. A wallet can have a
-- row there and a membership here; they are different mechanisms and the
-- reader in apps/web/lib/shared-card.ts checks this one first.
--
-- ## Expiry columns, which 0003 argued against
--
-- 0003 refused `exp_month`/`exp_year` because expiry arrives only from the
-- rate-limited details endpoint, so a column for it "could never be filled at
-- bind time and would be a promise the schema does not keep". That reasoning
-- was about a row written by `bindCard` at creation. This row is typed in from
-- the plastic, expiry included, so the column is fillable by construction.
-- The two decisions do not conflict; they are about different rows.

-- ------------------------------------------------------------- the record --

-- `network` is the whole primary key, which is what makes this a singleton per
-- network rather than a convention the application remembers - the same trick
-- card_owner plays with (network, address). A second mainnet card cannot be
-- inserted, so no route has to decide which of two is current.
--
-- No `last4` column: it is `pan.slice(-4)` in the reader, and a stored copy is
-- one more field to mistype and a way for the face to disagree with the number
-- under it. Contrast card_owner, where last4 is cached precisely because the
-- app does not hold the PAN.
create table shared_card (
  network      network_id  not null primary key,
  -- The provider's id for the card. Not used to fetch anything - nothing here
  -- is fetched - but a charge that needs chasing is chased by this.
  card_id      text        not null,
  pan          text        not null check (pan ~ '^[0-9]{13,19}$'),
  cvv          text        not null check (cvv ~ '^[0-9]{3,4}$'),
  -- Two digits and two digits, as printed and as the checkout form wants them.
  exp_month    text        not null check (exp_month ~ '^(0[1-9]|1[0-2])$'),
  exp_year     text        not null check (exp_year  ~ '^[0-9]{2}$'),
  holder       text        not null,
  brand        text        not null,
  -- What was loaded, in USD cents, for display only. Nullable because nothing
  -- decrements it as the card is spent: left null the balance row is hidden,
  -- which is honest, where a figure that never moves is not.
  funded_cents integer         null check (funded_cents is null or funded_cents >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Unlike card_owner, this table exists to be edited - a card gets rotated, a
-- balance gets topped up - so the trigger 0003 correctly refused there is
-- worth having here.
create trigger shared_card_touch before update on shared_card
  for each row execute function touch_updated_at();

-- ------------------------------------------------------------ who may read --

-- A table and not an environment variable because membership changes without
-- a deploy, and because the thing it gates is a card number: adding somebody
-- should not mean editing a deployment's configuration and waiting for a
-- build. REAL_MODE_ALLOWLIST_ADDRESSES still gates mainnet access upstream of
-- this, so a member must be on both.
create table shared_card_member (
  network    network_id      not null,
  address    stellar_address not null,
  -- Who this is, for whoever reads the table in six months. Free text: it is
  -- an operator's note and nothing reads it.
  note       text,
  created_at timestamptz     not null default now(),
  primary key (network, address)
);

-- ----------------------------------------------------------------- guards --

-- Same reasoning as 0001, and it matters more here than anywhere else in the
-- schema: with RLS off, a misconfigured client holding the anon key reads a
-- live PAN. Enabled with no policies, it reads nothing. The server connects
-- with service credentials and bypasses this.
alter table shared_card        enable row level security;
alter table shared_card_member enable row level security;
