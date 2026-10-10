#ifndef HAPTIC_CONTROLLER_H
#define HAPTIC_CONTROLLER_H
#include <math.h>
#include <stdint.h>
#include <string.h>
struct MotorLevels {
  unsigned left;
  unsigned right;
};
class Playback {
public:
  bool active = false;
  bool start(const char *sequence, uint32_t now, unsigned pulse, unsigned pause,
             unsigned gap, unsigned pwm) {
    stop();
    const size_t n = strlen(sequence);
    if (n < 1 || n > 32 || pulse < 50 || pulse > 1000 || pause > 1000 || gap < 100 ||
        gap > 2000 || pwm < 1 || pwm > 255)
      return false;
    for (size_t i = 0; i < n; i++)
      if (sequence[i] != 'L' && sequence[i] != 'R')
        return false;
    strcpy(actions, sequence);
    count = n;
    startTime = now;
    duration = pulse;
    delayTime = pause;
    silence = gap;
    intensity = pwm;
    active = true;
    return true;
  }
  void stop() {
    active = false;
  }
  uint32_t actionTime() const {
    return 2 * duration + delayTime + silence;
  }
  bool finished(uint32_t now) const {
    return active && uint32_t(now - startTime) >= count * actionTime();
  }
  MotorLevels levels(uint32_t now) const {
    MotorLevels result = {0, 0};
    if (!active || finished(now))
      return result;
    const uint32_t elapsed = uint32_t(now - startTime), t = elapsed % actionTime();
    const bool first = t < duration,
               second = t >= duration + delayTime && t < 2 * duration + delayTime;
    const bool right = actions[elapsed / actionTime()] == 'R';
    result.left = (right ? first : second) ? intensity : 0;
    result.right = (right ? second : first) ? intensity : 0;
    return result;
  }

private:
  char actions[33] = {0};
  unsigned count = 0, duration = 120, delayTime = 120, silence = 600, intensity = 200;
  uint32_t startTime = 0;
};
class JoystickGate {
public:
  void reset() {
    ready = false;
  }
  static bool centered(float x, float y) {
    return fabsf(x) < 0.25f && fabsf(y) < 0.25f;
  }
  char update(float x, float y) {
    if (centered(x, y)) {
      ready = true;
      return 0;
    }
    if (ready && fabsf(x) > 0.60f && fabsf(x) > fabsf(y)) {
      ready = false;
      return x < 0 ? 'L' : 'R';
    }
    // A vertical excursion must also return to center before a horizontal action.
    if (fabsf(y) > 0.60f && fabsf(y) >= fabsf(x))
      ready = false;
    return 0;
  }

private:
  bool ready = false;
};
#endif
