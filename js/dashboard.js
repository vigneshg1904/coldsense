// ColdSense dashboard — everything shown here comes from the ESP32 via Firebase Realtime Database.
import { startLive, subscribe, state, serverNow, requestReset } from './live.js';
import { runLoader, initFx, tween, flash, glow, toast, setPill, fmtAgo, fmtDur, fmtClock, fmtDateTime, pad, $, ic } from './ui.js';
import { startBackground } from './bg.js';
import { createCharts } from './charts.js';
import { cfgFrom, decisionByName, LEVELS, isOut, DECISIONS } from './model.js';

const pageStart = performance.now();
const RING_C = 578.05;
let cfg = cfgFrom(null);
let records = [];                 // every reading received, sorted by ts
let rangeMs = 1800000;
let evFilter = 'all';
let dataDirty = true;
let pendingReset = 0;
const sysEvents = [];
const shown = { ts: 0, decision: null, evSig: '' };
const seenRows = new Set();
let prevOnline = null, prevUptime = null;

startBackground($('bg'));
initFx();
runLoader(2000);

/* ---------- ring ticks ---------- */
(() => {
  const g = $('ticks'); let h = '';
  for (let i = 0; i < 50; i++) {
    const a = (i / 50) * Math.PI * 2 - Math.PI / 2, major = i % 5 === 0, r0 = 104, r1 = major ? 112 : 108;
    h += `<line class="${major ? 'major' : ''}" x1="${(110 + Math.cos(a) * r0).toFixed(1)}" y1="${(110 + Math.sin(a) * r0).toFixed(1)}" x2="${(110 + Math.cos(a) * r1).toFixed(1)}" y2="${(110 + Math.sin(a) * r1).toFixed(1)}"/>`;
  }
  g.innerHTML = h;
})();

/* ---------- charts ---------- */
const charts = createCharts({ getCfg: () => cfg, isOnline: () => state.online === true });
if (!charts) toast('Charts could not load (vendor/chart.umd.min.js missing).', 'bad', 8000);

/* ---------- data ingestion ---------- */
function addRecord(r) {
  const n = records.length;
  if (!n || r.ts > records[n - 1].ts) records.push(r);
  else {
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (records[m].ts < r.ts) lo = m + 1; else hi = m; }
    if (records[lo] && records[lo].ts === r.ts) return;
    records.splice(lo, 0, r);
  }
  if (records.length > 1500) records.shift();
  dataDirty = true;
  schedule();
}

startLive({ history: 600, onReading: addRecord });

const shipmentStart = () => Number(state.shipment && state.shipment.startedAt) || 0;
function view() { const t0 = shipmentStart(); return t0 ? records.filter((r) => r.ts >= t0) : records; }
function latest() {
  const v = view(), last = v[v.length - 1], lv = state.live, t0 = shipmentStart();
  if (lv && lv.ts >= t0 && (!last || lv.ts >= last.ts)) return lv;
  return last || null;
}

let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(false); }); }

subscribe((s, kind) => {
  if (kind === 'init') return;
  if (kind === 'tick') { watchTransitions(); render(true); return; }
  if (kind === 'device') { watchTransitions(); checkReset(); }
  dataDirty = true; schedule();
});

/* ---------- derived events ---------- */
function deriveEvents(recs) {
  const ev = []; let prev = null;
  const gapLimit = (Math.max(cfg.iLow, 10) * 3 + 20) * 1000;
  const mk = (r, text, tone, icon, alert) => ({ ts: r.ts, temp: r.temp, cond: r.cond, decision: r.decision, text, tone, icon, alert });
  for (const r of recs) {
    const o = isOut(r.temp, cfg);
    if (!prev) {
      ev.push(mk(r, 'Monitoring started', 'info', 'activity', false));
      if (o) ev.push(mk(r, `Temperature outside band at start (${r.temp.toFixed(1)} °C)`, 'bad', 'thermo', true));
    } else {
      const po = isOut(prev.temp, cfg), gap = r.ts - prev.ts;
      if (gap > gapLimit) ev.push(mk(r, `Telemetry gap — no data for ${fmtDur(gap / 1000)}`, 'warn', 'wifi', true));
      if (o && !po) ev.push(mk(r, `Temperature excursion — ${r.temp.toFixed(1)} °C ${r.temp > cfg.tmax ? 'above' : 'below'} the safe band`, 'bad', 'thermo', true));
      if (!o && po) ev.push(mk(r, 'Temperature back inside the safe band', 'good', 'check', false));
      const hit = r.shk !== prev.shk ? r.shk > prev.shk : (r.shock > cfg.shockG && prev.shock <= cfg.shockG);
      if (hit) ev.push(mk(r, `Shock detected — ${r.shock.toFixed(2)} g peak`, 'bad', 'zap', true));
      if (r.level !== prev.level) ev.push(mk(r, `Risk level → ${(LEVELS[r.level] || { label: r.level.toUpperCase() }).label} · sampling every ${r.interval} s`, r.level === 'critical' ? 'bad' : r.level === 'elevated' ? 'warn' : 'info', 'sliders', r.level !== 'low'));
      if (r.decision !== prev.decision) {
        const worse = DECISIONS.findIndex((d) => d.name === r.decision) > DECISIONS.findIndex((d) => d.name === prev.decision);
        ev.push(mk(r, `Decision → ${r.decision}`, worse ? 'bad' : 'info', 'bell', worse));
      }
    }
    prev = r;
  }
  return ev;
}

function renderLog(v) {
  const list = deriveEvents(v).concat(sysEvents.filter((e) => !shipmentStart() || e.ts >= shipmentStart())).sort((a, b) => a.ts - b.ts);
  const rows = (evFilter === 'alert' ? list.filter((e) => e.alert) : list).slice(-60).reverse();
  const sig = evFilter + '|' + rows.length + '|' + (rows[0] ? rows[0].ts + rows[0].text : '');
  if (sig === shown.evSig) return;
  shown.evSig = sig;
  const first = seenRows.size === 0;
  $('log').innerHTML = rows.length ? rows.map((e) => {
    const k = e.ts + e.text, isNew = !first && !seenRows.has(k); seenRows.add(k);
    const d = decisionByName(e.decision);
    const has = Number.isFinite(e.temp);
    return `<tr class="${isNew ? 'new' : ''}"><td class="t">${fmtClock(e.ts)}</td><td><span class="ev ${e.tone}">${ic(e.icon)}${e.text}</span></td><td class="mono">${has ? e.temp.toFixed(1) + ' °C' : '—'}</td><td class="mono">${has ? Math.round(e.cond) + '%' : '—'}</td><td>${has ? `<span class="tag" style="--c:${d.color}">${d.name}</span>` : ''}</td></tr>`;
  }).join('') : `<tr><td colspan="5" class="empty">${state.everSeen ? 'No events in this view — all conditions nominal.' : 'No events yet — waiting for the first reading.'}</td></tr>`;
}

/* ---------- online / offline transitions ---------- */
function watchTransitions() {
  const o = state.online;
  if (o !== null && prevOnline !== null && o !== prevOnline) {
    const ts = serverNow();
    sysEvents.push({ ts, text: o ? 'ESP32 back online' : 'ESP32 went offline — no check-in', tone: o ? 'good' : 'bad', icon: 'wifi', alert: !o });
    toast(o ? 'ESP32 is back online.' : 'ESP32 went offline.', o ? 'good' : 'bad');
    shown.evSig = '';
  }
  if (o !== null) prevOnline = o;
  const up = Number(state.device && state.device.uptime);
  if (Number.isFinite(up)) {
    if (prevUptime !== null && up + 5 < prevUptime) {
      sysEvents.push({ ts: serverNow(), text: 'Device restarted (power cycle or brown-out)', tone: 'warn', icon: 'power', alert: true }); shown.evSig = '';
    }
    prevUptime = up;
  }
}

/* ---------- reset flow ---------- */
function checkReset() {
  if (pendingReset && Number(state.device && state.device.ack) >= pendingReset) {
    pendingReset = 0;
    toast('Device acknowledged — new shipment started, risk reset to 0.', 'good');
    $('resetHint').textContent = 'Resets the cumulative risk to 0 on the device. Use when a fresh package is loaded.';
    $('resetBtn').disabled = false;
  }
}
$('resetBtn').addEventListener('click', () => $('resetDlg').showModal());
$('resetDlg').addEventListener('close', async () => {
  if ($('resetDlg').returnValue !== 'ok') return;
  try {
    pendingReset = await requestReset();
    $('resetBtn').disabled = true;
    $('resetHint').textContent = state.online ? 'Command sent — waiting for the device to acknowledge…' : 'Device is offline — the reset will apply as soon as it reconnects.';
    toast(state.online ? 'Reset command sent to the ESP32.' : 'Reset queued — device is offline.', 'info');
  } catch (e) { toast('Could not send reset: ' + (e.message || e), 'bad'); }
});

/* ---------- range, filter, export ---------- */
$('range').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  rangeMs = +b.dataset.r;
  $('range').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  if (charts) charts.setRange(rangeMs);
  render(true);
});
$('evFilter').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  evFilter = b.dataset.f; shown.evSig = '';
  $('evFilter').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  render(true);
});
$('csvBtn').addEventListener('click', () => {
  const v = view();
  if (!v.length) { toast('Nothing to export yet.', 'info'); return; }
  const head = 'time_iso,temp_c,humidity_pct,shock_g,tilt_deg,risk,safe_life_pct,level,decision,interval_s,cooling';
  const rows = v.map((r) => [new Date(r.ts).toISOString(), r.temp, r.hum, r.shock, r.tilt, r.risk, r.cond, r.level, r.decision, r.interval, r.cooling ? 1 : 0].join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([head + '\n' + rows.join('\n')], { type: 'text/csv' }));
  a.download = `coldsense-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

/* ---------- rendering ---------- */
const set = (id, txt) => { const e = $(id); if (e && e.textContent !== txt) e.textContent = txt; };

function etaText(r, online) {
  if (r.cond <= 40) return 'reached';
  const out = r.temp > cfg.tmax ? r.temp - cfg.tmax : r.temp < cfg.tmin ? cfg.tmin - r.temp : 0;
  if (!online) return '—';
  if (out <= 0) return 'stable';
  const rate = out * cfg.k1 * (1 + cfg.rw * Math.max(0, r.exc - 1));      // risk points per minute at current excursion
  return rate > 0 ? '~' + fmtDur(((r.cond - 40) / rate) * 60) : 'stable';
}

function renderValues(r, v, online) {
  const isNew = r.ts !== shown.ts;
  const d = decisionByName(r.decision);
  const lvl = LEVELS[r.level] || LEVELS.low;
  const out = isOut(r.temp, cfg);
  const life = $('lifeCard');

  life.style.setProperty('--c', d.color);
  life.classList.toggle('crit', d.name === 'HIGH RISK' && online);
  tween($('lifeVal'), r.cond, { dec: 0, dur: 1200 });
  const arc = $('ringArc'); arc.style.strokeDashoffset = RING_C * (1 - Math.max(0, Math.min(100, r.cond)) / 100);
  const sp = $('ringSpark'), ang = (-90 + r.cond * 3.6) * Math.PI / 180;
  sp.setAttribute('cx', (110 + 92 * Math.cos(ang)).toFixed(1)); sp.setAttribute('cy', (110 + 92 * Math.sin(ang)).toFixed(1)); sp.style.opacity = r.cond > 1 ? 1 : 0;
  const lc = $('levelChip'); lc.textContent = lvl.label + ' RISK'; lc.style.setProperty('--c', lvl.color);
  set('decision', d.name); set('advice', d.advice);
  tween($('riskVal'), r.risk, { dec: 1 });
  set('etaVal', etaText(r, online));

  // temperature
  const card = $('cTemp'); card.style.setProperty('--c', out ? 'var(--red)' : 'var(--green)');
  tween($('kTemp'), r.temp, { dec: 1 });
  $('kTemp').style.color = out ? 'var(--red)' : '';
  const ts = $('kTempState'); ts.textContent = out ? (r.temp > cfg.tmax ? 'ABOVE BAND' : 'BELOW BAND') : 'IN BAND';
  const lo = 0, hi = 16, pc = (x) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
  const tb = $('tBar'); tb.style.setProperty('--b0', pc(cfg.tmin) + '%'); tb.style.setProperty('--b1', pc(cfg.tmax) + '%');
  tb.style.setProperty('--m', pc(r.temp) + '%'); tb.querySelector('.mark').style.opacity = 1;
  set('kBand', `safe band ${cfg.tmin}–${cfg.tmax} °C · DHT11 ±2 °C`);

  // humidity
  tween($('kHum'), r.hum, { dec: 0 });
  $('humFill').style.width = Math.max(0, Math.min(100, r.hum)) + '%';

  // handling
  const hit = r.shock > cfg.shockG;
  tween($('kShock'), r.shock, { dec: 2 });
  $('cShock').style.setProperty('--c', hit ? 'var(--red)' : 'var(--amber)');
  const ss = $('kShockState'); ss.textContent = hit ? 'IMPACT' : 'STABLE';
  set('kTilt', `tilt ${Math.round(r.tilt)}°`); set('kShockLimit', `limit ${cfg.shockG} g`);

  // sampling
  tween($('kInt'), r.interval, { dec: 0 });
  const is = $('kIntState'); is.textContent = lvl.label; $('cInt').style.setProperty('--c', lvl.color);
  const tail = v.slice(-120);
  if (tail.length > 3) {
    const avg = tail.reduce((a, x) => a + x.interval, 0) / tail.length;
    set('kSave', `${Math.max(0, Math.round((1 - cfg.iCrit / avg) * 100))}% fewer samples vs fixed ${cfg.iCrit} s`);
  }

  // cooling
  const on = !!r.cooling;
  set('kCool', on ? 'ACTIVE' : 'IDLE');
  $('fanIc').classList.toggle('on', on && online);
  $('cCool').style.setProperty('--c', on ? 'var(--cyan)' : 'var(--dim)');
  const win = rangeMs ? v.filter((x) => x.ts >= serverNow() - rangeMs) : v;
  if (win.length > 1) {
    let tot = 0, onT = 0;
    for (let i = 1; i < win.length; i++) { const dt = Math.min(win[i].ts - win[i - 1].ts, 120000); tot += dt; if (win[i - 1].cooling) onT += dt; }
    set('kDuty', tot ? `duty ${Math.round((onT / tot) * 100)}%` : 'duty --');
  }

  // exposure strip
  tween($('mExc'), r.exc, { dec: 0 });
  set('mOut', fmtDur(r.outS));
  const peak = Number.isFinite(r.peak) ? r.peak : Math.max(...v.map((x) => x.temp));
  tween($('mPeak'), peak, { dec: 1, suffix: ' °C' });
  tween($('mShk'), r.shk, { dec: 0 });

  // chart headers
  set('nTemp', r.temp.toFixed(1) + ' °C'); set('nCond', `${Math.round(r.cond)} % · risk ${r.risk.toFixed(1)}`);
  set('nHum', Math.round(r.hum) + ' %'); set('nInt', r.interval + ' s'); set('nShock', r.shock.toFixed(2) + ' g');

  if (isNew && shown.ts) {                       // animate only on genuinely new readings
    ['cTemp', 'cHum', 'cShock', 'cInt', 'cCool'].forEach((id) => glow($(id)));
    ['kTemp', 'kHum', 'kShock', 'kInt'].forEach((id) => flash($(id), 'val-flash'));
    glow($('lifeCard'));
  }
  if (isNew && shown.decision && shown.decision !== r.decision && Math.abs(serverNow() - r.ts) < 90000 && performance.now() - pageStart > 3500) {
    const worse = DECISIONS.findIndex((x) => x.name === r.decision) > DECISIONS.findIndex((x) => x.name === shown.decision);
    toast(`${r.decision} — safe-life ${Math.round(r.cond)}%`, worse ? 'bad' : 'info', 7000);
  }
  shown.ts = r.ts; shown.decision = r.decision;
}

function clearValues() {
  ['lifeVal', 'kTemp', 'kHum', 'kShock', 'kInt', 'riskVal', 'mExc', 'mPeak', 'mShk'].forEach((id) => { $(id).textContent = '--'; $(id)._v = undefined; });
  ['etaVal', 'mOut', 'kCool', 'kDuty'].forEach((id) => set(id, '--'));
  $('ringArc').style.strokeDashoffset = RING_C; $('ringSpark').style.opacity = 0;
  ['nTemp', 'nCond', 'nHum', 'nInt', 'nShock'].forEach((id) => set(id, ''));
}

function renderStatus(r) {
  const s = state, online = s.online;
  const label = online === true ? 'DEVICE ONLINE' : online === false ? 'DEVICE OFFLINE' : s.cloud === 'error' ? 'CLOUD ERROR' : 'CONNECTING';
  const st = online === true ? 'online' : (online === false || s.cloud === 'error') ? 'offline' : 'connecting';
  setPill($('navPill'), label, st);
  document.body.classList.toggle('is-offline', online === false && s.everSeen);
  document.body.classList.toggle('is-online', online === true);
  set('clock', fmtClock(serverNow()));
  document.title = (online === true ? '● ' : '○ ') + 'ColdSense' + (r ? ` · ${Math.round(r.cond)}%` : ' · Live');

  // banner
  const b = $('banner'); let show = false, title = '', txt = '', cls = '';
  if (s.cloud === 'error') {
    show = true; cls = '';
    title = 'Database connection problem';
    txt = /permission/i.test(s.error.code + s.error.message) ? ' Firebase refused the read. Publish database.rules.json in Realtime Database → Rules.' : ' ' + s.error.message;
  } else if (online === false && s.everSeen) {
    show = true; cls = 'warn';
    title = 'ESP32 is offline';
    txt = ` No check-in for ${fmtDur((s.ageMs || 0) / 1000)}. Values below are the last recorded readings — they are not live.`;
  }
  b.hidden = !show; b.className = 'banner ' + cls; $('bannerTitle').textContent = title; $('bannerTxt').textContent = txt;

  // awaiting card
  const awaiting = s.cloud !== 'error' && s.deviceLoaded && !s.everSeen && !r;
  $('awaiting').hidden = !awaiting;
  set('awDb', s.cloud === 'connected' ? 'connected · no device data yet' : s.cloud === 'error' ? 'error' : 'connecting…');

  // device panel
  const d = s.device || {};
  set('dSeen', s.everSeen ? fmtAgo(s.ageMs) : '--');
  set('dIp', d.ip || '--');
  const up = Number(d.uptime); set('dUp', Number.isFinite(up) ? fmtDur(up + (online ? (s.ageMs || 0) / 1000 : 0)) : '--');
  set('dFw', d.fw ? 'v' + d.fw : '--');
  set('dHeap', Number.isFinite(+d.heap) && d.heap !== undefined ? Math.round(d.heap / 1024) + ' kB' : '--');
  const dc = $('devChip'); dc.textContent = online === true ? 'ONLINE' : online === false ? 'OFFLINE' : '--';
  dc.style.setProperty('--c', online === true ? 'var(--green)' : online === false ? 'var(--red)' : 'var(--mute)');
  for (const [id, key] of [['sDht', 'dht'], ['sMpu', 'mpu'], ['sOled', 'oled']]) {
    const e = $(id); const v = d[key];
    e.className = 'sens' + (v === true ? ' ok' : v === false ? ' bad' : '');
  }
  // wifi
  const rssi = Number(d.rssi);
  if (Number.isFinite(rssi) && d.rssi !== undefined) tween($('kRssi'), rssi, { dec: 0 }); else if (!$('kRssi')._v) set('kRssi', '--');
  const nb = !Number.isFinite(rssi) ? 0 : rssi > -55 ? 4 : rssi > -65 ? 3 : rssi > -75 ? 2 : rssi > -88 ? 1 : 0;
  $('rssiBars').querySelectorAll('i').forEach((i, k) => i.classList.toggle('on', online !== false && k < nb));
  set('kQueue', `queued ${Number(d.queued) || 0}`);
  set('kSync', s.everSeen ? (online ? 'syncing' : 'no signal') : '--');
}

function render(fromTick) {
  cfg = cfgFrom(state.device);
  const v = view();
  const r = latest();
  renderStatus(r);
  const online = state.online === true;
  if (r) {
    if (dataDirty || r.ts !== shown.ts || fromTick) renderValues(r, v, online);
  } else clearValues();

  // shipment panel
  const start = shipmentStart() || (v[0] && v[0].ts) || 0;
  set('shStart', start ? fmtDateTime(start) : '--');
  set('shDur', start ? fmtDur(((r && !online ? r.ts : serverNow()) - start) / 1000) : '--');
  set('shN', String(v.length));

  if (charts && (fromTick || dataDirty)) charts.update(v, serverNow());
  if (charts && fromTick && state.online) charts.redrawHalos();
  if (dataDirty || fromTick) renderLog(v);
  dataDirty = false;
}

render(true);
