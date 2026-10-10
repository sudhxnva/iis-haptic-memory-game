#include <cassert>
#include "../HapticController.h"
int main() {
  Playback p; assert(p.start("R", 100, 180, 300, 600, 200));
  assert(p.levels(100).left == 200 && p.levels(100).right == 0);
  assert(p.levels(279).left == 200 && p.levels(279).right == 0);
  for (unsigned t=280;t<580;t++) assert(p.levels(t).left==0 && p.levels(t).right==0);
  assert(p.levels(580).left==0 && p.levels(580).right==200);
  assert(p.levels(760).left==0 && p.levels(760).right==0);
  assert(!p.finished(1359)); assert(p.finished(1360));
  assert(p.start("L", 0, 180, 300, 600, 200));
  assert(p.levels(0).right == 200 && p.levels(0).left == 0);
  assert(p.levels(480).left == 200 && p.levels(480).right == 0);
  for (unsigned t=0;t<1260;t++) assert(!(p.levels(t).left && p.levels(t).right));
  p.stop(); assert(p.levels(0).right == 0);
  assert(!p.start("X", 0, 180, 300, 600, 200));
  assert(!p.start("L", 0, 0, 300, 600, 200));
  assert(!p.start("L", 0, 180, 300, 600, 256));
  assert(!p.start("L", 0, 180, 1001, 600, 200));
  assert(p.start("R", 0, 180, 0, 600, 200));
  assert(p.levels(179).left == 200 && p.levels(179).right == 0);
  assert(p.levels(180).left == 0 && p.levels(180).right == 200);
  for (unsigned t=0;t<960;t++) assert(!(p.levels(t).left && p.levels(t).right));
  assert(p.finished(960));
  assert(p.start("LR", 0, 180, 300, 600, 200)); assert(p.levels(1260).left == 200);
  JoystickGate j; j.reset();
  assert(j.update(0,0) == 0); assert(j.update(-1,0) == 'L');
  assert(j.update(-1,0) == 0); assert(j.update(1,0) == 0);
  assert(j.update(0.4,0) == 0); assert(j.update(0,0) == 0);
  assert(j.update(-1,0) == 'L'); j.update(0,0); assert(j.update(0,1) == 0);
  assert(j.update(-0.8,1) == 0); j.update(0,0); assert(j.update(1,0) == 'R');
}
