'use client';

import { useEffect } from 'react';

import { POLLAR_ATTR_ES, POLLAR_SCOPE, translatePollarTree } from '../lib/pollar-es.ts';
import { useLang } from './LangProvider';

/**
 * Keeps Pollar's modals in Spanish. Renders nothing. See lib/pollar-es.ts for
 * why this is an observer and not a prop.
 *
 * The observer watches the whole body because the overlay mounts and unmounts
 * with the modal, but it does work only for records inside that overlay, so a
 * streaming chat reply costs one `closest()` per mutation.
 *
 * With the footer set to English there is nothing to do: Pollar's own copy is
 * already English, and translating it into Spanish would put the one part of
 * the page nobody here wrote into the language the reader just switched away
 * from. So the effect returns before observing anything. A modal left open
 * across a toggle keeps the words it was built with — it remounts on the next
 * open, which is where the change shows.
 */
export function PollarSpanish() {
  const lang = useLang();
  useEffect(() => {
    if (lang !== 'es') return;
    const elementOf = (node: Node): Element | null =>
      node instanceof Element ? node : node.parentElement;

    document.querySelectorAll(POLLAR_SCOPE).forEach(translatePollarTree);

    const observer = new MutationObserver((records) => {
      const scopes = new Set<Element>();
      for (const r of records) {
        const inside = elementOf(r.target)?.closest(POLLAR_SCOPE);
        if (inside) scopes.add(inside);
        // The overlay itself arriving: it is the added node, or inside one.
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          const overlay = n.closest(POLLAR_SCOPE) ?? n.querySelector(POLLAR_SCOPE);
          if (overlay) scopes.add(overlay);
        });
      }
      scopes.forEach(translatePollarTree);
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: Object.keys(POLLAR_ATTR_ES),
    });
    return () => observer.disconnect();
  }, [lang]);

  return null;
}
