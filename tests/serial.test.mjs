import test from 'node:test';
import assert from 'node:assert/strict';
import { LineFramer } from '../web/serial.mjs';
test('serial lines survive arbitrary USB chunk boundaries and CRLF', () => {
  const lines = [];
  const f = new LineFramer((line) => lines.push(line));
  f.push('REA');
  f.push('DY 1\r\nSTATE 0');
  f.push(' 0 0\n\n');
  assert.deepEqual(lines, ['READY 1', 'STATE 0 0 0']);
});
test('rejects oversized lines and discards remainder until newline', () => {
  const lines = [];
  const errors = [];
  const f = new LineFramer(
    (line) => lines.push(line),
    (e) => errors.push(e)
  );
  f.push('a'.repeat(513));
  f.push('READY 1\nPONG\n');
  assert.equal(errors.length, 1);
  assert.deepEqual(lines, ['PONG']);
});

import { SerialLink } from '../web/serial.mjs';
test('concurrent close callers wait for teardown before reconnect can replace the port', async () => {
  let finishRead;
  const reading = new Promise((resolve) => (finishRead = resolve));
  let oldClosed = 0,
    newClosed = 0,
    requests = 0,
    finishNew;
  const newPort = {
    open: async () => {},
    close: async () => {
      newClosed++;
    },
    writable: { getWriter: () => ({ write: async () => {}, releaseLock() {} }) },
    readable: {
      getReader: () => ({
        read: () => new Promise((resolve) => (finishNew = resolve)),
        cancel: async () => {
          finishNew?.({ done: true });
        },
        releaseLock() {},
      }),
    },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serial: {
        requestPort: async () => {
          requests++;
          return newPort;
        },
      },
    },
  });
  try {
    const link = new SerialLink(
      () => {},
      () => {}
    );
    link.port = {
      close: async () => {
        oldClosed++;
      },
    };
    link.writer = { releaseLock() {} };
    link.reader = { cancel: async () => {} };
    link.readTask = reading;
    const first = link.close(false),
      second = link.close(false);
    let secondFinished = false;
    second.then(() => (secondFinished = true));
    const reconnect = link.connect();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(secondFinished, false, 'Second close must await the first cleanup');
    assert.equal(
      requests,
      0,
      'Reconnect must not select a replacement port during cleanup'
    );
    finishRead();
    await Promise.all([first, second, reconnect]);
    assert.equal(oldClosed, 1);
    assert.equal(newClosed, 0);
    assert.equal(link.port, newPort);
    await link.close(false);
    assert.equal(newClosed, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
});
