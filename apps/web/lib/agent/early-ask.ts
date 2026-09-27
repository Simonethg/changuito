/**
 * The one reply that does not need a model.
 *
 * Every basket starts with the same question. The prompt tells the model that
 * without a supermarket and a postal code it must ask for them before
 * anything else, and it does — but on the local model that single sentence
 * took 41.7s on production, most of it prompt evaluation over twelve tool
 * schemas, with nothing on screen. A guest tapping a starter chip is the
 * common first turn, so the common first impression was a stalled spinner.
 *
 * So the first message of a conversation that names no postal code is
 * answered here, instantly, with the question the model would have asked.
 * It is written into history like any other reply, so the next turn's model
 * sees the user's original request, then this question, then their answer.
 *
 * Deliberately narrow: only the first message, only with no location set,
 * and only when nothing in it looks like a postal code. Anything else — a
 * follow-up, "no sé", a CPA, a number that might be one — goes to the model,
 * which is what happened before for every message.
 *
 * Only a type import, which `--experimental-strip-types` erases outright, so
 * this still loads with nothing to resolve at runtime.
 */

import type { Lang } from '../lang.ts';

/** Four digits on their own (1414, CP1414, "1414 Día"), or a CPA (C1414ABC). */
const POSTAL_CODE = /(^|\D)\d{4}(?!\d)|(^|[^A-Za-z])[A-Za-z]\d{4}[A-Za-z]{3}(?![A-Za-z])/;

export function mentionsPostalCode(text: string): boolean {
  return POSTAL_CODE.test(text);
}

export const EARLY_LOCATION_ASK =
  'Para buscar precios reales necesito tu **código postal** y el súper donde querés comprar ' +
  '(Día, Jumbo, Disco o Carrefour). Si no tenés preferencia, te sugiero **Día**, que es el que ' +
  'mejor cobertura tiene. ¿Cuál es tu código postal?';

/**
 * The same question for a reader who set the footer to English.
 *
 * The four store names stay as they are — they are the signs above real
 * shops in Buenos Aires, and translating them would name places that do not
 * exist. "Código postal" becomes "postcode" because that is the thing being
 * asked for, and the model is told in the prompt to keep asking in English.
 */
export const EARLY_LOCATION_ASK_EN =
  'To look up real prices I need your **postcode** and the supermarket you want to shop at ' +
  '(Día, Jumbo, Disco or Carrefour). If you have no preference I suggest **Día** — it has the ' +
  'best coverage here. What is your postcode?';

export function earlyLocationAsk(args: {
  hasLocation: boolean;
  /** No message has been exchanged in this conversation yet. */
  firstMessage: boolean;
  text: string;
  lang?: Lang;
}): string | null {
  if (args.hasLocation || !args.firstMessage) return null;
  if (mentionsPostalCode(args.text)) return null;
  return args.lang === 'en' ? EARLY_LOCATION_ASK_EN : EARLY_LOCATION_ASK;
}
