import { Game, makeSequence, START_LENGTH } from './game.mjs';
import { SerialLink } from './serial.mjs';
import { mountInstrument } from './visual.mjs';
const $ = (id) => document.getElementById(id);
const game = new Game();
const state = { mode: 'none', x: 0, y: 0, left: 0, right: 0 };
let ready = false,
  calibrated = false,
  calibrating = false,
  connecting = false;
let awaitingCalAck = false,
  calibrationUntil = 0;
let handshakeAt = 0,
  lastHello = 0,
  lastRx = 0,
  lastPing = 0,
  playUntil = 0,
  playStarted = false;
let settings = null,
  simStart = 0,
  testUntil = 0,
  testDirection = null,
  simTimers = [];
let round = 1,
  entryKey = null,
  lastView = '',
  autoCenterTimer = null;
const link = new SerialLink(onLine, disconnected);
const now = () => performance.now();
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
}
function params() {
  return ['pulse', 'pause', 'gap', 'pwm'].map((id) => Number($(id).value));
}
function command(line) {
  return link.send(line).catch((e) => {
    disconnected(e.message);
    void link.close(false);
  });
}
function cancelSimulation() {
  simTimers.forEach(clearTimeout);
  simTimers = [];
  clearTimeout(autoCenterTimer);
  autoCenterTimer = null;
  testDirection = null;
  testUntil = 0;
  state.left = state.right = 0;
  entryKey = null;
  state.x = state.y = 0;
}
function cancelRound() {
  cancelSimulation();
  game.cancel();
  round = 1;
  playUntil = 0;
  playStarted = false;
}
function disconnected(reason) {
  if (state.mode !== 'hardware' && !connecting) return;
  cancelRound();
  ready = calibrated = calibrating = connecting = false;
  state.mode = 'none';
  notice(reason + '. Reconnect to continue.', true);
  render();
}
function onLine(line) {
  const parts = line.split(/\s+/);
  const type = parts[0];
  if (
    ![
      'READY',
      'CALIBRATING',
      'CALIBRATED',
      'STATE',
      'START',
      'DONE',
      'INPUT',
      'CENTER',
      'PONG',
      'ERROR',
      'STOPPED',
    ].includes(type)
  )
    return;
  // USB buffers may still contain a previous session's timeout or input events.
  // Only READY establishes this connection; ignore everything else until then.
  if (!ready && type !== 'READY') return;
  lastRx = now();
  if (type === 'READY') {
    if (parts[1] !== '2') {
      disconnected(
        'Firmware and page versions differ. Refresh this page after uploading the latest sketch'
      );
      void link.close(false);
      return;
    }
    if (ready) cancelRound(); // A new READY after initialization signals a board reset.
    ready = true;
    connecting = false;
    calibrated = false;
    calibrating = true;
    awaitingCalAck = true;
    calibrationUntil = now() + 5000;
    state.mode = 'hardware';
    notice('Keep the joystick centered for calibration.');
    command('CAL');
  } else if (type === 'CALIBRATING') {
    calibrated = false;
    calibrating = true;
    awaitingCalAck = false;
  } else if (type === 'CALIBRATED') {
    // Ignore cached calibration sent alongside READY; wait for our explicit CAL response.
    if (!calibrating || awaitingCalAck || parts.length !== 3) return;
    calibrated = true;
    calibrating = false;
    notice('Connected.');
  } else if (type === 'STATE' && parts.length === 4) {
    const x = Number(parts[1]),
      y = Number(parts[2]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      state.x = ($('invert').checked ? -1 : 1) * Math.max(-1, Math.min(1, x));
      state.y = Math.max(-1, Math.min(1, y));
    }
  } else if (
    type === 'START' &&
    Number(parts[1]) === game.id &&
    game.phase === 'playing'
  ) {
    playStarted = true;
    simStart = now();
  } else if (type === 'DONE') {
    const id = Number(parts[1]);
    if (id === 0) {
      testUntil = 0;
      testDirection = null;
      state.left = state.right = 0;
    } else if (id === game.id && game.phase === 'playing') {
      game.playbackDone(id);
      command(`ARM ${id}`);
      playUntil = now() + 15000;
    }
  } else if (type === 'CENTER') {
    game.centered(Number(parts[1]), now());
  } else if (type === 'INPUT') {
    let direction = parts[2];
    if ($('invert').checked)
      direction = direction === 'L' ? 'R' : direction === 'R' ? 'L' : direction;
    submitInput(Number(parts[1]), direction);
  } else if (type === 'ERROR') {
    const message = parts.slice(1).join(' ').replaceAll('_', ' ');
    cancelRound();
    calibrating = false;
    if (message.includes('calibrat') || message.includes('joystick')) calibrated = false;
    if (message === 'heartbeat timeout' || message === 'handshake required') {
      disconnected(message);
      void link.close(false);
    } else notice('Board: ' + message + '. Use calibration or restart.', true);
  }
  render();
}
function startRound(restart = false) {
  if (
    !ready ||
    !calibrated ||
    calibrating ||
    testUntil > now() ||
    connecting ||
    !['idle', 'result'].includes(game.phase)
  )
    return;
  if (game.completed && !restart) return;
  const length = restart || game.phase === 'idle' ? START_LENGTH : game.nextLength;
  if (restart || game.phase === 'idle') round = 1;
  else if (game.correct) round++;
  cancelSimulation();
  settings = params();
  game.begin(makeSequence(length));
  const [pulse, pause, gap, pwm] = settings,
    total = (2 * pulse + pause + gap) * length;
  simStart = now();
  playUntil = simStart + total + 3000;
  playStarted = state.mode === 'simulation';
  notice(state.mode === 'simulation' ? '' : '');
  if (state.mode === 'hardware')
    command(`PLAY ${game.id} ${game.sequence} ${pulse} ${pause} ${gap} ${pwm}`);
  else {
    const id = game.id;
    simTimers.push(
      setTimeout(() => {
        game.playbackDone(id);
        game.centered(id, now());
        render();
      }, total)
    );
  }
  render();
}
function stop() {
  if (calibrating) {
    calibrating = false;
    calibrated = false;
  }
  if (state.mode === 'hardware') command('STOP');
  cancelRound();
  notice('Stopped.');
  render();
}
$('connect').onclick = async () => {
  if (state.mode === 'hardware') {
    await command('STOP');
    await link.close();
    return;
  }
  if (connecting) return;
  cancelRound();
  ready = calibrated = false;
  connecting = true;
  state.mode = 'hardware';
  notice('Select your ESP32 USB port.');
  render();
  try {
    await link.connect();
    handshakeAt = lastRx = now();
    lastHello = 0;
    notice('Waiting for the ESP32 to restart and identify itself…');
  } catch (e) {
    disconnected(e.name === 'NotFoundError' ? 'No port selected' : e.message);
  }
  render();
};
$('simulate').onclick = async () => {
  if (connecting) return;
  if (state.mode === 'hardware') {
    await command('STOP');
    await link.close(false);
  }
  cancelRound();
  ready = calibrated = true;
  calibrating = false;
  state.mode = 'simulation';
  round = 1;
  notice('Keyboard mode. Use ← / →.');
  render();
};
$('start').onclick = () => startRound();
$('restart').onclick = () => {
  stop();
  startRound(true);
};
$('stop').onclick = stop;
$('calibrate').onclick = () => {
  if (state.mode !== 'hardware' || !ready || busy()) return;
  calibrated = false;
  calibrating = true;
  awaitingCalAck = true;
  calibrationUntil = now() + 5000;
  notice('Leave the joystick centered for about one second.');
  command('CAL');
  render();
};
function testSweep(direction) {
  if (state.mode !== 'hardware' || !ready || busy()) return;
  settings = params();
  testDirection = direction;
  simStart = now();
  testUntil = simStart + 2 * settings[0] + settings[1] + settings[2] + 1500;
  command(`TEST ${direction} ${settings.join(' ')}`);
  notice(
    `Testing a ${direction === 'L' ? 'left' : 'right'} sweep. Feel which motor starts first.`
  );
  render();
}
$('test-left').onclick = () => testSweep('L');
$('test-right').onclick = () => testSweep('R');
function submitInput(id, direction) {
  const before = game.phase;
  game.input(id, direction, now());
  if (before === 'answering' && game.phase === 'result' && state.mode === 'hardware')
    command('STOP');
}
function simulatedInput(direction) {
  if (state.mode !== 'simulation' || game.phase !== 'answering') return;
  state.x = direction === 'L' ? -1 : 1;
  submitInput(game.id, direction);
  render();
}
for (const [id, direction] of [
  ['sim-left', 'L'],
  ['sim-right', 'R'],
])
  $(id).onclick = () => {
    simulatedInput(direction);
    clearTimeout(autoCenterTimer);
    autoCenterTimer = setTimeout(() => (state.x = 0), 150);
  };
window.addEventListener('keydown', (e) => {
  if (
    state.mode !== 'simulation' ||
    !['ArrowLeft', 'ArrowRight'].includes(e.key) ||
    ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)
  )
    return;
  e.preventDefault();
  if (e.repeat || entryKey) return;
  entryKey = e.key;
  simulatedInput(e.key === 'ArrowLeft' ? 'L' : 'R');
});
window.addEventListener('keyup', (e) => {
  if (e.key === entryKey) {
    entryKey = null;
    state.x = 0;
  }
});
window.addEventListener('blur', () => {
  entryKey = null;
  state.x = 0;
});
for (const id of ['pulse', 'pause', 'gap', 'pwm'])
  $(id).oninput = () =>
    ($(id + '-value').textContent = $(id).value + (id === 'pwm' ? ' / 255' : ' ms'));
$('invert').onchange = () => {
  if (busy()) stop();
};
function busy() {
  return (
    connecting ||
    calibrating ||
    testUntil > now() ||
    ['playing', 'centering', 'answering'].includes(game.phase)
  );
}
function arrows(target, directions, expected = false) {
  target.replaceChildren();
  if (!directions.length) {
    const span = document.createElement('span');
    span.className = 'empty';
    span.textContent = expected ? 'Shown when you finish.' : 'No moves yet.';
    target.append(span);
    return;
  }
  const n = game.revealed
    ? Math.max(game.sequence.length, game.answer.length)
    : directions.length;
  for (let i = 0; i < n; i++) {
    const d = directions[i];
    const node = document.createElement('span');
    node.className = 'arrow';
    node.textContent = d ? (d === 'L' ? '←' : '→') : '·';
    node.setAttribute(
      'aria-label',
      `${i + 1}: ${d ? (d === 'L' ? 'left' : 'right') : 'missing'}`
    );
    if (game.revealed)
      node.classList.add(
        d === undefined
          ? 'missing'
          : game.answer[i] === game.sequence[i]
            ? 'correct'
            : 'wrong'
      );
    const index = document.createElement('small');
    index.textContent = i + 1;
    node.append(index);
    target.append(node);
  }
}
const phases = {
  idle: 'Press start.',
  playing: 'Wait…',
  centering: 'Center the joystick.',
  answering: 'Your turn!',
  result: '',
};
function render() {
  const active = busy(),
    length = game.sequence.length || START_LENGTH;
  document.body.dataset.phase = game.phase;
  $('connection').textContent = connecting
    ? '● Connecting…'
    : state.mode === 'simulation'
      ? '● Simulation'
      : ready
        ? '● ESP32 connected'
        : '● Disconnected';
  $('connection').classList.toggle('connected', ready);
  $('connect').textContent =
    state.mode === 'hardware' && ready ? 'Disconnect ESP32' : 'Connect ESP32';
  $('connect').disabled = connecting;
  $('simulate').disabled = connecting;
  $('sim-controls').hidden = state.mode !== 'simulation';
  $('length').textContent = length;
  $('length-label').textContent = length === 1 ? 'move to remember' : 'moves to remember';
  $('level').textContent = String(round);
  $('start').disabled = !ready || !calibrated || active || game.completed;
  $('start').textContent =
    game.phase === 'result'
      ? game.completed
        ? 'All 32 remembered ✓'
        : game.correct
          ? 'Next round →'
          : 'Try again →'
      : 'Start round →';
  $('restart').disabled =
    !ready || !calibrated || connecting || calibrating || testUntil > now();
  $('stop').disabled = !ready || (!active && game.phase === 'idle');
  for (const id of ['calibrate', 'test-left', 'test-right'])
    $(id).disabled = state.mode !== 'hardware' || !ready || active;
  for (const id of ['pulse', 'pause', 'gap', 'pwm', 'invert']) $(id).disabled = active;
  for (const id of ['sim-left', 'sim-right']) $(id).disabled = game.phase !== 'answering';
  $('instruction').textContent =
    game.phase === 'playing' && state.mode === 'simulation'
      ? 'Watch the arrows.'
      : phases[game.phase];
  $('answer-count').textContent = `${game.answer.length} / ${length}`;
  $('reveal-status').textContent = game.revealed ? 'Shown' : 'Hidden for now';
  const view = [game.id, game.phase, game.answer.join('')].join(':');
  if (view !== lastView) {
    delete $('expected').dataset.preview;
    arrows($('answer'), game.answer);
    arrows($('expected'), game.revealed ? [...game.sequence] : [], true);
    lastView = view;
  }
  $('result').textContent = game.revealed
    ? game.correct
      ? game.completed
        ? 'You got all 32 moves!'
        : 'Correct!'
      : 'Not quite. Try again?'
    : '';
  $('result').className = game.revealed ? (game.correct ? 'success' : 'failure') : '';
}
function animate() {
  const time = now(),
    before = game.phase;
  game.tick(time);
  if (calibrating && time > calibrationUntil) {
    stop();
    notice('Calibration timed out. Center the joystick and calibrate again.', true);
  }
  if (before !== game.phase) {
    if (state.mode === 'hardware') command('STOP');
    render();
  }
  if ((game.phase === 'playing' || game.phase === 'centering') && time > playUntil) {
    stop();
    notice(
      'Playback or centering timed out. Check the connection and joystick, then restart.',
      true
    );
  }
  if (testUntil && time > testUntil) {
    stop();
    notice('Motor test acknowledgment timed out.', true);
  }
  state.left = state.right = 0;
  if ((game.phase === 'playing' && playStarted) || testDirection) {
    const [pulse, pause, gap] = settings,
      elapsed = Math.max(0, time - simStart),
      step = Math.floor(elapsed / (2 * pulse + pause + gap)),
      t = elapsed % (2 * pulse + pause + gap);
    const d = testDirection || game.sequence[step];
    if (d) {
      const first = t < pulse ? 1 : 0,
        second = t >= pulse + pause && t < 2 * pulse + pause ? 1 : 0;
      state.left = d === 'R' ? first : second;
      state.right = d === 'R' ? second : first;
    }
    if (state.mode === 'simulation' && game.phase === 'playing') {
      const visible = d && t < 2 * pulse + pause ? d : '';
      if ($('expected').dataset.preview !== visible) {
        arrows($('expected'), visible ? [visible] : [], true);
        $('expected').dataset.preview = visible;
      }
    }
    // Physical patterns stay hidden.
    if (state.mode === 'hardware') state.left = state.right = 0;
  }
  $('timer').textContent =
    game.phase === 'answering' ? `${(game.remaining(time) / 1000).toFixed(1)}s` : '—';
  $('time-bar').style.width =
    game.phase === 'answering'
      ? `${(game.remaining(time) / (game.sequence.length * 2000 + 3000)) * 100}%`
      : '0%';
  $('input-readout').textContent = `X ${state.x.toFixed(2)} · Y ${state.y.toFixed(2)}`;
  requestAnimationFrame(animate);
}
setInterval(() => {
  const time = now();
  if (state.mode !== 'hardware' || !link.writer) return;
  if (!ready) {
    if (time - handshakeAt > 10000) {
      disconnected('No compatible firmware response');
      void link.close(false);
    } else if (time - lastHello > 700) {
      lastHello = time;
      command('HELLO');
    }
  } else {
    if (time - lastRx > 4000) {
      disconnected('Board stopped responding');
      void link.close(false);
    } else if (time - lastPing > 500) {
      lastPing = time;
      command('PING');
    }
  }
}, 200);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && busy()) {
    stop();
    notice('Round stopped because the page was hidden.');
  }
});
window.addEventListener('pagehide', () => {
  if (state.mode === 'hardware') void link.send('STOP').catch(() => {});
});
render();
mountInstrument(state);
requestAnimationFrame(animate);
