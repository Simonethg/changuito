import { Chat } from '../components/Chat';
import { Deck } from '../components/Deck';
import { HistoryToggle } from '../components/HistoryToggle';
import { FooterSocial } from '../components/FooterSocial';
import { FounderTrust } from '../components/FounderTrust';
import { HumanGate } from '../components/HumanGate';
import { NetworkProvider } from '../components/NetworkProvider';
import { ShopProvider } from '../components/ShopProvider';
import { WalletProvider } from '../components/WalletProvider';
import { WalletWidget } from '../components/WalletWidget';
import { turnstileSiteKey } from '../lib/human-gate';

// The site key has to be read per request. A static prerender baked siteKey:""
// and the widget never appeared, even after the env var existed at runtime.
export const dynamic = 'force-dynamic';

export default function Home() {
  // Runtime read, not the client bundle. The widget key is public.
  const siteKey = turnstileSiteKey();
  return (
    // Outside the wallet on purpose: the mode decides which chain and which
    // key that provider is built with, so it has to be decided above it.
    <NetworkProvider>
      <WalletProvider>
        <ShopProvider>
          <Deck>
            <main className="shell">
              <header className="masthead">
                <div className="brand">
                  {/* First, so a keyboard lands on the way into the history
                      before the way into the chat. Renders nothing at the wide
                      breakpoint, where the rail is already a column. */}
                  <HistoryToggle />
                  {/* No mark here. The mascot is already in the corner of the
                      cart rail, a few hundred pixels away and at the same size,
                      and two of the same drawing on one screen read as a
                      mistake rather than as branding. The wordmark carries the
                      name on its own. */}
                  <div className="brand-copy">
                    {/* The name is text, not only an alt: tools that read a
                        heading's text content (crawlers, some audits) saw an
                        empty h1. The image is then decorative, so it is not read
                        twice. */}
                    <h1 className="brand-name">
                      <span className="sr-only">Changuito</span>
                      <img
                        className="brand-wordmark"
                        src="/brand/wordmark.png"
                        alt=""
                        aria-hidden="true"
                        width={1097}
                        height={249}
                      />
                    </h1>
                    <p className="tagline">
                      Contale a Changuito lo que necesitás y dejá que se encargue de planear todo.
                    </p>
                  </div>
                </div>
                <WalletWidget />
              </header>
              <HumanGate siteKey={siteKey}>
                <Chat />
              </HumanGate>
              <footer className="app-footer">
                <FounderTrust />
                <FooterSocial />
              </footer>
            </main>
          </Deck>
        </ShopProvider>
      </WalletProvider>
    </NetworkProvider>
  );
}
