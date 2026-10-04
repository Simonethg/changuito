import type { Cart, Product } from '@changuito/mcp/types';
import type { SessionSnapshot } from '@changuito/mcp/session';

import type { ChatImage } from './chat-image.ts';
import type { TurnStage, UiEvent } from './protocol';

/**
 * The transcript, as a reducer over UiEvents.
 *
 * Pure and framework-free so the ordering rules can be tested without a
 * browser. The ordering is the whole difficulty: a product grid arrives in
 * the middle of a sentence, and if it is appended to the end of the turn the
 * user reads "acá están los precios" above nothing, then a grid below the
 * paragraph that was supposed to follow it.
 */

export interface ToolRun {
  id: string;
  name: string;
  ms?: number;
  ok?: boolean;
}

/**
 * Why a turn never landed.
 *
 * `login` is the only one worth resuming on its own: the gate is a door the
 * user can open, and once it is open the same message is still what they meant
 * to say. Everything else needs a human to decide whether to try again.
 *
 * `dropped` is a `network` failure after the server said `received`: the
 * message did get there, the answer never came back. Retrying is just as safe
 * — history is written only on a clean return — but "no se envió" would be
 * untrue, so the copy differs.
 */
export type SendFailure = { reason: 'login' | 'network' | 'dropped'; message: string };

/** What the server last said it was doing. Absent between turns. */
export interface TurnProgress {
  stage: TurnStage;
  hop: number;
  /** Reply text has arrived since the last status. */
  writing: boolean;
}

export type Block =
  | { kind: 'user'; id: string; text: string; failed?: SendFailure; image?: ChatImage }
  | { kind: 'say'; id: string; text: string; thinking: string; tools: ToolRun[] }
  | { kind: 'products'; id: string; items: Product[]; note?: string }
  | { kind: 'cart'; id: string; cart: Cart; handoffUrl?: string }
  | { kind: 'error'; id: string; message: string; recoverable: boolean };

export interface ChatState {
  blocks: Block[];
  /** True between send and `done`. Drives the composer's disabled state. */
  streaming: boolean;
  /** Set by `status` events during a turn, cleared when it ends. */
  progress?: TurnProgress;
  /** Opaque to the browser; handed back on the next turn so the agent remembers. */
  snapshot?: SessionSnapshot;
  /** The newest cart seen, wherever it appeared. What the pay button settles. */
  cart?: { cart: Cart; handoffUrl?: string };
}

export const initialState: ChatState = { blocks: [], streaming: false };

let seq = 0;
const nextId = () => `b${++seq}`;

/** Exported for tests, which need ids to be predictable. */
export function resetIds(): void {
  seq = 0;
}

/**
 * Move the counter past ids that already exist.
 *
 * Restoring a transcript from storage brings back blocks named `b1`…`b9`
 * while this counter is still at zero, so the next block minted would be `b1`
 * again. React keys off `id`: a duplicate key does not throw, it silently
 * reuses the wrong node, and the symptom is a new message painting itself
 * into an old bubble. Call this with the highest restored number.
 *
 * It only ever moves forward. A lower number is ignored rather than honoured,
 * because two restores in one page life must not walk the counter backwards
 * into ids the first one already handed out.
 */
export function seedIds(highest: number): void {
  if (Number.isFinite(highest) && highest > seq) seq = Math.floor(highest);
}

/** The number in a `b12` id, or 0 for anything else. */
export function idNumber(id: string): number {
  const m = /^b(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** The state with no turn in progress. Removes the key rather than setting it undefined. */
function settled(state: ChatState): ChatState {
  if (!('progress' in state)) return state;
  const { progress: _done, ...rest } = state;
  return rest;
}

export function sendUser(state: ChatState, text: string, image?: ChatImage): ChatState {
  const block: Extract<Block, { kind: 'user' }> = image
    ? { kind: 'user', id: nextId(), text, image }
    : { kind: 'user', id: nextId(), text };
  return {
    ...settled(state),
    streaming: true,
    blocks: [...state.blocks, block],
  };
}

/**
 * Append to the open `say` block, or start one. A block stops being open as
 * soon as anything else is appended, which is what keeps text on the correct
 * side of a grid.
 */
function intoSay(blocks: Block[], f: (b: Extract<Block, { kind: 'say' }>) => Extract<Block, { kind: 'say' }>): Block[] {
  const last = blocks[blocks.length - 1];
  if (last?.kind === 'say') return [...blocks.slice(0, -1), f(last)];
  return [...blocks, f({ kind: 'say', id: nextId(), text: '', thinking: '', tools: [] })];
}

/**
 * `Array.prototype.findLastIndex` by hand: the app targets ES2022 and that one
 * is ES2023, so it does not typecheck here.
 */
function lastIndexWhere(blocks: Block[], match: (b: Block, i: number) => boolean): number {
  for (let i = blocks.length - 1; i >= 0; i--) if (match(blocks[i]!, i)) return i;
  return -1;
}

export function applyEvent(state: ChatState, e: UiEvent): ChatState {
  switch (e.t) {
    case 'status':
      // A late status after the turn ended (Parar, then a buffered frame)
      // must not bring the waiting row back.
      if (!state.streaming) return state;
      return {
        ...state,
        progress: { stage: e.stage, hop: e.hop ?? state.progress?.hop ?? 0, writing: false },
      };

    case 'text':
      return {
        ...state,
        ...(state.progress && !state.progress.writing ? { progress: { ...state.progress, writing: true } } : {}),
        blocks: intoSay(state.blocks, (b) => ({ ...b, text: b.text + e.delta })),
      };

    case 'thinking':
      return { ...state, blocks: intoSay(state.blocks, (b) => ({ ...b, thinking: b.thinking + e.delta })) };

    case 'tool_start':
      return {
        ...state,
        blocks: intoSay(state.blocks, (b) => ({ ...b, tools: [...b.tools, { id: e.id, name: e.name }] })),
      };

    case 'tool_end':
      // Lands on whichever block holds that call, not necessarily the open one:
      // a search that finishes after a grid was drawn still belongs to its own turn.
      return {
        ...state,
        blocks: state.blocks.map((b) =>
          b.kind === 'say' && b.tools.some((t) => t.id === e.id)
            ? { ...b, tools: b.tools.map((t) => (t.id === e.id ? { ...t, ok: e.ok, ms: e.ms } : t)) }
            : b,
        ),
      };

    case 'products':
      return {
        ...state,
        blocks: [...state.blocks, { kind: 'products', id: nextId(), items: e.items, note: e.note }],
      };

    case 'cart': {
      // One cart card per turn.
      //
      // The agent renders the basket twice on purpose — once when it is built,
      // once when the handoff link exists — and appending both left two cards
      // on screen, the first without the link and the second with it. Reading
      // that, the basket looks like it was ordered twice.
      //
      // Scoped to the current turn rather than the whole transcript: a cart
      // shown three messages ago is a record of what the basket was then, and
      // rewriting it would edit history the user has already scrolled past.
      const turnStart = lastIndexWhere(state.blocks, (b) => b.kind === 'user');
      const existing = lastIndexWhere(
        state.blocks,
        (b, i) => i > turnStart && b.kind === 'cart' && b.cart.cartId === e.cart.cartId,
      );
      const prior = existing === -1 ? undefined : (state.blocks[existing] as Extract<Block, { kind: 'cart' }>);

      const block = (id: string): Block => ({
        kind: 'cart',
        id,
        cart: e.cart,
        // Never take the link back off a card that already had one. The render
        // that adds it is the second of the pair, so this only matters in the
        // other order, where dropping it would remove a button the user saw.
        handoffUrl: e.handoffUrl ?? prior?.handoffUrl,
      });

      return {
        ...state,
        cart: { cart: e.cart, handoffUrl: e.handoffUrl ?? prior?.handoffUrl },
        blocks:
          // Reusing the id matters: React keys off it, so the card updates in
          // place instead of unmounting and animating back in.
          prior
            ? state.blocks.map((b, i) => (i === existing ? block(prior.id) : b))
            : [...state.blocks, block(nextId())],
      };
    }

    case 'error': {
      const blocks: Block[] = [
        ...state.blocks,
        { kind: 'error', id: nextId(), message: e.message, recoverable: e.recoverable },
      ];
      // An unrecoverable error ends the turn; nothing further is coming.
      return e.recoverable ? { ...state, blocks } : { ...settled(state), streaming: false, blocks };
    }

    case 'done':
      return { ...settled(state), streaming: false, snapshot: e.snapshot };
  }
}

/** A dropped connection is not a `done`, so the composer has to be freed by hand. */
export function endTurn(state: ChatState, message?: string): ChatState {
  if (!state.streaming) return state;
  const blocks = message
    ? [...state.blocks, { kind: 'error' as const, id: nextId(), message, recoverable: true }]
    : state.blocks;
  return { ...settled(state), streaming: false, blocks };
}

/**
 * Drop error bubbles whose text is exactly `message`.
 * Same reference when nothing matches, so a no-op clear does not re-render.
 */
export function omitErrorMessage(state: ChatState, message: string): ChatState {
  let changed = false;
  const blocks = state.blocks.filter((b) => {
    if (b.kind === 'error' && b.message === message) {
      changed = true;
      return false;
    }
    return true;
  });
  return changed ? { ...state, blocks } : state;
}

/**
 * End a turn that failed, telling the truth about how far it got.
 *
 * "Did the server receive this?" has an exact structural answer already in the
 * transcript: if the last block is still the user's own bubble, nothing came
 * back, so nothing was received — /api/chat writes history only after a clean
 * return. Mark that bubble and the screen stops claiming a message landed when
 * it did not, which is the bug in CLAUDE.md §4 seen from the client side.
 *
 * Once anything has rendered the answer is different. The user is reading half
 * a reply, the server has the message, and "no se envió" would be a visible
 * lie — so that case keeps the error block it has always had.
 *
 * In between is a turn the server acknowledged (`received`) that died before
 * saying anything. The bubble still gets the retry control, since nothing was
 * written, but as `dropped`: the message did arrive.
 */
export function failTurn(state: ChatState, failure: SendFailure): ChatState {
  if (!state.streaming) return state;
  const last = state.blocks.at(-1);
  if (last?.kind !== 'user' || last.failed) return endTurn(state, failure.message);
  const reason = failure.reason === 'network' && state.progress ? 'dropped' : failure.reason;
  return {
    ...settled(state),
    streaming: false,
    blocks: [...state.blocks.slice(0, -1), { ...last, failed: { ...failure, reason } }],
  };
}

/**
 * Send an undelivered message again.
 *
 * The block is reused, not appended: the text is already on screen, and a
 * second identical bubble would read as having said it twice. Keeping the id
 * keeps the React key, so the bubble changes in place instead of unmounting
 * and animating back in — the same reasoning as the cart dedupe above.
 */
export function retryUser(state: ChatState, id: string): ChatState {
  if (state.streaming) return state;
  const i = lastIndexWhere(state.blocks, (b) => b.kind === 'user' && b.id === id && Boolean(b.failed));
  if (i === -1) return state;
  const b = state.blocks[i] as Extract<Block, { kind: 'user' }>;
  // Rebuilt rather than spread: `failed` has to be absent, not undefined, so
  // a retried block is indistinguishable from one that never failed. The photo
  // stays, or a retry of a picture would go out as words alone.
  const cleared: Block = b.image
    ? { kind: 'user', id: b.id, text: b.text, image: b.image }
    : { kind: 'user', id: b.id, text: b.text };
  return {
    ...settled(state),
    streaming: true,
    blocks: state.blocks.map((x, j) => (j === i ? cleared : x)),
  };
}

/**
 * Only the newest message gets a retry control.
 *
 * A network failure leaves the composer usable, so the user can type something
 * else and move on. Re-sending the older message then would reach the server
 * after the newer one, and the history the agent reasons over would be in a
 * different order than the transcript the user is looking at — §4 again, with
 * the two sides swapped. The mark stays on the old bubble as a record of what
 * happened; the button does not.
 */
export function canRetry(state: ChatState, id: string): boolean {
  if (state.streaming) return false;
  const last = state.blocks.at(-1);
  return last?.kind === 'user' && last.id === id && Boolean(last.failed);
}
