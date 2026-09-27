'use client';

import { useEffect, useRef } from 'react';

import type { Lang } from '../lib/lang.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';

import type { ChatSummary, OrderState } from './ShopProvider';
import { useShop } from './ShopProvider';

/**
 * Past shops, newest first.
 *
 * One chat is one order, so this list is also the list of orders — which is
 * why each row carries its state rather than only a title. A paid chat is a
 * receipt: it opens read-only, because the conversation behind it has expired
 * on the server and a page that let you keep typing into it would be showing
 * a continuity that no longer exists.
 *
 * On a narrow window it is an off-canvas drawer over the chat rather than a
 * column, because there is no third column to be. The cart has no drawer: the
 * card in the thread already shows it, and two ways to see one basket on a
 * 390px screen is one too many.
 */

/** `none` has no chip at all, which is why it is a null and not a word. */
function stateChip(lang: Lang): Record<OrderState, string | null> {
  const copy = uiCopy(lang).history;
  return { none: null, open: copy.open, paid: copy.paid };
}

export function HistoryRail({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lang = useLang();
  const copy = uiCopy(lang).history;
  const shop = useShop();
  const panel = useRef<HTMLDivElement>(null);

  // Escape closes the drawer. Only while it is open as a drawer — on a wide
  // window it is a column and there is nothing to dismiss.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const chats = shop?.chats ?? [];

  return (
    <>
      {/* Rendered only as the drawer's backdrop; CSS hides it on a wide
          window, where the rail is a column and nothing is covered. */}
      {open ? <div className="rail-scrim" onClick={onClose} aria-hidden="true" /> : null}
      <aside
        ref={panel}
        className={open ? 'rail rail-history is-open' : 'rail rail-history'}
        aria-label={copy.aria}
      >
        <div className="rail-history-head">
          <span className="rail-history-title">{copy.title}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm rail-history-close"
            onClick={onClose}
            aria-label={copy.close}
          >
            ✕
          </button>
        </div>

        <button
          type="button"
          className="btn btn-sm rail-new"
          data-testid="new-chat"
          onClick={() => {
            shop?.newChat();
            onClose();
          }}
        >
          {copy.newChat}
        </button>

        {chats.length === 0 ? (
          <p className="rail-history-empty">{copy.empty}</p>
        ) : (
          <ul className="rail-history-list">
            {chats.map((c) => (
              <HistoryRow
                key={c.id}
                chat={c}
                lang={lang}
                active={c.id === shop?.activeChatId}
                onOpen={() => {
                  shop?.openChat(c.id);
                  onClose();
                }}
              />
            ))}
          </ul>
        )}
      </aside>
    </>
  );
}

function HistoryRow({
  chat,
  active,
  lang,
  onOpen,
}: {
  chat: ChatSummary;
  active: boolean;
  lang: Lang;
  onOpen: () => void;
}) {
  const state = stateChip(lang)[chat.orderState];
  return (
    <li>
      <button
        type="button"
        className={active ? 'rail-history-row is-active' : 'rail-history-row'}
        data-testid="chat-row"
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
      >
        <span className="rail-history-row-title">{chat.title}</span>
        {state ? <span className={`rail-chip rail-chip-${chat.orderState}`}>{state}</span> : null}
      </button>
    </li>
  );
}
