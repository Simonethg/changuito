/**
 * Do the constraints actually say what the schema meant?
 *
 * The unit suite runs with no DATABASE_URL, on purpose — a unit suite that
 * needs a live Postgres is a unit suite that stops being run. So it proves
 * lib/card.ts's in-process fallback and nothing about the SQL. This proves the
 * SQL, against the real database, and the two together cover the path.
 *
 * Everything happens inside a transaction that always rolls back, so running it
 * against production is safe and the last line says so by counting the rows
 * left behind. Statements expected to fail run in a savepoint: in Postgres one
 * error aborts the whole transaction, and every statement after it dies at
 * 25P02 instead of being tested.
 *
 *   npm run db:invariants
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import nextEnv from '@next/env';
import postgres from 'postgres';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(join(ROOT, 'apps', 'web'), true, { info: () => {}, error: () => {} });

const url = (process.env.DIRECT_URL ?? '').trim();
if (!url) {
  // Without this the driver silently defaults to localhost:5432 and the run
  // dies on ECONNREFUSED, which reads like a broken script rather than an
  // unset variable.
  console.error('DIRECT_URL is not set in apps/web/.env — nothing to check against.');
  process.exit(2);
}

/** Host only, never the URL: this prints in terminals and CI logs. */
const at = (() => {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}`;
  } catch {
    return 'an unparseable DIRECT_URL';
  }
})();

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const A = 'G' + 'A'.repeat(55);
const B = 'G' + 'B'.repeat(55);
const CHAT = '11111111-1111-4111-8111-111111111111';
const CHAT2 = '22222222-2222-4222-8222-222222222222';
const GHOST = '33333333-3333-4333-8333-333333333333';
const ok = [];
const bad = [];
const check = (n, pass, d = '') => (pass ? ok : bad).push(`${n}${d ? ' — ' + d : ''}`);

/** Run a statement expected to fail, without poisoning the transaction. */
async function refuses(tx, name, sqlstate, run) {
  try {
    await tx.savepoint(run);
    check(name, false, 'the statement SUCCEEDED');
  } catch (e) {
    check(name, e.code === sqlstate, e.code === sqlstate ? '' : `got ${e.code}, wanted ${sqlstate}`);
  }
}

class Rollback extends Error {}
try {
  await sql.begin(async (tx) => {
    await refuses(tx, 'a malformed address cannot be stored', '23514', (sp) =>
      sp`insert into card_owner (network, address, card_id) values ('mainnet', 'not-a-stellar-address', 'c_1')`);
    await refuses(tx, 'an unknown network cannot be stored', '23514', (sp) =>
      sp`insert into card_owner (network, address, card_id) values ('futurenet', ${A}, 'c_1')`);

    await tx`insert into card_owner (network, address, card_id) values ('mainnet', ${A}, 'card_winner')`;
    const loser = await tx`insert into card_owner (network, address, card_id) values ('mainnet', ${A}, 'card_loser')
                           on conflict (network, address) do nothing returning card_id`;
    check('a second card for the same wallet is refused', loser.length === 0);
    const held = await tx`select card_id from card_owner where network='mainnet' and address=${A}`;
    check('the loser reads back the winner', held[0].card_id === 'card_winner', held[0].card_id);

    const tn = await tx`insert into card_owner (network, address, card_id) values ('testnet', ${A}, 'card_testnet')
                        on conflict (network, address) do nothing returning card_id`;
    check('the same wallet on testnet is a separate card', tn.length === 1);

    // 0003_card_face.sql. The face is a cache of what POST /cards handed back,
    // so it may be absent — but if it is there it has to look like the thing
    // it claims to be, or a panel renders "····" and four characters of noise.
    await refuses(tx, 'a last4 that is not four digits is refused', '23514', (sp) =>
      sp`insert into card_owner (network, address, card_id, last4) values ('mainnet', ${B}, 'c_2', '12a4')`);
    await refuses(tx, 'a last4 of the wrong length is refused', '23514', (sp) =>
      sp`insert into card_owner (network, address, card_id, last4) values ('mainnet', ${B}, 'c_2', '123')`);
    const face = await tx`insert into card_owner (network, address, card_id, last4, brand)
                          values ('mainnet', ${B}, 'c_2', '4242', 'visa') returning last4, brand`;
    check('a well-formed face is stored', face[0].last4 === '4242' && face[0].brand === 'visa');
    const blank = await tx`insert into card_owner (network, address, card_id)
                           values ('testnet', ${B}, 'c_3') returning last4, brand`;
    check('a binding with no face is still allowed', blank[0].last4 === null && blank[0].brand === null);
    await tx`delete from card_owner where address=${B}`;

    // unbindCard, which `POST /api/card/retire` runs after Vyrion has killed
    // the card, and which `POST /api/card/mine` runs when it finds a binding
    // that outlived one. Both name the card id in the WHERE clause, and this
    // is why: the id is the only thing that distinguishes "give back the card
    // I have" from "give back whatever card this wallet has now", and the two
    // differ the moment a deposit lands between reading the page and pressing
    // the button.
    const unbind = (net, addr, id) => tx`delete from card_owner
       where network=${net} and address=${addr} and card_id=${id} returning card_id`;
    check('unbinding the wrong card id removes nothing', (await unbind('mainnet', A, 'card_loser')).length === 0);
    check('and the binding is still there', (await tx`select 1 from card_owner where network='mainnet' and address=${A}`).length === 1);
    check('unbinding another wallet removes nothing', (await unbind('mainnet', B, 'card_winner')).length === 0);
    check('the testnet binding is not the mainnet one', (await unbind('testnet', A, 'card_winner')).length === 0);
    check('the right wallet and the right card unbinds', (await unbind('mainnet', A, 'card_winner')).length === 1);
    check('a second press removes nothing', (await unbind('mainnet', A, 'card_winner')).length === 0);
    // Put back, because the checks below this line expect a bound card.
    await tx`insert into card_owner (network, address, card_id) values ('mainnet', ${A}, 'card_winner')`;

    await tx`insert into chat (id, network, address, transcript) values (${CHAT}, 'mainnet', ${A}, '{"v":1}'::jsonb)`;
    await tx`insert into orders (chat_id, network, memo, address, amount_cents) values (${CHAT}, 'mainnet', 'chg-abc123', ${A}, 2450)`;
    const claim = (id) => tx`update orders set card_id=${id}, status='carded'
                             where network='mainnet' and memo='chg-abc123' and card_id is null returning card_id`;
    check('the first claim on a memo wins', (await claim('card_winner')).length === 1);
    check('the second claim on that memo is refused', (await claim('card_loser')).length === 0);

    await tx`insert into orders (chat_id, network, memo, address, amount_cents) values (${CHAT}, 'mainnet', 'chg-def456', ${A}, 3100)
             on conflict (chat_id) do update set memo=excluded.memo, amount_cents=excluded.amount_cents, status='quoted'`;
    const rows = await tx`select memo, amount_cents from orders where chat_id=${CHAT}`;
    check('a re-quote amends the one order', rows.length === 1 && rows[0].memo === 'chg-def456' && rows[0].amount_cents === 3100);

    check('another wallet cannot read the chat',
      (await tx`select transcript from chat where id=${CHAT} and address=${B}`).length === 0);

    // now() is transaction-start time, so updated_at cannot advance inside one
    // transaction. What proves the trigger is that it overwrites a stale value
    // the client supplied — which is also what stops a client backdating a row.
    await tx`update orders set updated_at = '2001-01-01T00:00:00Z' where chat_id=${CHAT}`;
    const stale = (await tx`select updated_at from orders where chat_id=${CHAT}`)[0].updated_at;
    check('the trigger overwrites a client-supplied updated_at', stale.getUTCFullYear() !== 2001,
      stale.toISOString());
    await tx`update chat set updated_at = '2001-01-01T00:00:00Z' where id=${CHAT}`;
    const staleChat = (await tx`select updated_at from chat where id=${CHAT}`)[0].updated_at;
    check('the same holds for chat', staleChat.getUTCFullYear() !== 2001, staleChat.toISOString());

    await refuses(tx, 'an order pointing at a chat that does not exist is refused', '23503', (sp) =>
      sp`insert into orders (chat_id, network, memo, address, amount_cents) values (${GHOST}, 'mainnet', 'chg-ghost', ${A}, 100)`);

    // The deposit route mints a memo before any chat id exists, so this must
    // be allowed — it is the ordinary case, not a degenerate one.
    await tx`insert into orders (network, memo, amount_cents) values ('mainnet', 'chg-nochat', 100)`;
    check('an order with no chat at all is allowed', true);

    // Several of them, which is why chat_id is UNIQUE and not the primary key:
    // Postgres permits many NULLs in a unique constraint, and each unlinked
    // order is genuinely its own.
    await tx`insert into orders (network, memo, amount_cents) values ('mainnet', 'chg-nochat-2', 100)`;
    check('two chatless orders can coexist', true);

    // attachChat is write-once: a memo cannot be re-pointed at a second
    // conversation, so replaying the request cannot edit the audit trail.
    await tx`insert into chat (id, network, address, transcript) values (${CHAT2}, 'mainnet', ${A}, '{"v":1}'::jsonb)`;
    const link = () => tx`update orders set chat_id=${CHAT2}
                           where network='mainnet' and memo='chg-nochat' and chat_id is null returning chat_id`;
    check('a chatless order can be linked to its chat', (await link()).length === 1);
    check('an order already linked cannot be re-pointed', (await link()).length === 0);

    // CHAT2 now owns chg-nochat, so pointing a second order at it must fail.
    // This is the whole reason chat_id carries a unique constraint.
    await refuses(tx, 'a second order for the same chat is refused', '23505', (sp) =>
      sp`update orders set chat_id=${CHAT2} where network='mainnet' and memo='chg-nochat-2'`);
    await refuses(tx, 'a zero-amount order is refused', '23514', (sp) =>
      sp`update orders set amount_cents = 0 where chat_id = ${CHAT}`);
    await refuses(tx, 'an invented status is refused', '23514', (sp) =>
      sp`update orders set status = 'refunded' where chat_id = ${CHAT}`);

    // markPaid, which the deposit poll runs every four seconds for as long as
    // the dialog stays open — so "safe to repeat" is not a nicety here, it is
    // the normal case. CHAT's order is at 'quoted' and has no hash.
    const paid = (hash) => tx`update orders
         set status  = case when status = 'quoted' then 'paid' else status end,
             tx_hash = coalesce(tx_hash, ${hash})
       where network='mainnet' and memo='chg-def456'
         and (status = 'quoted' or tx_hash is null)
       returning status, tx_hash`;
    const first = await paid('tx_first');
    check('the first confirmation marks the order paid',
      first.length === 1 && first[0].status === 'paid' && first[0].tx_hash === 'tx_first',
      JSON.stringify(first[0] ?? null));
    check('the next poll updates nothing at all', (await paid('tx_second')).length === 0);

    // The order moves on while the dialog is still polling. This is the one
    // that matters: a plain `set status = 'paid'` would walk it backwards.
    await tx`update orders set status='carded' where network='mainnet' and memo='chg-def456'`;
    check('a confirmation after the card is issued does not undo it',
      (await paid('tx_third')).length === 0);
    const after = (await tx`select status, tx_hash from orders where network='mainnet' and memo='chg-def456'`)[0];
    check('and the order is still carded, with the first hash on it',
      after.status === 'carded' && after.tx_hash === 'tx_first',
      `${after.status}/${after.tx_hash}`);

    // markDone, the one status the browser's word decides. CHAT's order is at
    // 'carded' with tx_first on it, which is where a shopper presses "ya lo
    // pagué" — so this is the transition as it actually happens.
    const done = (memo) => tx`update orders set status = 'done'
       where network='mainnet' and memo=${memo}
         and status in ('paid', 'carded')
       returning status`;
    check('a carded order can be closed', (await done('chg-def456')).length === 1);
    check('pressing it twice writes nothing', (await done('chg-def456')).length === 0);

    // The guard that matters. `done` is the only status a request can ask for,
    // so it must not be reachable from a state where no money arrived —
    // chg-nochat-2 is still at 'quoted' and has to stay there.
    check('an unpaid order cannot be closed', (await done('chg-nochat-2')).length === 0);
    const unpaid = (await tx`select status from orders where network='mainnet' and memo='chg-nochat-2'`)[0];
    check('and it is still unpaid afterwards', unpaid.status === 'quoted', unpaid.status);

    // Nor can it revive one that ended badly: a refunded or abandoned order
    // reading "Terminada" on /mis-compras would be the wrong lie in the wrong
    // direction.
    await tx`update orders set status='failed' where network='mainnet' and memo='chg-abc123'`;
    check('a failed order cannot be closed', (await done('chg-abc123')).length === 0);

    // Retiring a card must not cost the shopper their purchase history. The
    // orders that card paid for are a financial record; card_owner is a
    // pointer, and 'chg-abc123' still carries card_winner in its card_id
    // column. Same reasoning as the chat deletion below, one table over.
    // Read first rather than named, because the re-quote above renamed the
    // memo that holds card_winner and a literal here would quietly pass by
    // matching nothing.
    const paidFor = await tx`select memo from orders where network='mainnet' and card_id='card_winner'`;
    await tx`delete from card_owner where network='mainnet' and address=${A} and card_id='card_winner'`;
    const kept = await tx`select memo from orders where network='mainnet' and card_id='card_winner'`;
    check('retiring a card leaves the orders it paid for',
      paidFor.length === 1 && kept.length === 1 && kept[0].memo === paidFor[0].memo,
      `${paidFor.length} before, ${kept.length} after`);

    // 0002 changed this from ON DELETE CASCADE. An order is a financial record
    // and a chat is a conversation: expiring a transcript under a retention
    // policy must orphan the order, never erase the evidence money moved.
    await tx`delete from chat where id in (${CHAT}, ${CHAT2})`;
    const survivors = await tx`select memo, chat_id from orders where network='mainnet' order by memo`;
    check('deleting a chat does not delete its orders', survivors.length === 3,
      `${survivors.length} left`);
    check('the deleted chat leaves chat_id null, not a dangling id',
      survivors.every((r) => r.chat_id === null));

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) {
    console.error(`db error at ${at}: ${e.code ?? 'ERR'} ${e.message}`);
    await sql.end();
    process.exit(1);
  }
}

console.log(ok.map((s) => `  ok    ${s}`).join('\n'));
if (bad.length) console.log(bad.map((s) => `  FAIL  ${s}`).join('\n'));
console.log(`\n${ok.length} ok, ${bad.length} failed  (${at})`);

// The rollback is the claim this script makes about itself, so it is checked
// rather than asserted in a comment.
const left = await sql`select (select count(*) from card_owner) c,
                              (select count(*) from chat) h,
                              (select count(*) from orders) o`;
const { c, h, o } = left[0];
console.log(`rows left behind: card_owner=${c} chat=${h} orders=${o}`);
if (bad.length) process.exitCode = 1;
await sql.end();
