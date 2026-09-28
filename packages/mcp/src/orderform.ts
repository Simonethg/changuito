/**
 * The VTEX orderForm, for readers outside this package.
 *
 * `apps/web` needs three things the checkout flow has always had and never
 * exported: what the store will actually charge, how that number breaks down,
 * and which section the store is still waiting on. Before this barrel the web
 * app reimplemented a thin version of the first and had nothing for the other
 * two, which is how the deposit came to be quoted on a total that excludes
 * envío.
 *
 * A barrel rather than a subpath onto `adapters/orderform.js` directly: the
 * web app should see the three functions it uses, not the whole VTEX adapter
 * with its cart builders and its session plumbing. Anything added here is a
 * deliberate widening of what a non-MCP caller may depend on.
 *
 * **Everything here is pure.** No fetch, no Playwright, no browser — which is
 * what lets a Next.js route import it without dragging the adapter stack into
 * a serverless bundle.
 */
export { payableTotal, totalizerBreakdown } from './adapters/orderform.js';
export type { VtexOrderForm } from './adapters/orderform.js';
export { classifyOrderForm } from './checkout/classify/orderform.js';
export type { CheckoutState, Verdict } from './checkout/types.js';
