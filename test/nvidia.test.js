import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonResponse } from '../src/nvidia.js';

test('parses JSON wrapped in a Markdown fence', () => {
  assert.deepEqual(parseJsonResponse('```json\n[{"title":"Admin"}]\n```', { type: 'array' }), [{ title: 'Admin' }]);
});

test('extracts an array from surrounding model text', () => {
  assert.deepEqual(parseJsonResponse('Result:\n[{"score":90}]\nDone', { type: 'array' }), [{ score: 90 }]);
});

test('removes reasoning tags before parsing JSON', () => {
  assert.deepEqual(parseJsonResponse('<think>analysis</think>\n{"score":80}', { type: 'object' }), { score: 80 });
});
