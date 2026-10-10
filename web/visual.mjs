export function mountInstrument(state) {
  const host = document.querySelector('#joystick-canvas');
  if (!window.p5) {
    host.textContent = 'p5.js could not load. Reload the local app.';
    return;
  }
  new window.p5((p) => {
    p.setup = () => {
      p.createCanvas(host.clientWidth, 150);
      p.frameRate(30);
    };
    p.windowResized = () => p.resizeCanvas(host.clientWidth, 150);
    p.draw = () => {
      p.clear();
      const cx = p.width / 2,
        cy = 75;
      p.noFill();
      p.stroke('#bbb');
      p.strokeWeight(1);
      p.circle(cx, cy, 96);
      p.circle(cx, cy, 42);
      p.line(cx - 58, cy, cx + 58, cy);
      p.line(cx, cy - 58, cx, cy + 58);
      p.noStroke();
      p.fill('#255bd6');
      p.circle(cx + state.x * 42, cy + state.y * 42, 18);
    };
  }, host);
}
