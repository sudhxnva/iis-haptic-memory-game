# Haptic memory game

Two vibration motors play a pattern of left and right moves. Copy it with a
joystick. The game starts with one move and adds another each time you get it
right. Your answer appears on the page as you enter it; the actual pattern is
shown after the last move, or when the timer runs out.

YouTube video demo: https://youtube.com/shorts/3NSUQQfxofE

## Wiring

The board is an ESP32 with an L293D motor driver. Motor A goes on the left of
your hand, motor B on the right. All grounds are connected together.

| Connection         | GPIO    |
| ------------------ | ------- |
| Motor A enable     | 13      |
| Motor A IN1 / IN2  | 12 / 14 |
| Motor B enable     | 25      |
| Motor B IN3 / IN4  | 27 / 26 |
| Joystick VRx / VRy | 36 / 39 |
| Joystick switch    | 17      |

Power the joystick from **3.3V**, not 5V: its analog outputs connect directly
to the ESP32. Keep the motor supply on the existing driver circuit.

## Running it

1. Open `vibration-lab.ino` in Arduino IDE, with `HapticController.h` in the
   same folder. Select ESP32 Dev Module and upload. Tested with ESP32 core 3.3.11;
   no extra Arduino libraries are needed.
2. Close Serial Monitor and Serial Plotter, then run:

   ```sh
   python3 -m http.server 8000 --bind 127.0.0.1 --directory web
   ```

3. Open http://127.0.0.1:8000 in a browser with Web Serial support, such as
   Chrome, Edge or Brave. Connect the ESP32 and leave the joystick centered
   while it calibrates.
4. Test each direction with the motor settings buttons. Flip the joystick
   direction if the live display is reversed. Press Start round to play.

Return the joystick to the middle between moves. Up/down and the button do
not count. You get 2 seconds per move plus 3 seconds to answer. Restart goes
back to one move; Stop cancels playback. Losing the browser connection stops
the motors, and leaving the tab during a round cancels it.

Without a board, use **Play with keyboard**. Watch the arrows, then answer with
left/right keys or the buttons. Release each key between moves.

## Motor settings

A right move pulses the left motor first, then the right motor. A left move
reverses that order. Defaults are 120 ms per pulse, 120 ms between motors,
600 ms between moves, and strength 200 out of 255. The pause slider starts at
0 ms. Tune the settings between rounds to suit the motors and their spacing.

## Code

- `vibration-lab.ino`: pins, serial commands, calibration and joystick readings.
- `HapticController.h`: pulse timing and joystick input thresholds.
- `web/game.mjs`: rounds, timing and scoring.
- `web/serial.mjs`: Web Serial connection and message framing.
- `web/app.mjs`: controls and communication with the board.
- `web/visual.mjs`: p5.js joystick display.
- `web/vendor/`: bundled p5.js and its license.
- `tests/`: software tests, including a simulated Arduino environment.

The board and browser use protocol version 2 at 115200 baud. `HELLO` starts a
session, `CAL` calibrates, `PLAY` starts a pattern, and `ARM` enables joystick
answers. `STOP` switches off the motors. `PING` keeps the connection alive;
after 2.5 seconds without a heartbeat, the board stops. `STATUS` reports the
six motor control pins for troubleshooting.

The C++ files use clang-format with the included configuration. The bundled
p5.js file is third-party minified code and is kept as distributed.
