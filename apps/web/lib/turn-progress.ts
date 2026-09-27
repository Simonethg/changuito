import type { ChatState } from './chat-state';
import { DEFAULT_LANG, type Lang } from './lang.ts';
import { toolLabels } from './tool-labels.ts';

/**
 * The waiting line under the composer, as copy.
 *
 * A basket can take a minute, and a spinner that says the same thing for all
 * of it reads as stuck. Everything here comes from something that actually
 * happened: a `status` event from the server, a tool that has not reported
 * back, reply text arriving, or the clock. No percentages and no steps the
 * turn has not reached — a bar that fills on a timer is a promise the server
 * never made.
 */

/** Past this the wait deserves an explanation. */
export const SLOW_MS = 12_000;

/** Past this it deserves an exit. */
export const VERY_SLOW_MS = 40_000;

export interface ProgressCopy {
  /** What is happening now. Announced politely to screen readers. */
  stage: string;
  /** Why it is taking a while, or what the user can do. */
  hint: string;
  /** Whole seconds since the turn started. Visual only. */
  seconds: number;
}

/** The MCP tool still running in the current turn, if any. */
export function pendingTool(state: ChatState): string | undefined {
  for (let i = state.blocks.length - 1; i >= 0; i--) {
    const b = state.blocks[i]!;
    if (b.kind === 'user') return undefined;
    if (b.kind !== 'say') continue;
    for (let j = b.tools.length - 1; j >= 0; j--) {
      if (b.tools[j]!.ok === undefined) return b.tools[j]!.name;
    }
  }
  return undefined;
}

/** One language's five stages and three hints. The shapes are identical. */
interface StageWords {
  tool: string;
  sending: string;
  writing: string;
  received: string;
  fallback: string;
  firstHop: string;
  laterHop: string;
  hintSlowest: string;
  hintSlow: string;
  hintNormal: string;
}

const WORDS_ES: StageWords = {
  tool: 'Consultando al súper',
  sending: 'Enviando tu mensaje…',
  writing: 'Escribiendo la respuesta…',
  received: 'Recibido. Preparando la búsqueda…',
  fallback: 'Probando por otro camino para no hacerte esperar…',
  firstHop: 'Pensando qué buscar…',
  laterHop: 'Revisando lo que encontré…',
  hintSlowest: 'Está tardando más que de costumbre. Podés esperar o tocar Parar y probar de nuevo.',
  hintSlow: 'Los supermercados a veces tardan en responder. Sigo con tu pedido.',
  hintNormal: 'Tocá Parar si querés cambiar el pedido.',
};

// The hints name the button by the word printed on it, so these follow
// ui-copy's `chat.stop` ("Stop") rather than translating "Parar" literally.
const WORDS_EN: StageWords = {
  tool: 'Asking the store',
  sending: 'Sending your message…',
  writing: 'Writing the reply…',
  received: 'Got it. Getting the search ready…',
  fallback: 'Trying another way so you are not kept waiting…',
  firstHop: 'Working out what to search for…',
  laterHop: 'Reading what I found…',
  hintSlowest: 'This is taking longer than usual. You can wait, or press Stop and try again.',
  hintSlow: 'Supermarkets are sometimes slow to answer. I am still on your order.',
  hintNormal: 'Press Stop if you want to change the order.',
};

function words(lang: Lang): StageWords {
  return lang === 'en' ? WORDS_EN : WORDS_ES;
}

function stageCopy(state: ChatState, lang: Lang): string {
  const w = words(lang);
  const tool = pendingTool(state);
  if (tool) return `${toolLabels(lang)[tool] ?? w.tool}…`;

  const p = state.progress;
  if (!p) return w.sending;
  if (p.writing) return w.writing;
  switch (p.stage) {
    case 'received':
      return w.received;
    case 'fallback':
      return w.fallback;
    case 'thinking':
      return p.hop === 0 ? w.firstHop : w.laterHop;
  }
}

function hintCopy(elapsedMs: number, lang: Lang): string {
  const w = words(lang);
  if (elapsedMs >= VERY_SLOW_MS) return w.hintSlowest;
  if (elapsedMs >= SLOW_MS) return w.hintSlow;
  return w.hintNormal;
}

export function progressCopy(state: ChatState, elapsedMs: number, lang: Lang = DEFAULT_LANG): ProgressCopy {
  const ms = Math.max(0, elapsedMs);
  return { stage: stageCopy(state, lang), hint: hintCopy(ms, lang), seconds: Math.floor(ms / 1000) };
}
