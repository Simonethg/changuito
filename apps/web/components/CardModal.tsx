'use client';

import { useEffect } from 'react';

import { KEPT_CARD } from '../lib/orders-copy.ts';
import { useKeptCard } from '../lib/use-kept-card.ts';
import type { NetworkId } from '../lib/deployments.ts';
import type { WalletSigner } from '../lib/wallet-proof.ts';
import { CardFace } from './CardFace';
import { Modal } from './Modal';

/**
 * The card, opened from beside the balance rather than from inside a checkout.
 *
 * This is the surface the old "Mis compras" link used to occupy, and the swap
 * is the point of the change: the record of what you bought is a thing you
 * consult, and the card is a thing you *use* — you are standing in the súper's
 * payment form with the numbers on the other screen. That belongs one press
 * from the balance; the record belongs in the profile.
 *
 * ## It reads before it offers to create
 *
 * Opening asks the server what card this wallet has, because the answer
 * decides which of the two things this dialog is. A "generar" button rendered
 * before the answer arrives is a button that mints a second card for somebody
 * who has one — the server would refuse, `card_owner` is unique per wallet,
 * but they would still have pressed it and watched it fail.
 *
 * ## The numbers are held here and nowhere else
 *
 * `card.pan` and `card.cvv` come down per request and live in this
 * component's state. Closing the dialog unmounts it and they are gone. They
 * are never written to localStorage, never logged, and `useKeptCard` explains
 * why it does not cache them across mounts either.
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
  const { card, frozen, busy, error, load, create } = useKeptCard(address, network, sign);

  // Once, on open. `load` is stable per address+network, and the hook holds an
  // in-flight ref besides, so a double-invoked effect in development is one
  // request rather than two.
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal title={KEPT_CARD.title} onClose={onClose} className="modal-card" testId="card-modal">
      {card === undefined && busy ? (
        <p className="purchases-lead" role="status">
          {KEPT_CARD.loading}
        </p>
      ) : null}

      {card ? (
        <>
          <p className="purchases-lead">{KEPT_CARD.lead}</p>
          <CardFace
            card={card}
            labels={{ number: 'Número', expiry: 'Vence', cvv: 'CVV' }}
            idPrefix="card-modal"
          />
          <dl className="ck-fields">
            <div>
              <dt>{KEPT_CARD.balanceLabel}</dt>
              <dd data-testid="card-modal-balance">{card.fundedDisplay}</dd>
            </div>
          </dl>
          {frozen ? (
            <p className="pay-warn" role="status" data-testid="card-modal-frozen">
              {KEPT_CARD.frozen}
            </p>
          ) : null}
        </>
      ) : null}

      {card === null ? (
        <>
          <p className="purchases-lead" data-testid="card-modal-none">
            {KEPT_CARD.none}
          </p>
          <button
            type="button"
            className="btn"
            data-testid="card-modal-create"
            onClick={() => void create()}
            disabled={busy}
          >
            {busy ? KEPT_CARD.creating : KEPT_CARD.createCta}
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
