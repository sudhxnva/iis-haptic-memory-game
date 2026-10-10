#include "HapticController.h"
#include <stdio.h>
#include <stdlib.h>

// Original motor wiring; A is worn left, B is worn right.
const int enA = 13, in1 = 12, in2 = 14, enB = 25, in3 = 27, in4 = 26;
const int joystickX = 36, joystickY = 39, joystickButton = 17;
Playback playback;
JoystickGate joystick;
uint32_t roundId = 0, lastHeartbeat = 0, lastSample = 0, lastState = 0;
bool session = false, armed = false, centerSent = false, calibrated = false,
     calibrating = false;
unsigned calibrationSamples = 0;
uint32_t sumX = 0, sumY = 0;
float centerX = 2048, centerY = 2048, filteredX = 2048, filteredY = 2048;
char command[160];
unsigned commandLength = 0;
bool lineOverflow = false;
int lastLeft = -1, lastRight = -1;

// An idle motor has all three control pins low. Direction pins provide a second
// off path if an enable jumper is misplaced or an enable input is held high.
void motors(unsigned left, unsigned right) {
  const bool changeLeft = lastLeft != int(left), changeRight = lastRight != int(right);
  // Disable every outgoing motor first, even if a delayed loop skipped a pause.
  if (changeLeft) {
    analogWrite(enA, 0);
    digitalWrite(in1, LOW);
    digitalWrite(in2, LOW);
  }
  if (changeRight) {
    analogWrite(enB, 0);
    digitalWrite(in3, LOW);
    digitalWrite(in4, LOW);
  }
  if (changeLeft) {
    if (left) {
      digitalWrite(in1, HIGH);
      analogWrite(enA, left);
    }
    lastLeft = left;
  }
  if (changeRight) {
    if (right) {
      digitalWrite(in3, HIGH);
      analogWrite(enB, right);
    }
    lastRight = right;
  }
}
void halt() {
  playback.stop();
  armed = false;
  centerSent = false;
  motors(0, 0);
  joystick.reset();
}
void error(const char *reason) {
  halt();
  calibrating = false;
  Serial.print("ERROR ");
  Serial.println(reason);
}
float normalized(float value, float center) {
  float v = (value - center) / (value < center ? center : 4095 - center);
  return constrain(v, -1.0f, 1.0f);
}
void handleCommand(char *line) {
  if (!strcmp(line, "HELLO")) {
    halt();
    calibrating = false;
    session = true;
    lastHeartbeat = millis();
    Serial.println("READY 2");
    if (calibrated) {
      Serial.print("CALIBRATED ");
      Serial.print(int(centerX));
      Serial.print(' ');
      Serial.println(int(centerY));
    }
    return;
  }
  if (!strcmp(line, "STOP")) {
    halt();
    calibrating = false;
    Serial.println("STOPPED");
    return;
  }
  if (!strcmp(line, "STATUS")) {
    Serial.print("PINS 13=");
    Serial.print(digitalRead(enA));
    Serial.print(" 12=");
    Serial.print(digitalRead(in1));
    Serial.print(" 14=");
    Serial.print(digitalRead(in2));
    Serial.print(" 25=");
    Serial.print(digitalRead(enB));
    Serial.print(" 27=");
    Serial.print(digitalRead(in3));
    Serial.print(" 26=");
    Serial.println(digitalRead(in4));
    return;
  }
  if (!session) {
    error("handshake_required");
    return;
  }
  if (!strcmp(line, "PING")) {
    lastHeartbeat = millis();
    Serial.println("PONG");
    return;
  }
  if (!strcmp(line, "CAL")) {
    halt();
    calibrated = false;
    calibrating = true;
    calibrationSamples = 0;
    sumX = sumY = 0;
    Serial.println("CALIBRATING");
    return;
  }
  unsigned long id;
  unsigned pulse, pause, gap, pwm;
  char sequence[33], extra;
  if (!strncmp(line, "PLAY ", 5)) {
    halt();
    if (!calibrated || calibrating) {
      error("calibration_required");
      return;
    }
    if (sscanf(line, "PLAY %lu %32s %u %u %u %u %c", &id, sequence, &pulse, &pause, &gap,
               &pwm, &extra) != 6 ||
        id == 0 || id > 0xFFFFFFFFUL ||
        !playback.start(sequence, millis(), pulse, pause, gap, pwm)) {
      error("invalid_play");
      return;
    }
    roundId = id;
    Serial.print("START ");
    Serial.println(roundId);
    return;
  }
  if (!strncmp(line, "ARM ", 4)) {
    if (!calibrated || calibrating || playback.active ||
        sscanf(line, "ARM %lu %c", &id, &extra) != 1 || id != roundId) {
      error("invalid_arm");
      return;
    }
    armed = true;
    centerSent = false;
    joystick.reset();
    return;
  }
  if (!strncmp(line, "TEST ", 5)) {
    halt();
    if (sscanf(line, "TEST %32s %u %u %u %u %c", sequence, &pulse, &pause, &gap, &pwm,
               &extra) != 5 ||
        strlen(sequence) != 1 ||
        !playback.start(sequence, millis(), pulse, pause, gap, pwm)) {
      error("invalid_test");
      return;
    }
    roundId = 0;
    Serial.println("START 0");
    return;
  }
  error("unknown_command");
}
void setup() {
  pinMode(enA, OUTPUT);
  pinMode(in1, OUTPUT);
  pinMode(in2, OUTPUT);
  pinMode(enB, OUTPUT);
  pinMode(in3, OUTPUT);
  pinMode(in4, OUTPUT);
  digitalWrite(enA, LOW);
  digitalWrite(enB, LOW);
  digitalWrite(in1, LOW);
  digitalWrite(in2, LOW);
  digitalWrite(in3, LOW);
  digitalWrite(in4, LOW);
  pinMode(joystickX, INPUT);
  pinMode(joystickY, INPUT);
  pinMode(joystickButton, INPUT_PULLUP);
  analogReadResolution(12);
  analogSetPinAttenuation(joystickX, ADC_11db);
  analogSetPinAttenuation(joystickY, ADC_11db);
  Serial.begin(115200);
  motors(0, 0);
}
void loop() {
  const uint32_t now = millis();
  // Bound processing per pass so continuous serial input cannot starve the watchdog.
  for (unsigned bytes = 0; bytes < 64 && Serial.available(); bytes++) {
    const char c = Serial.read();
    if (c == '\r')
      continue;
    if (c == '\n') {
      if (lineOverflow)
        error("line_too_long");
      else if (commandLength) {
        command[commandLength] = 0;
        handleCommand(command);
      }
      commandLength = 0;
      lineOverflow = false;
    } else if (commandLength < sizeof(command) - 1 && !lineOverflow)
      command[commandLength++] = c;
    else {
      lineOverflow = true;
      halt();
    }
  }
  // handleCommand can update timestamps after this loop's 'now' was captured.
  const uint32_t current = millis();
  if (session && uint32_t(current - lastHeartbeat) > 2500) {
    halt();
    session = false;
    calibrating = false;
    Serial.println("ERROR heartbeat_timeout");
  }
  if (playback.active) {
    if (playback.finished(current)) {
      halt();
      Serial.print("DONE ");
      Serial.println(roundId);
    } else {
      const MotorLevels levels = playback.levels(current);
      motors(levels.left, levels.right);
    }
  }
  if (uint32_t(now - lastSample) >= 20) {
    lastSample = now;
    const int rawX = analogRead(joystickX), rawY = analogRead(joystickY);
    filteredX += 0.35f * (rawX - filteredX);
    filteredY += 0.35f * (rawY - filteredY);
    if (calibrating) {
      sumX += rawX;
      sumY += rawY;
      calibrationSamples++;
      if (calibrationSamples >= 40) {
        centerX = float(sumX) / calibrationSamples;
        centerY = float(sumY) / calibrationSamples;
        calibrating = false;
        if (centerX < 700 || centerX > 3400 || centerY < 700 || centerY > 3400) {
          centerX = centerY = 2048;
          error("center_joystick_and_recalibrate");
        } else {
          calibrated = true;
          filteredX = centerX;
          filteredY = centerY;
          Serial.print("CALIBRATED ");
          Serial.print(int(centerX));
          Serial.print(' ');
          Serial.println(int(centerY));
        }
      }
    }
    const float x = normalized(filteredX, centerX), y = normalized(filteredY, centerY);
    if (armed) {
      const char direction = joystick.update(x, y);
      if (!centerSent && JoystickGate::centered(x, y)) {
        centerSent = true;
        Serial.print("CENTER ");
        Serial.println(roundId);
      }
      if (centerSent && direction) {
        Serial.print("INPUT ");
        Serial.print(roundId);
        Serial.print(' ');
        Serial.println(direction);
      }
    }
    if (session && uint32_t(now - lastState) >= 50) {
      lastState = now;
      Serial.print("STATE ");
      Serial.print(x, 3);
      Serial.print(' ');
      Serial.print(y, 3);
      Serial.print(' ');
      Serial.println(digitalRead(joystickButton) == LOW ? 1 : 0);
    }
  }
}
