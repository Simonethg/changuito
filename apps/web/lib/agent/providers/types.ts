import type Anthropic from '@anthropic-ai/sdk';

/**
 * One request to a model, and what comes back.
 *
 * Deliberately narrow. A provider does not know about MCP, render tools, carts
 * or the UI protocol — it takes Anthropic-shaped messages, streams deltas, and
 * returns content blocks in the same shape. Everything that makes changuito's
 * loop what it is stays in `loop.ts`, so adding a provider cannot change the
 * behaviour the tests pin.
 */

export interface HopRequest {
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.ToolUnion[];
  messages: Anthropic.MessageParam[];
  /**
   * Milliseconds this hop may take before it is abandoned.
   *
   * The caller owns this, not the provider: `/api/chat` has `maxDuration = 300`
   * for the *whole turn*, and hop nine cannot be given the same budget hop one
   * had.
   */
  budgetMs: number;
}

export interface HopCallbacks {
  onText(delta: string): void;
  onThinking(delta: string): void;
}

export interface HopResult {
  content: Anthropic.ContentBlockParam[];
  stopReason: Anthropic.Message['stop_reason'];
}

export interface Provider {
  /**
   * One value, for now. It was a union — the loop branched on it to decide
   * whether a failure was routine (a laptop at home) or the end of the turn
   * (the hosted model). There is only the hosted model now, so every failure is
   * the end of the turn and nothing reads this but the log line.
   */
  readonly kind: 'anthropic';
  /** The model name, for the log line and the dev banner. */
  readonly label: string;
  hop(req: HopRequest, cb: HopCallbacks): Promise<HopResult>;
}
