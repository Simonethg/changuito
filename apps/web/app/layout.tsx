import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import { Analytics } from '../components/Analytics';
import { ViewportLock } from '../components/ViewportLock';
import { HTML_LANG, inLang } from '../lib/lang.ts';
import { langFromCookie } from '../lib/lang-server.ts';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Chrome resizes the layout viewport with the keyboard. iOS ignores this
  // and is covered by ViewportLock reading visualViewport.
  interactiveWidget: 'resizes-content',
};

/**
 * The tab title and the description, in the language the cookie asked for.
 *
 * A function rather than a constant because the words move: this is the first
 * thing a shopper reads, in the browser tab and in a shared link, and leaving
 * it Spanish under an English page is the same mismatch `lang` below exists to
 * avoid. The template keeps its separator either way — it joins two names.
 */
export async function generateMetadata(): Promise<Metadata> {
  const lang = await langFromCookie();
  return {
    title: {
      default: inLang(lang, {
        es: 'Changuito: tu súper, sin pensarlo tanto',
        en: 'Changuito: your grocery shop, without the thinking',
      }),
      template: '%s · Changuito',
    },
    description: inLang(lang, {
      es: 'Asistente de IA para hacer el súper en Argentina. Pedí lo que necesitás, compará precios, armá el carrito y pagá con tarjeta o USDC.',
      en: 'An AI assistant for the weekly shop in Argentina. Ask for what you need, compare prices, fill the trolley and pay by card or with USDC.',
    }),
  };
}

/**
 * `lang` follows the `chg_lang` cookie rather than being fixed at es-AR.
 *
 * It is the attribute a screen reader picks its voice from and the one a
 * browser offers to translate off, so a page whose words are English while
 * this says Spanish is worse than either language on its own. Reading the
 * cookie makes the layout dynamic; the page under it is already
 * `force-dynamic`, so nothing is lost.
 *
 * `LangToggle` also writes `documentElement.lang` when it flips, because this
 * value was decided when the document was served.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await langFromCookie();
  return (
    <html lang={HTML_LANG[lang]} className={inter.variable}>
      <body className={inter.className}>
        <Analytics />
        <ViewportLock />
        {children}
      </body>
    </html>
  );
}
