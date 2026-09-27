'use client';

import { PURCHASES } from '../lib/orders-copy.ts';
import { Modal } from './Modal';
import { Purchases } from './Purchases';

/**
 * What this wallet has bought, in a dialog rather than a page.
 *
 * It was the page at /mis-compras, reachable from a text link in the balance
 * widget. The page cost a brand, a head and a link home for one list, and the
 * link cost the balance row a whole label. It is opened from an icon beside
 * the balance now, and `Purchases` renders `embedded` because inside a dialog
 * the heading and the way out are the dialog's.
 *
 * Nothing but the list. The card used to sit at the top of it and does not any
 * more: this is a record of what happened, and a card is a thing you use. The
 * card has its own dialog, from its own icon, beside this one.
 */
export function OrdersModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={PURCHASES.title} onClose={onClose} className="modal-orders" testId="orders-modal">
      <Purchases embedded />
    </Modal>
  );
}
