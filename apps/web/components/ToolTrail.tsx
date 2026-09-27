'use client';

import type { ToolRun } from '../lib/chat-state';
import { toolLabels } from '../lib/tool-labels.ts';
import { useLang } from './LangProvider';

/**
 * What the agent actually did, in the user's language.
 *
 * Shown because the alternative is fifteen silent seconds while a search runs
 * against four store APIs. Raw tool ids stay in the title attribute for debug.
 *
 * The back-and-forth cart GIF sits on the last trail row only, so the eye
 * always finds the step that is still moving.
 */

export function ToolTrail({ tools }: { tools: ToolRun[] }) {
  const labels = toolLabels(useLang());
  if (tools.length === 0) return null;

  const lastIdx = tools.length - 1;
  const anyPending = tools.some((t) => t.ok === undefined);

  return (
    <ul className="trail">
      {tools.map((t, i) => {
        const isLast = i === lastIdx;
        const showCart = isLast && anyPending;
        return (
          <li
            key={t.id}
            className={t.ok === false ? 'trail-item is-bad' : 'trail-item'}
            title={t.name}
          >
            {showCart ? (
              <img
                className="trail-cart"
                src="/brand/animacion-busqueda.gif"
                alt=""
                aria-hidden="true"
                width={28}
                height={28}
              />
            ) : (
              <span className="trail-dot" aria-hidden="true">
                {t.ok === undefined ? '◌' : t.ok ? '●' : '×'}
              </span>
            )}
            <span>{labels[t.name] ?? t.name}</span>
            {t.ms !== undefined ? (
              <span className="trail-ms">{(t.ms / 1000).toFixed(1)}s</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
