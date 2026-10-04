import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openAiMessages, openAiTools } from '../agent/providers/openai.ts';

test('a photo becomes a data URL and cache marks stay off the wire', () => {
  const messages = openAiMessages({
    system: [{ type: 'text', text: 'Sos Changuito.', cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: 'aaaa' },
          },
          { type: 'text', text: 'leche y un 1425' },
        ],
      },
    ],
  });

  assert.equal(messages[0]?.role, 'system');
  assert.equal(messages[1]?.role, 'user');
  const content = messages[1] && 'content' in messages[1] ? messages[1].content : null;
  assert.ok(Array.isArray(content));
  assert.deepEqual(content[0], {
    type: 'image_url',
    image_url: { url: 'data:image/jpeg;base64,aaaa' },
  });
  assert.deepEqual(content[1], { type: 'text', text: 'leche y un 1425' });
});

test('tool results leave the user role and a tool call keeps its arguments', () => {
  const messages = openAiMessages({
    system: [],
    messages: [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'search_products',
            input: { query: 'leche' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            is_error: true,
            content: 'sin stock',
          },
        ],
      },
    ],
  });

  assert.equal(messages[0]?.role, 'assistant');
  const call = messages[0] && 'tool_calls' in messages[0] ? messages[0].tool_calls?.[0] : undefined;
  assert.equal(call?.function.arguments, '{"query":"leche"}');
  assert.equal(messages[1]?.role, 'tool');
  assert.equal(messages[1] && 'content' in messages[1] ? messages[1].content : '', 'Error: sin stock');
});

test('render tools keep their schema and drop a cache mark', () => {
  const tools = openAiTools([
    {
      name: 'render_products',
      description: 'Show these',
      input_schema: {
        type: 'object',
        properties: { sku_ids: { type: 'array' } },
        cache_control: { type: 'ephemeral' },
      },
    },
  ]);
  assert.equal(tools[0]?.function.name, 'render_products');
  assert.equal('cache_control' in tools[0]!.function.parameters, false);
});
