import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, makeSequence } from '../web/game.mjs';
import * as gameModule from '../web/game.mjs';
function answering(sequence = 'LRL') {
  const g = new Game();
  g.begin(sequence);
  g.playbackDone(g.id);
  g.centered(g.id, 1000);
  return g;
}
test('games start with one action', () => assert.equal(gameModule.START_LENGTH, 1));
test('sequence remains hidden and input is ignored during playback', () => {
  const g = new Game();
  g.begin('LRL');
  g.input(g.id, 'L', 0);
  assert.equal(g.phase, 'playing');
  assert.deepEqual(g.answer, []);
  assert.equal(g.revealed, false);
});
test('timer starts only after playback and return to center', () => {
  const g = new Game();
  g.begin('LRL');
  g.playbackDone(g.id);
  g.tick(100000);
  assert.equal(g.phase, 'centering');
  g.centered(g.id, 1000);
  assert.equal(g.deadline, 10000);
});
test('last required input scores immediately and advances length', () => {
  const g = answering();
  for (const d of 'LR') g.input(g.id, d, 2000);
  assert.equal(g.phase, 'answering');
  assert.equal(g.revealed, false);
  g.input(g.id, 'L', 2100);
  assert.equal(g.phase, 'result');
  assert.equal(g.correct, true);
  assert.equal(g.revealed, true);
  assert.equal(g.nextLength, 4);
});
test('single move resolves immediately and unlocks two moves', () => {
  const g = answering('L');
  g.input(g.id, 'L', 1200);
  assert.equal(g.phase, 'result');
  assert.equal(g.correct, true);
  assert.equal(g.nextLength, 2);
});
test('wrong complete answer fails immediately', () => {
  const g = answering('LR');
  g.input(g.id, 'L', 1200);
  g.input(g.id, 'L', 1300);
  assert.equal(g.phase, 'result');
  assert.equal(g.correct, false);
  assert.equal(g.nextLength, 2);
});
test('incomplete input remains hidden until the timeout then fails', () => {
  const g = answering();
  g.input(g.id, 'L', 2000);
  g.tick(9999);
  assert.equal(g.phase, 'answering');
  assert.equal(g.revealed, false);
  g.tick(10000);
  assert.equal(g.phase, 'result');
  assert.equal(g.correct, false);
});
test('input after completion cannot alter the result', () => {
  const g = answering('L');
  g.input(g.id, 'L', 1200);
  g.input(g.id, 'R', 1300);
  g.tick(10000);
  assert.deepEqual(g.answer, ['L']);
  assert.equal(g.correct, true);
});
test('events at deadline are too late and stale events are ignored', () => {
  const g = answering();
  g.input(g.id - 1, 'L', 2000);
  g.input(g.id, 'L', 10000);
  assert.deepEqual(g.answer, []);
  assert.equal(g.correct, false);
});
test('cancel invalidates round events', () => {
  const g = answering();
  const old = g.id;
  g.cancel();
  g.playbackDone(old);
  g.centered(old, 0);
  g.input(old, 'L', 0);
  assert.equal(g.phase, 'idle');
  assert.deepEqual(g.answer, []);
});
test('repeat directions are valid and invalid directions do not count', () => {
  const g = answering('LLL');
  for (const d of 'ULDLLRL') g.input(g.id, d, 2000);
  assert.deepEqual(g.answer, ['L', 'L', 'L']);
  assert.equal(g.correct, true);
});
test('maximum length completes game without growing beyond limit', () => {
  const g = answering('L'.repeat(32));
  for (let i = 0; i < 32; i++) g.input(g.id, 'L', 2000);
  assert.equal(g.phase, 'result');
  assert.equal(g.correct, true);
  assert.equal(g.nextLength, 32);
  assert.equal(g.completed, true);
});
test('bounded sequences allow repeated directions and reject invalid data', () => {
  assert.equal(
    makeSequence(3, () => 0),
    'LLL'
  );
  assert.equal(
    makeSequence(3, () => 0.99),
    'RRR'
  );
  const g = new Game();
  for (const s of ['', 'UP', 'L'.repeat(33)]) assert.throws(() => g.begin(s));
});
