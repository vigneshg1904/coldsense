// Patient-monitor style canvas for the landing hero.
// Top lane: link trace — beats while the ESP32 is online, flat-lines when it is offline.
// Bottom lane: the real temperature history received from the ESP32 (last 10 minutes).
import { prefersReducedMotion } from './ui.js';

export function createMonitor(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let ecg = [];
  let phase = 1, acc = 0, last = 0, raf = 0, visible = true;
  const model = { online: false, temps: [], tmin: 2, tmax: 8, now: () => Date.now() };
  const SPEED = 64, BEAT = 0.95, WINDOW = 10 * 60 * 1000;

  const g = (t, c, w) => Math.exp(-((t - c) * (t - c)) / (2 * w * w));
  const qrs = (t) => 0.13 * g(t, 0.16, 0.03) - 0.12 * g(t, 0.3, 0.011) + 1.0 * g(t, 0.33, 0.009) - 0.26 * g(t, 0.365, 0.012) + 0.3 * g(t, 0.6, 0.055);

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(10, Math.round(r.width)); H = Math.max(10, Math.round(r.height));
    canvas.width = W * dpr; canvas.height = H * dpr;
    ecg = new Array(W).fill(0);
  }

  function push(n) {
    for (let i = 0; i < n; i++) {
      let y = 0;
      if (model.online) {
        phase += 1 / (BEAT * SPEED);
        if (phase >= 1) phase -= 1;
        y = qrs(phase) + (Math.random() - 0.5) * 0.015;
      } else y = (Math.random() - 0.5) * 0.004;
      ecg.push(y); ecg.shift();
    }
  }

  function grid() {
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 10) { ctx.strokeStyle = x % 50 === 0 ? 'rgba(46,230,197,.10)' : 'rgba(46,230,197,.045)'; ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 10) { ctx.strokeStyle = y % 50 === 0 ? 'rgba(46,230,197,.10)' : 'rgba(46,230,197,.045)'; ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke(); }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    grid();
    const on = model.online;
    const split = Math.round(H * 0.44);

    // ---- lane 1: link / ECG ----
    const mid = split * 0.58, amp = split * 0.36;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = on ? '#2ee6c5' : '#ff5d73';
    ctx.shadowColor = on ? 'rgba(46,230,197,.9)' : 'rgba(255,93,115,.7)';
    ctx.shadowBlur = on ? 10 : 6;
    ctx.lineWidth = 2;
    ctx.globalAlpha = on ? 1 : 0.8;
    ctx.beginPath();
    for (let x = 0; x < W; x++) { const y = mid - ecg[x] * amp; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.restore();
    // erase-bar + head dot
    const hy = mid - ecg[W - 1] * amp;
    ctx.fillStyle = on ? '#2ee6c5' : '#ff5d73';
    ctx.beginPath(); ctx.arc(W - 3, hy, 3, 0, 7); ctx.fill();
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(134,161,166,.9)';
    ctx.fillText('LINK · ESP32', 10, 16);
    if (!on) {
      const a = 0.55 + 0.45 * Math.sin(performance.now() / 380);
      ctx.fillStyle = `rgba(255,93,115,${a.toFixed(2)})`;
      ctx.font = '700 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'right'; ctx.fillText('NO SIGNAL', W - 12, 16); ctx.textAlign = 'left';
    }

    // divider
    ctx.strokeStyle = 'rgba(46,230,197,.18)'; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(0, split + .5); ctx.lineTo(W, split + .5); ctx.stroke(); ctx.setLineDash([]);

    // ---- lane 2: real temperature history ----
    const top = split + 22, bot = H - 14, lo = -1, hi = 14;
    const Y = (t) => bot - ((Math.min(hi, Math.max(lo, t)) - lo) / (hi - lo)) * (bot - top);
    ctx.fillStyle = 'rgba(46,230,197,.07)';
    ctx.fillRect(0, Y(model.tmax), W, Y(model.tmin) - Y(model.tmax));
    ctx.strokeStyle = 'rgba(46,230,197,.35)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    for (const v of [model.tmin, model.tmax]) { ctx.beginPath(); ctx.moveTo(0, Y(v) + .5); ctx.lineTo(W, Y(v) + .5); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(134,161,166,.9)';
    ctx.fillText('TEMP °C · LAST 10 MIN', 10, split + 15);
    ctx.fillStyle = 'rgba(46,230,197,.7)';
    ctx.textAlign = 'right'; ctx.fillText(`SAFE ${model.tmin}–${model.tmax}`, W - 10, split + 15); ctx.textAlign = 'left';

    const now = model.now();
    const pts = model.temps.filter((p) => now - p.ts <= WINDOW);
    if (pts.length < 1) {
      ctx.fillStyle = 'rgba(134,161,166,.75)'; ctx.font = '500 11px "JetBrains Mono", monospace';
      ctx.fillText(on ? 'waiting for first reading…' : 'no recent telemetry', 10, (top + bot) / 2 + 4);
      return;
    }
    const X = (ts) => W - 14 - ((now - ts) / WINDOW) * (W - 28);
    ctx.save();
    ctx.globalAlpha = on ? 1 : 0.45;
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(56,189,248,.8)'; ctx.shadowBlur = on ? 8 : 0;
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.ts), Y(p.temp)) : ctx.moveTo(X(p.ts), Y(p.temp)))); ctx.stroke();
    ctx.restore();
    const lp = pts[pts.length - 1];
    ctx.fillStyle = on ? '#38bdf8' : '#557076';
    ctx.beginPath(); ctx.arc(X(lp.ts), Y(lp.temp), 3.5, 0, 7); ctx.fill();
    if (on) { ctx.strokeStyle = 'rgba(56,189,248,.5)'; ctx.beginPath(); ctx.arc(X(lp.ts), Y(lp.temp), 3.5 + ((performance.now() / 120) % 9), 0, 7); ctx.stroke(); }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    acc += dt * SPEED;
    const n = Math.floor(acc); acc -= n;
    push(n); draw();
  }

  resize();
  addEventListener('resize', resize);
  if ('IntersectionObserver' in window) new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(canvas);
  if (prefersReducedMotion) { for (let i = 0; i < W; i++) push(1); draw(); setInterval(draw, 1000); }
  else raf = requestAnimationFrame(frame);

  return {
    set(partial) { Object.assign(model, partial); },
    stop() { cancelAnimationFrame(raf); }
  };
}
