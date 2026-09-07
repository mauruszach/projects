import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshManager, validateSnapshot } from '../lib/live-refresh.ts';

const graph = { generated: '2026-09-07T00:00:00Z', nodes: [{ id: 'a' }], edges: [] };
const prices = { dates: ['2026-09-06'], series: { a: [0.5] } };
const snapshot = { graph, prices };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('simultaneous visits share one refresh; a later visit starts a fresh one', async () => {
  let finish;
  let calls = 0;
  const manager = createRefreshManager(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const a = manager.start();
  const b = manager.start();
  assert.equal(a.id, b.id);
  await settle();
  assert.equal(calls, 1);
  finish(snapshot);
  await settle();
  assert.equal(manager.get(a.id).status, 'ready');
  assert.deepEqual(manager.get(a.id).snapshot, snapshot);
  const c = manager.start();
  assert.notEqual(c.id, a.id);
  await settle();
  finish(snapshot);
  await settle();
  assert.equal(calls, 2);
  assert.equal(manager.get(a.id).status, 'ready');
});

test('failure releases the worker and allows retry without publishing partial data', async () => {
  let calls = 0;
  const manager = createRefreshManager(async () => {
    if (++calls === 1) throw new Error('upstream unavailable');
    return snapshot;
  });
  const first = manager.start();
  await settle();
  assert.equal(first.status, 'error');
  assert.equal(first.snapshot, undefined);
  const retry = manager.start();
  await settle();
  assert.equal(retry.status, 'ready');
});

test('rejects mismatched histories, invalid probabilities and dangling edges', () => {
  assert.deepEqual(validateSnapshot(graph, prices), snapshot);
  assert.throws(() => validateSnapshot(graph, { ...prices, series: {} }));
  assert.throws(() => validateSnapshot(graph, { ...prices, series: { a: [NaN] } }));
  assert.throws(() => validateSnapshot({ ...graph, edges: [{ a: 'a', b: 'missing', r: 0.5 }] }, prices));
});
