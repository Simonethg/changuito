import { DEFAULT_LANG, type Lang } from './lang.ts';

/**
 * What each tool is doing, in the user's language. Shared by the tool trail
 * and the waiting line under the composer, so the two never disagree about
 * what the same call is called.
 *
 * The keys are the MCP tool names and never move; only the sentences do.
 */
export const TOOL_LABELS: Record<string, string> = {
  set_location: 'Ubicando la sucursal',
  search_products: 'Buscando productos',
  price_check: 'Verificando precios',
  add_to_cart: 'Agregando al carrito',
  update_cart_line: 'Ajustando cantidades',
  remove_from_cart: 'Sacando del carrito',
  view_cart: 'Revisando el carrito',
  get_cart_link: 'Armando el link del carrito',
  list_retailers: 'Mirando qué supermercados hay',
  compare_retailers: 'Comparando supermercados',
  render_products: 'Mostrando productos',
  render_cart: 'Mostrando el carrito',
};

const TOOL_LABELS_EN: Record<string, string> = {
  set_location: 'Finding the branch',
  search_products: 'Searching for products',
  price_check: 'Checking prices',
  add_to_cart: 'Adding to the trolley',
  update_cart_line: 'Adjusting quantities',
  remove_from_cart: 'Taking out of the trolley',
  view_cart: 'Looking at the trolley',
  get_cart_link: 'Putting the trolley link together',
  list_retailers: 'Seeing which supermarkets there are',
  compare_retailers: 'Comparing supermarkets',
  render_products: 'Showing products',
  render_cart: 'Showing the trolley',
};

export function toolLabels(lang: Lang = DEFAULT_LANG): Record<string, string> {
  return lang === 'en' ? TOOL_LABELS_EN : TOOL_LABELS;
}
