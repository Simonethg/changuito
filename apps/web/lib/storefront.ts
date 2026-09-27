/**
 * The storefronts whose checkout we are allowed to put in a frame.
 *
 * Why this list exists at all: the shopper finishes the purchase on the
 * supermarket's own checkout page, and we show it inside the chat rather than
 * sending them away. A cross-origin frame is only possible when two things
 * hold, and neither is ours to control:
 *
 * 1. The store does not refuse framing. Verified by hand, 2026-09-25:
 *    `https://diaonline.supermercadosdia.com.ar/checkout` answers 200 with no
 *    `x-frame-options` and no CSP, while `/` on the same host answers with
 *    `x-frame-options: SAMEORIGIN`. VTEX serves checkout from a different edge
 *    config. All four stores here run the same VTEX IO stack.
 * 2. Our own CSP names the origin in `frame-src` — see security-headers.ts.
 *
 * (1) is a fact about someone else's CDN today, not a contract. Every caller
 * has to keep working when a store starts refusing, which is why the checkout
 * modal always offers "abrir en una pestaña" as an equal path rather than a
 * fallback bolted on after a failure it cannot detect.
 *
 * Kept here rather than imported from @changuito/mcp because next.config.ts
 * imports security-headers.ts directly, and dragging the MCP package into the
 * build config to read four strings is a bad trade. lib/test/storefront.test.ts
 * reads the registry as text and fails if the two lists drift.
 */

/** Host per retailer id, mirroring packages/mcp/src/adapters/registry.ts. */
export const STOREFRONT_HOSTS: Readonly<Record<string, string>> = {
  jumbo: 'www.jumbo.com.ar',
  disco: 'www.disco.com.ar',
  carrefour: 'www.carrefour.com.ar',
  dia: 'diaonline.supermercadosdia.com.ar',
};

/** `https://host` for every storefront. What `frame-src` needs. */
export const STOREFRONT_ORIGINS: readonly string[] = Object.values(STOREFRONT_HOSTS)
  .map((host) => `https://${host}`)
  .sort();

/**
 * Where the shopper can see the order they just placed.
 *
 * The frame dies at the end of a successful checkout and that is not a bug:
 * VTEX serves `/checkout` with no `x-frame-options` and the order confirmation
 * page that follows it with `SAMEORIGIN`, so the last thing a shopper sees of
 * their own purchase is the browser refusing to draw it. Nothing about that is
 * ours to fix — it is the store's header on the store's page — so the answer is
 * to stop showing the frame and hand over a link that opens properly.
 *
 * **It points at the list, not at the order.** The order id only ever exists in
 * the URL of that refused page, which is the one place we cannot read; VTEX's
 * public API will not name an order to an unauthenticated caller either. The
 * list is one tap further and it is true, which a guessed id would not be — and
 * the order the shopper just placed is the first one on it.
 *
 * `#/my-orders` is a client-side route, so the fragment never reaches the
 * server and this cannot be checked with a request. It is the path Día's own
 * account pages use.
 */
export function storeOrdersUrl(retailer: string): string | null {
  const host = STOREFRONT_HOSTS[retailer];
  return host ? `https://${host}/account#/my-orders` : null;
}

/**
 * Whether this URL may be put in a frame.
 *
 * Checked at the point of use, not only when the URL is built, because the
 * `handoffUrl` that ends up here came from a tool result — and a tool result
 * is data. An unrecognised origin opens in a tab instead of a frame; it is
 * never blocked, because the shopper is entitled to their own cart either way.
 */
export function isFramableCheckout(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (!STOREFRONT_ORIGINS.includes(parsed.origin)) return false;
  // Only the checkout path is framable; the storefront root sends SAMEORIGIN.
  return parsed.pathname === '/checkout' || parsed.pathname.startsWith('/checkout/');
}
