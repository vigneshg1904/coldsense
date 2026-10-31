// Animated PCB-trace background: faint copper-style traces with signal pulses travelling along them.
import { prefersReducedMotion } from './ui.js';

export function startBackground(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const GRID = 44;
  let W = 0, H = 0, dpr = 1, traces = [], layer = null, raf = 0, last = 0, running = true;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  function makeTrace() {
    let x = Math.round(rnd(0, W) / GRID) * GRID, y = Math.round(rnd(0, H) / GRID) * GRID;
    let d = Math.floor(rnd(0, 4)) * 1;
    const pts = [[x, y]];
    const segs = 4 + Math.floor(rnd(0, 7));
    for (let i = 0; i < segs; i++) {
      // prefer straight/orthogonal runs with occasional 45° bends
      const turn = Math.random();
      if (turn < 0.5) d = [0, 1, 2, 3][Math.floor(rnd(0, 4))];
      else d = Math.floor(rnd(4, 8));
      const len = (1 + Math.floor(rnd(0, 4))) * GRID;
      x += DIRS[d][0] * len; y += DIRS[d][1] * len;
      pts.push([x, y]);
    }
    const lens = []; let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); lens.push(l); total += l; }
    return { pts, lens, total, pulse: Math.random() < 0.7 ? rnd(0, total) : -1, speed: rnd(55, 130), hue: Math.random() < 0.8 ? 0 : 1 };
  }

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const n = Math.max(10, Math.min(30, Math.round((W * H) / 70000)));
    traces = Array.from({ length: n }, makeTrace);
    layer = document.createElement('canvas');
    layer.width = canvas.width; layer.height = canvas.height;
    const c = layer.getContext('2d');
    c.scale(dpr, dpr);
    c.lineJoin = 'round'; c.lineCap = 'round';
    for (const t of traces) {
      c.strokeStyle = t.hue ? 'rgba(217,137,75,.10)' : 'rgba(46,230,197,.085)';
      c.lineWidth = 1.3;
      c.beginPath(); t.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
      // via pads at both ends
      for (const [x, y] of [t.pts[0], t.pts[t.pts.length - 1]]) {
        c.beginPath(); c.arc(x, y, 3.2, 0, 7); c.stroke();
        c.beginPath(); c.arc(x, y, 1, 0, 7); c.fillStyle = c.strokeStyle; c.fill();
      }
    }
  }

  function pointAt(t, dist) {
    let d = dist;
    for (let i = 0; i < t.lens.length; i++) {
      if (d <= t.lens[i]) { const k = d / t.lens[i]; return [t.pts[i][0] + (t.pts[i + 1][0] - t.pts[i][0]) * k, t.pts[i][1] + (t.pts[i + 1][1] - t.pts[i][1]) * k]; }
      d -= t.lens[i];
    }
    return t.pts[t.pts.length - 1];
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return;           // ~30 fps is plenty for a background
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const t of traces) {
      if (t.pulse < 0) { if (Math.random() < 0.004) t.pulse = 0; continue; }
      t.pulse += t.speed * dt;
      if (t.pulse > t.total + 30) { t.pulse = Math.random() < 0.5 ? -1 : 0; continue; }
      const col = t.hue ? '255,176,32' : '46,230,197';
      for (let k = 0; k < 14; k++) {              // fading comet tail
        const dist = t.pulse - k * 4;
        if (dist < 0 || dist > t.total) continue;
        const [x, y] = pointAt(t, dist);
        ctx.fillStyle = `rgba(${col},${(0.5 * (1 - k / 14)).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(x, y, 2.2 - k * 0.1, 0, 7); ctx.fill();
      }
    }
  }

  build();
  if (prefersReducedMotion) { ctx.drawImage(layer, 0, 0); return; }
  raf = requestAnimationFrame(frame);
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(build, 250); });
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) { last = performance.now(); raf = requestAnimationFrame(frame); } else cancelAnimationFrame(raf);
  });
}
