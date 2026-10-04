import type { Cart, Product } from '@changuito/mcp/types';
import type { SessionSnapshot } from '@changuito/mcp/session';

import type { ChatImage } from './chat-image.ts';
import type { NetworkId } from './deployments.ts';
import type { Lang } from './lang.ts';

/**
 * The wire between the agent and the browser.
 *
 * Imported by both sides, so a change that breaks the UI breaks the build
 * rather than the demo. Products and carts travel as the MCP server's own
 * types — re-describing them here would be a second definition to keep in
 * step with the first.
 */
/**
 * Where the server is in a turn. Every stage is emitted at the moment it
 * becomes true, so the waiting row can say what is happening without
 * inventing a percentage.
 *
 * - `received`: the gates passed and the stream is open. From here on the
 *   message is the server's, which is what separates "no se envió" from "se
 *   cortó" when a turn fails with nothing on screen.
 * - `thinking`: a model hop started. `hop` counts from zero; past the first
 *   the model is reading tool results, not the user's message.
 * - `fallback`: the local model failed before saying anything, and the hop is
 *   being re-run on the hosted one.
 */
export type TurnStage = 'received' | 'thinking' | 'fallback';

export type UiEvent =
  /** Progress without content. Never creates a block in the transcript. */
  | { t: 'status'; stage: TurnStage; hop?: number }
  /** A fragment of the assistant's reply. */
  | { t: 'text'; delta: string }
  /** Summarized reasoning, for a "thinking" line the user can ignore. */
  | { t: 'thinking'; delta: string }
  | { t: 'tool_start'; id: string; name: string }
  | { t: 'tool_end'; id: string; ok: boolean; ms: number }
  /** The model chose to show these. Not everything it searched. */
  | { t: 'products'; items: Product[]; note?: string }
  | { t: 'cart'; cart: Cart; handoffUrl?: string }
  | { t: 'error'; message: string; recoverable: boolean }
  /** Always last. Carries the snapshot the browser must send back next turn. */
  | {
      t: 'done';
      stopReason: string;
      snapshot: SessionSnapshot;
      /**
       * Which model answered, when more than one could have.
       *
       * Optional because most deployments have exactly one and the field would
       * be noise. Where a local model is configured it is the only way to tell
       * a fallback from a normal turn — the reply reads the same either way,
       * which is the point, and also means a laptop that quietly stopped being
       * used is otherwise invisible.
       */
      brain?: string;
    };

export interface ChatRequest {
  sessionId: string;
  message: string;
  /** What the browser was given by the previous `done`. Absent on the first turn. */
  snapshot?: SessionSnapshot;
  /**
   * Which mode the shopper is in. The server has no way to infer it — the
   * choice lives in NetworkProvider and nothing else on this request carries
   * it — and `chat.network` is what keeps a prueba conversation out of a real
   * one's history. Validated on arrival; anything unknown lands on the default,
   * which is the mode that cannot spend anything.
   */
  network?: NetworkId;
  /**
   * Which language the footer is set to. The agent's reply language, and
   * nothing else — the route's own refusals stay Spanish, because the MCP
   * server and the agent share them and neither reads a cookie from this
   * browser. Anything unknown lands on the default.
   */
  lang?: Lang;
  /**
   * One photo of a list, a product or a shelf. Identifiers only would not
   * work here — the picture is the thing being identified — so the bytes
   * travel, and `isChatImage` is what keeps them to a JPEG the model can read.
   */
  image?: ChatImage;
}

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Without this a proxy buffers the whole stream and "streaming" becomes a
  // single delivery at the end.
  'X-Accel-Buffering': 'no',
};

export const encodeEvent = (e: UiEvent): string => `data: ${JSON.stringify(e)}\n\n`;

/** An SSE comment. Keeps an idle connection open while a slow search runs. */
export const HEARTBEAT = ':\n\n';

/**
 * Parse a stream of SSE text into events. Returns whatever is left over, which
 * the caller must prepend to the next chunk — a frame can be split anywhere,
 * including inside a JSON string.
 */
export function parseEvents(buffer: string): { events: UiEvent[]; rest: string } {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  const events: UiEvent[] = [];
  for (const frame of frames) {
    if (!frame.startsWith('data: ')) continue; // heartbeat comment
    try {
      events.push(JSON.parse(frame.slice(6)) as UiEvent);
    } catch {
      // A frame we cannot parse is a bug, but dropping it beats killing the stream.
    }
  }
  return { events, rest };
}
