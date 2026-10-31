// Realtime data layer: Firebase Realtime Database listeners + derived ONLINE/OFFLINE state.
// Used by both the landing page and the dashboard. There is no simulated data anywhere.
import { initializeApp, getDatabase, ref, onValue, onChildAdded, query, limitToLast, update } from './vendor/firebase-rtdb.js';
import { firebaseConfig, ROOT } from './firebase-config.js';

export const state = {
  cloud: 'connecting',      // connecting | connected | error
  error: null,              // { code, message } when cloud === 'error'
  deviceLoaded: false,
  device: null,             // coldchain/device
  live: null,               // coldchain/live (latest reading, normalised)
  shipment: null,           // coldchain/shipment
  offset: 0,                // server clock offset (ms)
  online: null,             // true | false | null (unknown while the browser itself is not connected)
  ageMs: null,              // ms since the ESP32 last checked in
  everSeen: false
};

const subs = new Set();
let db = null;
let started = false;

export const serverNow = () => Date.now() + state.offset;
export function subscribe(fn) { subs.add(fn); fn(state, 'init'); return () => subs.delete(fn); }
const emit = (kind) => subs.forEach((f) => { try { f(state, kind); } catch (e) { console.error(e); } });

const num = (x, d = 0) => (x !== null && x !== undefined && x !== '' && Number.isFinite(+x) ? +x : d);

export function normalize(v) {
  if (!v || typeof v !== 'object') return null;
  const r = {
    ts: num(v.ts, 0), temp: num(v.temp, NaN), hum: num(v.hum, NaN), shock: num(v.shock, 1), tilt: num(v.tilt, 0),
    risk: num(v.risk, 0), cond: num(v.cond, 100), level: String(v.level || 'low'), decision: String(v.decision || 'CONTINUE'),
    interval: num(v.interval, 20), cooling: !!v.cooling, exc: num(v.exc, 0), shk: num(v.shk, 0), outS: num(v.outS, 0), peak: num(v.peak, NaN)
  };
  return r.ts > 0 && Number.isFinite(r.temp) ? r : null;
}

function threshold() {
  const hb = num(state.device && state.device.hb, 8000);
  return Math.max(20000, hb * 3 + 2000);
}

function evaluate() {
  const ls = num(state.device && state.device.lastSeen, 0);
  let online = null, age = null;
  if (ls) age = Math.max(0, serverNow() - ls);
  if (state.cloud !== 'connected' || !state.deviceLoaded) online = null;
  else if (!ls) online = false;
  else online = age <= threshold();
  state.ageMs = age;
  state.online = online;
  if (ls) state.everSeen = true;
}

export function startLive({ history = 600, onReading } = {}) {
  if (started) return;
  started = true;
  try {
    db = getDatabase(initializeApp(firebaseConfig));
  } catch (e) {
    state.cloud = 'error'; state.error = { code: 'init', message: String(e.message || e) }; emit('cloud'); return;
  }
  const fail = (e) => {
    state.cloud = 'error'; state.error = { code: e && e.code || 'error', message: String(e && e.message || e) };
    evaluate(); emit('cloud');
  };

  onValue(ref(db, '.info/connected'), (s) => {
    if (s.val() === true) { state.cloud = 'connected'; state.error = null; }
    else if (state.cloud !== 'error') state.cloud = 'connecting';
    evaluate(); emit('cloud');
  });
  onValue(ref(db, '.info/serverTimeOffset'), (s) => { state.offset = num(s.val(), 0); });

  onValue(ref(db, `${ROOT}/device`), (s) => {
    state.device = s.val(); state.deviceLoaded = true; state.error = null;
    if (state.cloud === 'error') state.cloud = 'connected';
    evaluate(); emit('device');
  }, fail);
  onValue(ref(db, `${ROOT}/live`), (s) => { state.live = normalize(s.val()); emit('live'); }, fail);
  onValue(ref(db, `${ROOT}/shipment`), (s) => { state.shipment = s.val(); emit('shipment'); }, fail);

  if (onReading) {
    const seen = new Set();
    onChildAdded(query(ref(db, `${ROOT}/readings`), limitToLast(history)), (s) => {
      if (seen.has(s.key)) return;
      seen.add(s.key);
      const r = normalize(s.val());
      if (r) onReading(r);
    }, fail);
  }

  // Re-evaluate once a second so the UI flips to OFFLINE even when no database event arrives.
  setInterval(() => { evaluate(); emit('tick'); }, 1000);
}

// Ask the ESP32 to start a new shipment (resets cumulative risk). The device acknowledges via device/ack.
export async function requestReset() {
  if (!db) throw new Error('Database not ready');
  const id = serverNow();
  await update(ref(db, ROOT), { 'command/resetId': id, 'command/requestedAt': id });
  return id;
}
