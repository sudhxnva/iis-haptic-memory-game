export const START_LENGTH = 1;
export const MAX_LENGTH = 32;
export function makeSequence(length, random = Math.random) {
  if (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH)
    throw new Error('Invalid sequence length');
  return Array.from({ length }, () => (random() < 0.5 ? 'L' : 'R')).join('');
}
export class Game {
  constructor() {
    this.id = 0;
    this.cancel();
  }
  cancel() {
    this.id++;
    this.phase = 'idle';
    this.sequence = '';
    this.answer = [];
    this.deadline = null;
    this.correct = null;
    this.completed = false;
  }
  begin(sequence) {
    if (!/^[LR]{1,32}$/.test(sequence))
      throw new Error('Expected 1–32 left/right directions');
    this.cancel();
    this.sequence = sequence;
    this.phase = 'playing';
  }
  playbackDone(id) {
    if (id === this.id && this.phase === 'playing') this.phase = 'centering';
  }
  centered(id, now) {
    if (id !== this.id || this.phase !== 'centering') return;
    this.phase = 'answering';
    this.deadline = now + this.sequence.length * 2000 + 3000;
  }
  input(id, direction, now) {
    this.tick(now);
    if (id !== this.id || this.phase !== 'answering' || !/^[LR]$/.test(direction)) return;
    this.answer.push(direction);
    if (this.answer.length === this.sequence.length) this.finish();
  }
  tick(now) {
    if (this.phase !== 'answering' || now < this.deadline) return;
    this.finish();
  }
  finish() {
    this.correct = this.answer.join('') === this.sequence;
    this.completed = this.correct && this.sequence.length === MAX_LENGTH;
    this.phase = 'result';
  }
  get revealed() {
    return this.phase === 'result';
  }
  get nextLength() {
    return Math.min(MAX_LENGTH, this.sequence.length + (this.correct ? 1 : 0));
  }
  remaining(now) {
    return this.phase === 'answering' ? Math.max(0, this.deadline - now) : 0;
  }
}
