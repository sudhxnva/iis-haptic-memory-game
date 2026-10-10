// Optional browser regression suite. Requires Playwright and a running localhost server.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_DIR
    ? `${process.env.PLAYWRIGHT_MODULE_DIR}/playwright`
    : 'playwright'
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
});
const url = process.env.HAPTIC_TEST_URL || 'http://127.0.0.1:8000';
const errors = [];
async function pageFor(context) {
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url);
  return p;
}
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await pageFor(context);
  assert.equal(await page.locator('#length').textContent(), '1');
  await page.locator('#simulate').click();
  await page.evaluate(() => (Math.random = () => 0.1));
  await page.locator('#start').click();
  await page.waitForTimeout(180);
  assert.equal(await page.locator('#expected .arrow').count(), 1);
  await page.waitForFunction(() => document.body.dataset.phase === 'answering');
  assert.equal(await page.locator('#expected .arrow').count(), 0);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.body.dataset.phase === 'result', null, {
    timeout: 1000,
  });
  assert.equal(await page.locator('#answer .arrow').count(), 1);
  assert.equal(await page.locator('#expected .arrow').count(), 1);
  assert.match(await page.locator('#result').textContent(), /^Correct/);
  await page.locator('#start').click();
  assert.equal(await page.locator('#length').textContent(), '2');
  await page.waitForFunction(() => document.body.dataset.phase === 'answering');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowRight');
  assert.equal(await page.locator('#answer .arrow').count(), 1);
  assert.equal(await page.locator('#expected .arrow').count(), 0);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.body.dataset.phase === 'result', null, {
    timeout: 1000,
  });
  assert.equal(await page.locator('#answer .arrow').count(), 2);
  assert.match(await page.locator('#result').textContent(), /^Not quite/);
  assert.equal(await page.locator('#expected .arrow').count(), 2);
  await page.locator('#start').click();
  assert.equal(await page.locator('#length').textContent(), '2');
  await page.waitForFunction(() => document.body.dataset.phase === 'answering');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#expected .arrow').count(), 0);
  await page.waitForFunction(() => document.body.dataset.phase === 'result');
  assert.match(await page.locator('#result').textContent(), /^Not quite/);
  await page.locator('#restart').click();
  assert.equal(await page.locator('#length').textContent(), '1');
  await page.locator('#stop').click();
  assert.equal(await page.locator('body').getAttribute('data-phase'), 'idle');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#pause').inputValue(), '120');
  await page.locator('#pause').focus();
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#pause').inputValue(), '0');
  assert.equal(await page.locator('#pause-value').textContent(), '0 ms');
  assert.equal(await page.locator('#gap').inputValue(), '600');
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false
  );
  await context.close();
  console.log(
    'Simulation: one-move start, immediate scoring, one-to-two progression, held-key gating, incomplete timeout, restart, pauses and mobile layout passed.'
  );

  const usb = await browser.newContext();
  await usb.addInitScript(() => {
    const encoder = new TextEncoder();
    let pending = [],
      chunks = [];
    const emit = (line) => {
      const data = { value: encoder.encode(line + '\n'), done: false };
      if (pending.length) pending.shift()(data);
      else chunks.push(data);
    };
    window.fakeEmit = emit;
    window.sent = [];
    const port = {
      open: async () => {
        emit('ERROR heartbeat_timeout');
        emit('STATE 0 0 0');
      },
      close: async () => {},
      writable: {
        getWriter: () => ({
          releaseLock() {},
          write: async (bytes) => {
            const command = new TextDecoder().decode(bytes).trim();
            window.sent.push(command);
            if (command === 'HELLO') {
              emit('READY 2');
              emit('CALIBRATED 1000 1000');
            }
            if (command === 'CAL')
              setTimeout(() => {
                emit('CALIBRATING');
                setTimeout(() => emit('CALIBRATED 2048 2048'), 800);
              }, 300);
            if (command === 'PING') emit('PONG');
            if (command.startsWith('PLAY ')) {
              const id = command.split(' ')[1];
              emit('START ' + id);
              setTimeout(() => emit('DONE ' + id), 100);
            }
            if (command.startsWith('ARM ')) emit('CENTER ' + command.split(' ')[1]);
            if (command === 'STOP') emit('STOPPED');
          },
        }),
      },
      readable: {
        getReader: () => ({
          releaseLock() {},
          read: () =>
            chunks.length
              ? Promise.resolve(chunks.shift())
              : new Promise((resolve) => pending.push(resolve)),
          cancel: async () => {
            for (const resolve of pending.splice(0)) resolve({ done: true });
          },
        }),
      },
    };
    Object.defineProperty(navigator, 'serial', {
      value: { requestPort: async () => port },
      configurable: true,
    });
  });
  const hardware = await pageFor(usb);
  await hardware.locator('#connect').click();
  await hardware.waitForFunction(() => window.sent.includes('CAL'), null, {
    timeout: 2500,
  });
  await hardware.waitForTimeout(100);
  assert.equal(await hardware.locator('#start').isEnabled(), false);
  await hardware.waitForFunction(() => !document.querySelector('#start').disabled);
  await hardware.evaluate(() => (Math.random = () => 0.1));
  // Physical X orientation can be inverted without changing haptic directions.
  await hardware.locator('#invert').check();
  await hardware.locator('#start').click();
  await hardware.waitForFunction(() => document.body.dataset.phase === 'answering');
  const play = await hardware.evaluate(() =>
    window.sent.find((x) => x.startsWith('PLAY '))
  );
  const id = play.split(' ')[1];
  await hardware.evaluate((id) => {
    window.fakeEmit(`INPUT ${Number(id) - 1} R`);
    window.fakeEmit(`INPUT ${id} R`);
    window.fakeEmit(`INPUT ${id} R`);
    window.fakeEmit(`INPUT ${id} R`);
  }, id);
  await hardware.waitForFunction(() => document.body.dataset.phase === 'result', null, {
    timeout: 1000,
  });
  assert.equal(await hardware.locator('#answer .arrow').count(), 1);
  assert.equal(await hardware.locator('#expected .arrow').count(), 1);
  await hardware.waitForFunction(() => window.sent.includes('STOP'));
  assert.equal(
    await hardware.evaluate(() => window.sent.filter((x) => x === 'STOP').length),
    1
  );
  assert.match(await hardware.locator('#result').textContent(), /^Correct/);
  await hardware.locator('#start').click();
  await hardware.waitForFunction(() => document.body.dataset.phase === 'answering');
  await hardware.locator('#connect').click();
  assert.equal(await hardware.locator('body').getAttribute('data-phase'), 'idle');
  assert.match(await hardware.locator('#connection').textContent(), /Disconnected/);
  await usb.close();
  assert.deepEqual(errors, []);
  console.log(
    'Mock USB: cached calibration rejection, acknowledgment, inverted input, stale events, immediate scoring and STOP, disconnect passed. No page errors.'
  );
} finally {
  await browser.close();
}
