'use client';

import type { Product } from '@changuito/mcp/types';

import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';

/**
 * What the model chose to show, not everything it searched.
 *
 * Every number here comes from `structuredContent`, never from parsing the
 * text the model reads. That text is padded columns and AR-locale money; a
 * change in its spacing would put a wrong price on a card.
 */
export function ProductGrid({ items, note }: { items: Product[]; note?: string }) {
  const copy = uiCopy(useLang()).grid;
  if (items.length === 0) return null;
  return (
    <section className="grid-wrap" aria-label={copy.aria}>
      {note ? <p className="grid-note">{note}</p> : null}
      <ul className="grid">
        {items.map((p) => (
          <li key={`${p.skuId}-${p.sellerId}`} className="card">
            <div className="card-img">
              {p.imageUrl ? (
                // Plain <img>: these are the supermarket's own CDN URLs, which
                // change without notice. next/image would need every host
                // whitelisted up front, and a missed one is a broken page.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" loading="lazy" />
              ) : (
                <span className="card-img-empty" aria-hidden="true">🛒</span>
              )}
            </div>
            <div className="card-body">
              {p.brand ? <span className="card-brand">{p.brand}</span> : null}
              <span className="card-name">{p.name}</span>
              <span className="card-price">
                {p.price.display}
                {p.listPrice && p.listPrice.centavos > p.price.centavos ? (
                  <s className="card-was">{p.listPrice.display}</s>
                ) : null}
              </span>
              {p.unitMultiplier && p.measurementUnit ? (
                <span className="card-unit">
                  {p.unitMultiplier} {p.measurementUnit}
                </span>
              ) : null}
              {!p.available ? <span className="card-oos">{copy.outOfStock}</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
