import { DEFAULT_LANG, type Lang } from './lang.ts';

/** Easy to change. Guests may send this many chat turns without logging in. */
export const FREE_TURNS = 3;

/** Softer IP ceiling: blocks sessionId-rotation abuse without locking a café. */
export const FREE_TURNS_PER_IP = FREE_TURNS * 10;

export const USER_COOKIE = 'chg_user';
export const LOGIN_REQUIRED = 'login_required' as const;

export const LOGIN_REQUIRED_MESSAGE =
  'Para seguir, iniciá sesión. Así podemos anotarte y seguir mejorando Changuito.';

/** Primary button on the soft-limit login gate. Rioplatense voseo. Signed-in shoppers do not see this gate. */
export const LOGIN_CTA = 'Iniciá sesión';

/**
 * The same two strings for a reader who set the footer to English.
 *
 * Beside the constants rather than replacing them: `/api/chat` answers the
 * soft limit with `LOGIN_REQUIRED_MESSAGE` and has no idea which language this
 * browser asked for, so the Spanish one has to stay exactly what it is and
 * keep its name. The browser picks with `loginCta` / `loginRequiredMessage`
 * below and prefers its own copy over whatever the route sent.
 */
const LOGIN_REQUIRED_MESSAGE_EN =
  'To carry on, sign in. That way we can note you down and keep making Changuito better.';

const LOGIN_CTA_EN = 'Sign in';

export function loginRequiredMessage(lang: Lang = DEFAULT_LANG): string {
  return lang === 'en' ? LOGIN_REQUIRED_MESSAGE_EN : LOGIN_REQUIRED_MESSAGE;
}

export function loginCta(lang: Lang = DEFAULT_LANG): string {
  return lang === 'en' ? LOGIN_CTA_EN : LOGIN_CTA;
}

export interface LoginGateInput {
  isAuthenticated: boolean;
  /** Server answered `login_required`, or the client latched that lock. */
  loginRequired: boolean;
  /**
   * Guest turns already consumed. Omitted when the caller only has the latch.
   * Signed-in shoppers ignore the count entirely.
   */
  turnsUsed?: number;
  freeTurns?: number;
}

/**
 * The soft-limit banner and its CTA are a guest gate.
 * A signed-in shopper never sees them, even after the free turns are spent.
 */
export function shouldShowLoginGate(args: LoginGateInput): boolean {
  if (args.isAuthenticated) return false;
  if (args.loginRequired) return true;
  if (typeof args.turnsUsed !== 'number') return false;
  const free = args.freeTurns ?? FREE_TURNS;
  return args.turnsUsed >= free;
}

/** Banner body, or null when the gate must stay off the screen. */
export function loginGateBannerText(args: LoginGateInput, lang: Lang = DEFAULT_LANG): string | null {
  if (!shouldShowLoginGate(args)) return null;
  return loginRequiredMessage(lang);
}
