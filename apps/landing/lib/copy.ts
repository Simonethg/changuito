/**
 * Marketing copy.
 *
 * APP_URL is the shopper origin. It stays for SEO and docs.
 * During the controlled beta, visitor CTAs go to /whitelist on this site
 * and must not navigate to APP_URL.
 *
 * Headings carry the story. Each section says one thing, once.
 */

export const APP_URL = 'https://app.changuito.me';
export const SITE_URL = 'https://www.changuito.me';

export const HERO = {
  h1Lead: 'Decile qué querés cocinar.',
  h1Rest: 'Changuito te arma el carrito.',
  sub: 'Compara precios entre supermercados y te deja el carrito listo para pagar con tarjeta o USDC.',
  cta: 'Probar Changuito',
} as const;

export const NAV = [
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#pagos', label: 'Pagos' },
  { href: '#faq', label: 'Ayuda' },
] as const;

export const STEPS_TITLE = 'Le hablás como a alguien de tu casa';

export const STEPS = [
  {
    icon: 'ask',
    title: 'Pedís en tus palabras',
    body: 'La lista, una receta o el asado, como se lo dirías en casa.',
  },
  {
    icon: 'compare',
    title: 'Compara precios en vivo',
    body: 'Jumbo, Disco, Carrefour y Día, en el momento.',
  },
  {
    icon: 'pay',
    title: 'Confirmás y pagás',
    body: 'Revisás el carrito y seguís si te cierra.',
  },
] as const;

export const COMPARE = {
  title: 'Compara entre súper y te muestra cuánto ahorrás',
  body: 'El mismo producto no cuesta igual en cada cadena. Changuito los pone juntos y te muestra la diferencia.',
} as const;

export const USES_TITLE = 'Para la semana, el asado o el plan de tu nutricionista';

export const USES = [
  {
    title: 'Asado para 12',
    body: 'Carne, carbón y pan, con las cantidades para el sábado.',
  },
  {
    title: 'Plan del nutricionista',
    body: 'Pasás la lista de la semana y la busca en el súper.',
  },
  {
    title: 'Presupuesto semanal $40.000',
    body: 'Le marcás el tope y el changuito entra en ese número.',
  },
  {
    title: 'Viandas para los chicos',
    body: 'Almuerzos de lunes a viernes, listos para confirmar.',
  },
] as const;

/** Shown once, in the payments section. Do not repeat this sentence. */
export const NO_CHARGE = 'Si la compra no se completa, no realizás ningún pago.';

export const PAYMENTS = {
  title: 'Pagá con tarjeta o USDC',
  assurance: NO_CHARGE,
} as const;

export const FAQ_TITLE = 'Preguntas frecuentes';

export const FAQ = [
  {
    q: '¿Es un supermercado?',
    a: 'No. Changuito arma el carrito y la compra sigue en la cadena.',
  },
  {
    q: '¿Tengo que nombrar cada producto?',
    a: 'No. Alcanza con decir qué vas a cocinar y para cuántos.',
  },
  {
    q: '¿Puedo cambiar lo que armó?',
    a: 'Sí. Podés sacar o sumar productos antes de pagar.',
  },
  {
    q: '¿Cómo me anoto a la beta?',
    a: 'Dejás tu mail en la lista y te escribimos.',
  },
] as const;

export const BOFU = {
  title: 'Sumate a la beta',
  lead: 'Anotate y te avisamos para la próxima ronda.',
  cta: 'Sumate a la beta',
} as const;

/**
 * Legal note and site label. The year, the registered mark, and the
 * founder names are not here: they live in `@changuito/trust` and render
 * once through `FounderTrust`, so a second copyright line cannot stack.
 */
export const FOOTER = {
  legal: 'Changuito te ayuda a armar el súper. No es un supermercado.',
  siteLabel: 'www.changuito.me',
} as const;

/** Public social profiles. Keep labels short; aria-labels carry the brand. */
export const SOCIAL = [
  {
    href: 'https://x.com/appchanguito',
    label: 'X',
    ariaLabel: 'Changuito en X',
    icon: 'x',
  },
  {
    href: 'https://instagram.com/appchanguito',
    label: 'Instagram',
    ariaLabel: 'Changuito en Instagram',
    icon: 'instagram',
  },
  {
    href: 'https://www.linkedin.com/company/appchanguito/',
    label: 'LinkedIn',
    ariaLabel: 'Changuito en LinkedIn',
    icon: 'linkedin',
  },
] as const;

export const DESCRIPTION =
  'En Argentina, Changuito compara precios entre supermercados y te deja el carrito listo para pagar con tarjeta o USDC.';
