import type Anthropic from '@anthropic-ai/sdk';

import { callMcpTool, mcpToolsToAnthropic } from '../mcp/bridge';
import type { Session } from '../mcp/session';
import type { UiEvent } from '../protocol';
import { earlyLocationAsk } from './early-ask';
import { CHANGUITO_PROMPT, stateBanner } from './prompt';
import { anthropicProvider } from './providers/anthropic';
import type { HopResult } from './providers/types';
import {
  autoRenderCart,
  emptyCache,
  RENDER_TOOLS,
  RENDER_TOOL_NAMES,
  rememberStructured,
  runRenderTool,
  type RenderCache,
} from './render-tools';

/** A basket takes a handful of searches. Past this the model is stuck, not working. */
const MAX_HOPS = 12;

/**
 * The turn's share of `maxDuration = 300` on `/api/chat`, with room left to
 * write the closing events. A turn that runs the route out of time dies
 * without a `done`, and the browser holds no snapshot for the next one.
 */
const TURN_BUDGET_MS = 280_000;

export interface Turn {
  messages: Anthropic.MessageParam[];
  cache: RenderCache;
}

export const newTurnState = (): Turn => ({ messages: [], cache: emptyCache() });

/**
 * The messages, with a cache breakpoint on the newest of them.
 *
 * The system block and the tool schemas carry one already and never move: they
 * are the same for the whole conversation. The messages are not. A basket takes
 * up to twelve hops, each one appending an assistant turn and a block of tool
 * results, and a search result is the largest thing in the request by hop
 * three. Without a breakpoint here every hop re-reads the whole growing
 * conversation at full price and full latency — the same twelve searches, paid
 * for twelve times.
 *
 * So the breakpoint moves. It marks the end of what already existed, which
 * means the next hop's prefix is exactly the block this hop just wrote.
 *
 * Three details are load-bearing:
 *
 * - **A shallow copy, never a mutation of `turn.messages`.** The stored
 *   transcript stays free of request-shaping detail that `turn-store.ts`'s
 *   codec would then have to carry, and last hop's breakpoint does not survive
 *   into this one — four per request is the ceiling, and a twelve-hop turn
 *   would sail past it.
 * - **Only on a `user` message.** Before a hop the last message is the
 *   shopper's text or a block of tool results, both of which take
 *   `cache_control`. The exception is `pause_turn`, which loops with an
 *   assistant message last, and a thinking block cannot be marked.
 * - **Nothing breaks when it does not apply.** A prefix under the minimum
 *   cacheable length is a silent no-op rather than an error, so a first hop
 *   with a short prompt simply pays what it always paid.
 */
function cacheable(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || typeof last.content === 'string') return messages;
  const tail = last.content[last.content.length - 1];
  if (!tail) return messages;
  const marked = { ...tail, cache_control: { type: 'ephemeral' as const } };
  const copy = messages.slice();
  copy[copy.length - 1] = {
    ...last,
    content: [...last.content.slice(0, -1), marked as Anthropic.ContentBlockParam],
  };
  return copy;
}

/**
 * One user message, start to finish.
 *
 * Written against a streaming API rather than a tool runner because every tool
 * call here has a visible consequence — a spinner, a product grid — and owning
 * the loop means owning where those are emitted.
 *
 * One model answers every hop. It used to be a choice per hop, with a local
 * model taking the ones it could and the hosted one picking up the rest; see
 * CLAUDE.md §5 for what that cost and why it is gone. What the seam leaves
 * behind is worth keeping: the loop still talks to a `Provider` and knows
 * nothing about the API underneath it.
 */
export async function runTurn(
  session: Session,
  turn: Turn,
  userText: string,
  emit: (e: UiEvent) => void,
): Promise<{ brain: string }> {
  const t0 = Date.now();

  // Before the model: see early-ask.ts.
  const ask = earlyLocationAsk({
    hasLocation: Boolean(session.state.getLocation()),
    firstMessage: turn.messages.length === 0,
    text: userText,
  });
  if (ask) {
    turn.messages.push(
      { role: 'user', content: [{ type: 'text', text: userText }, { type: 'text', text: stateBanner({}) }] },
      { role: 'assistant', content: [{ type: 'text', text: ask }] },
    );
    emit({ t: 'text', delta: ask });
    return { brain: 'early-ask' };
  }

  const brain = anthropicProvider();

  const mcpTools = await mcpToolsToAnthropic(session.client);
  const tools = [...mcpTools, ...RENDER_TOOLS];

  const location = session.state.getLocation();
  const cart = turn.cache.cart;

  turn.messages.push({
    role: 'user',
    content: [
      { type: 'text', text: userText },
      {
        type: 'text',
        text: stateBanner({
          retailer: location?.retailer,
          postalCode: location?.postalCode,
          cartLines: cart?.lines.length,
          cartTotal: cart?.total.display,
        }),
      },
    ],
  });

  // The server's own instructions, then ours. Cached: both are stable for the
  // whole conversation, and they sit ahead of the messages that are not.
  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: `${session.client.getInstructions() ?? ''}\n\n${CHANGUITO_PROMPT}`.trim(),
      cache_control: { type: 'ephemeral' },
    },
  ];

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const remaining = TURN_BUDGET_MS - (Date.now() - t0);
    if (remaining <= 0) {
      emit({ t: 'error', message: 'La búsqueda tardó demasiado. Probá pidiéndolo más simple.', recoverable: true });
      return { brain: brain.label };
    }

    const cb = {
      onText: (delta: string) => emit({ t: 'text', delta }),
      onThinking: (delta: string) => emit({ t: 'thinking', delta }),
    };

    emit({ t: 'status', stage: 'thinking', hop });

    // Whatever this throws is the end of the turn: there is nothing left to
    // fall back to, and the route turns it into one message.
    const msg: HopResult = await brain.hop(
      { system, tools, messages: cacheable(turn.messages), budgetMs: remaining },
      cb,
    );

    turn.messages.push({ role: 'assistant', content: msg.content });

    if (msg.stopReason === 'refusal') {
      emit({ t: 'error', message: 'No puedo responder eso.', recoverable: false });
      return { brain: brain.label };
    }

    const uses = msg.content.filter(
      (b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use',
    );

    if (msg.stopReason === 'max_tokens') {
      // A tool input truncated mid-object can still parse. Running it would be
      // acting on half an instruction.
      emit({ t: 'error', message: 'La respuesta se cortó. Probá de nuevo.', recoverable: true });
      return { brain: brain.label };
    }
    if (msg.stopReason === 'pause_turn') continue;
    if (!uses.length) return { brain: brain.label }; // end_turn, or a reply with nothing to do

    // Every result goes back in one user message. Splitting them across
    // messages teaches the model not to call tools in parallel.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      // The trail is for work, not for drawing. An MCP call reaches a
      // supermarket and can take twenty seconds, so naming it explains the
      // wait and a ✗ explains a gap in the answer. A render tool only moves
      // data the user is already looking at: "mostrando el carrito ✓" sits
      // above the cart it is describing, and a ✗ reports a failure whose only
      // consequence is that the model tries again half a second later.
      const traced = !RENDER_TOOL_NAMES.has(use.name);
      if (traced) emit({ t: 'tool_start', id: use.id, name: use.name });
      const t = Date.now();

      let result: Anthropic.ToolResultBlockParam;
      if (RENDER_TOOL_NAMES.has(use.name)) {
        result = runRenderTool(turn.cache, use, emit);
      } else {
        const call = await callMcpTool(session.client, use);
        rememberStructured(turn.cache, call.structured);
        result = call.block;
      }

      if (traced) emit({ t: 'tool_end', id: use.id, ok: result.is_error !== true, ms: Date.now() - t });

      // After the trail row closes, so the card lands under a finished line
      // rather than beside a spinner. The basket is the one thing on screen
      // that is not a recommendation — there is exactly one and the user
      // built it — so a change to it draws itself instead of waiting for the
      // model to call render_cart. See autoRenderCart in render-tools.ts.
      autoRenderCart(turn.cache, emit);

      results.push(result);
    }

    turn.messages.push({ role: 'user', content: results });
  }

  emit({
    t: 'error',
    message: 'Me quedé dando vueltas sin llegar a un carrito. Probá pidiéndolo más simple.',
    recoverable: true,
  });
  return { brain: brain.label };
}
