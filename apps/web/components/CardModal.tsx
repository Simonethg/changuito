'use client';

import { useEffect, useState } from 'react';

import { keptCardCopy } from '../lib/orders-copy.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { useKeptCard } from '../lib/use-kept-card.ts';
import type { NetworkId } from '../lib/deployments.ts';
import type { WalletSigner } from '../lib/wallet-proof.ts';
import { CardFace } from './CardFace';
import { useLang } from './LangProvider';
import { Modal } from './Modal';

/**
 * The card: the only place it lives.
 *
 * It used to be in two — a summary with the retire button at the top of the
 * purchases list, and the numbers inside the checkout dialog — and the
 * purchases list is a record of what was bought, which a card is not. So the
 * record went to its own dialog and the card came here: read it, make it if
 * there is none, give it back. One press from the balance, because that is
 * where somebody standing in the súper's payment form looks for it.
 *
 * ## It reads before it offers to create
 *
 * Opening asks the server what card this wallet has, because the answer
 * decides which of the two things this dialog is. A "generar" button rendered
 * before the answer arrives is a button that mints a second card for somebody
 * who has one — the server would refuse, `card_owner` is unique per wallet,
 * but they would still have pressed it and watched it fail.
 *
 * ## Two presses to give it back, and a warning between them
 *
 * `retire` is irreversible and returns money, so the button does not do it —
 * it asks. The warning is the whole warning, before the second press rather
 * than after it, and it is a plain pair of buttons rather than `confirm()`,
 * which is a modal dialog the browser owns and Playwright cannot see.
 *
 * ## The numbers are held here and nowhere else
 *
 * `card.pan` and `card.cvv` come down per request and live in this component's
 * state. Closing the dialog unmounts it and they are gone. They are never
 * written to localStorage, never logged, and `useKeptCard` explains why it
 * does not cache them across mounts either.
 */
export function CardModal({
  address,
  network,
  sign,
  onClose,
}: {
  address: string;
  network: NetworkId;
  sign: WalletSigner;
  onClose: () => void;
}) {
  const lang = useLang();
  const copy = keptCardCopy(lang);
  const labels = uiCopy(lang).card;
  const { card, frozen, shared, busy, error, gone, load, create, retire } = useKeptCard(address, network, sign, lang);
  const [confirming, setConfirming] = useState(false);

  // Once, on open. `load` is stable per address+network, and the hook holds an
  // in-flight ref besides, so a double-invoked effect in development is one
  // request rather than two.
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal title={copy.title} onClose={onClose} className="modal-card" testId="card-modal">
      {card === undefined && busy ? (
        <p className="purchases-lead" role="status">
          {copy.loading}
        </p>
      ) : null}

      {card ? (
        <>
          <p className="purchases-lead">{copy.lead}</p>
          <CardFace
            card={card}
            labels={labels}
            idPrefix="card-modal"
          />
          {/* Only when there is a figure. A shared record may carry no amount,
              and nothing decrements one that is there, so an empty balance is
              left out rather than shown as a blank or a number that was true
              once. See 0004_shared_card.sql. */}
          {card.fundedDisplay ? (
            <dl className="ck-fields">
              <div>
                <dt>{copy.balanceLabel}</dt>
                <dd data-testid="card-modal-balance">{card.fundedDisplay}</dd>
              </div>
            </dl>
          ) : null}
          {frozen ? (
            <p className="pay-warn" role="status" data-testid="card-modal-frozen">
              {copy.frozen}
            </p>
          ) : null}

          {/* Not offered for a shared record: it is not this wallet's to
              destroy, and `terminateCard` would take it from everyone else on
              the list with no way back. `/api/card/retire` refuses it too. */}
          {shared ? null : confirming ? (
            <div className="card-retire-confirm" data-testid="card-modal-confirm">
              <p className="pay-warn">{copy.retireWarn}</p>
              <button
                type="button"
                className="btn btn-warn"
                data-testid="card-modal-retire-yes"
                onClick={() => void retire()}
                disabled={busy}
              >
                {busy ? copy.retiring : copy.retireConfirm}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                {copy.retireCancel}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="card-modal-retire"
              onClick={() => setConfirming(true)}
            >
              {copy.retireCta}
            </button>
          )}
        </>
      ) : null}

      {card === null ? (
        <>
          <p className="purchases-lead" data-testid="card-modal-none">
            {gone ? copy.retired : copy.none}
          </p>
          <button
            type="button"
            className="btn"
            data-testid="card-modal-create"
            onClick={() => void create()}
            disabled={busy}
          >
            {busy ? copy.creating : copy.createCta}
          </button>
        </>
      ) : null}

      {error ? (
        <p className="pay-warn" role="status" data-testid="card-modal-error">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
