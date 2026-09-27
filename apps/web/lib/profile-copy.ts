import { PREVIEW_MASTHEAD } from './mode-copy.ts';
import { PURCHASES } from './orders-copy.ts';

/**
 * The words in the profile modal.
 *
 * Its own module rather than strings in the JSX, for the reason mode-copy.ts
 * gives: the chrome obeys the same rule as the agent, so nothing here may name
 * a network, a chain or a wallet. The shopper reads "cuenta", "tarjeta" and
 * "compras" and nothing else.
 *
 * There is no card here. It has two homes already — the button beside the
 * balance, which is where somebody about to pay looks for it, and the Mis
 * compras tab, which is where giving it back lives. A third summary in
 * General would be a third thing to keep in step with the other two.
 *
 * Logout says **"Cerrar sesión"** and not "Salir", which is what the icon in
 * the balance widget is labelled. Beside a word like "cuenta" in a dialog,
 * "Salir" reads as closing the dialog, and the two controls are now a few
 * hundred pixels apart with nothing to tell them apart but the label.
 */
export interface ProfileCopy {
  title: string;
  /** The tab strip. Two words, both nouns, because they are places. */
  tabGeneral: string;
  tabOrders: string;
  addressLabel: string;
  addressHint: string;
  balanceLabel: string;
  logout: string;
  /** Signed out there is no account to show, so it offers the crossing. */
  guestTitle: string;
  guestBody: string;
  guestAction: string;
}

export const PROFILE: ProfileCopy = {
  title: 'Tu cuenta',
  tabGeneral: 'General',
  tabOrders: 'Mis compras',
  addressLabel: 'Tu cuenta',
  addressHint: 'Copiala si necesitás recibir plata.',
  balanceLabel: 'Saldo',
  logout: 'Cerrar sesión',
  guestTitle: PURCHASES.guestTitle,
  guestBody: 'Estás probando con plata nuestra, así que no guardamos nada a tu nombre. Entrá con tu cuenta y empezamos a guardar tus compras y tu tarjeta.',
  guestAction: PREVIEW_MASTHEAD.action,
};

/** Everything a copy test would iterate, if one is ever written. One place to add to. */
export const PROFILE_COPY: readonly string[] = Object.values(PROFILE);
