-- The face of the card, so showing a customer which card they have does not
-- cost a call to the provider.
--
-- `card_id` alone has always been enough to *use* the binding, but every
-- surface that wants to say "la que termina en 4242" had to ask Vyrion for it,
-- and `GET /cards/{id}/details` is rate limited to 30/min for the whole
-- account. A profile panel that opens on every visit would spend that budget
-- on a string that never changes.
--
-- Only what `POST /cards` already hands back at creation: last4 and the brand.
-- Not the expiry — that arrives only from the details endpoint, so a column
-- for it could never be filled at bind time and would be a promise the schema
-- does not keep. And emphatically not the PAN or the CVV, which are read per
-- view and written nowhere, exactly as 0001's header says.
--
-- Nullable because every row written before today has neither, and because
-- this is a cache: Vyrion stays the truth. A caller that finds them null asks.
--
-- No `updated_at` and no touch trigger, unlike `chat` and `orders`. Nothing
-- updates this table — `bindCard` is `insert … on conflict do nothing` and
-- `unbindCard` deletes — so a trigger here would be machinery for an event
-- that cannot happen.

alter table card_owner
  add column last4 text,
  add column brand text;

alter table card_owner
  add constraint card_owner_last4_shape check (last4 is null or last4 ~ '^[0-9]{4}$');
