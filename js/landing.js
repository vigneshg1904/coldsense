import { startLive, subscribe, serverNow } from './live.js';
import { runLoader, initFx, countUps, tween, setPill, fmtAgo, flash, $ } from './ui.js';
import { startBackground } from './bg.js';
import { createMonitor } from './monitor.js';
import { decisionByName, cfgFrom } from './model.js';

startBackground($('bg'));
initFx();
countUps();
runLoader(2400);

/* ---------- live hero monitor (real ESP32 data only) ---------- */
const mon = createMonitor($('monCanvas'));
const temps = [];
let cfg = cfgFrom(null);

startLive({
  history: 120,
  onReading: (r) => {
    temps.push({ ts: r.ts, temp: r.temp });
    temps.sort((a, b) => a.ts - b.ts);
    if (temps.length > 120) temps.shift();
    mon.set({ temps: temps.slice() });
  }
});

// tilt the monitor card slightly toward the cursor
const card = $('monitor');
if (card && matchMedia('(hover:hover)').matches) {
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    card.style.transform = `perspective(1000px) rotateY(${x * 5}deg) rotateX(${-y * 5}deg)`;
  });
  card.addEventListener('pointerleave', () => { card.style.transform = ''; });
}

subscribe((s, kind) => {
  cfg = cfgFrom(s.device);
  const label = s.online === true ? 'DEVICE ONLINE' : s.online === false ? 'DEVICE OFFLINE' : (s.cloud === 'error' ? 'CLOUD ERROR' : 'CONNECTING');
  const st = s.online === true ? 'online' : s.online === false ? 'offline' : s.cloud === 'error' ? 'offline' : 'connecting';
  setPill($('navPill'), label, st);
  setPill($('heroPill'), label, st);
  mon.set({ online: s.online === true, tmin: cfg.tmin, tmax: cfg.tmax, now: serverNow });
  card.dataset.state = st;

  const r = s.live;
  const on = s.online === true;
  const dim = !r;
  if (kind !== 'tick') {
    if (r) {
      tween($('mTemp'), r.temp, { dec: 1 }); tween($('mHum'), r.hum, { dec: 0 }); tween($('mLife'), r.cond, { dec: 0 });
      const d = decisionByName(r.decision);
      const chip = $('mDecision'); chip.textContent = d.name; chip.style.setProperty('--c', d.color);
      card.style.setProperty('--c', d.color);
      if (kind === 'live') flash($('mTemp').parentElement, 'val-flash');
      positionMarker(r.cond, d.color);
    } else if (dim) {
      ['mTemp', 'mHum', 'mLife'].forEach((id) => { $(id).textContent = '--'; $(id)._v = undefined; });
    }
  }
  let seen;
  if (s.cloud === 'error') seen = 'database unreachable';
  else if (s.online === null) seen = 'linking to cloud…';
  else if (!s.everSeen) seen = 'no device has checked in yet';
  else seen = (on ? 'last packet ' : 'last seen ') + fmtAgo(s.ageMs);
  $('mSeen').textContent = seen;
  $('ctaStatus').textContent = s.online === true ? `● ESP32 online — ${seen}` : s.online === false ? `○ ESP32 offline — ${seen}` : seen;
});

/* decision-scale marker follows the real condition value */
function positionMarker(cond) {
  const m = $('scaleMarker'); if (!m) return;
  const bar = m.parentElement.querySelector('.scale-bar');
  const w = bar.getBoundingClientRect().width;
  m.hidden = false;
  m.style.left = (cond / 100) * w + 'px';
  $('scaleMarkerTxt').textContent = Math.round(cond) + '% now';
}
addEventListener('resize', () => { const l = document.getElementById('mLife'); if (l && Number.isFinite(l._v)) positionMarker(l._v); });
