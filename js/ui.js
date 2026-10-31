// Shared UI helpers: boot loader, tweened numbers, toasts, reveal-on-scroll, ripples, page transitions.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const prefersReducedMotion = reduced;
export const $ = (id) => document.getElementById(id);
export const ic = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="assets/icons.svg#i-${name}"/></svg>`;

/* ---------- Boot loader (runs on every open and refresh) ---------- */
export function runLoader(minMs = 2300) {
  const el = $('loader');
  const pct = $('ldPct');
  return new Promise((resolve) => {
    if (!el) { document.body.classList.add('ready'); document.body.classList.remove('loading'); return resolve(); }
    const t0 = performance.now();
    const dur = reduced ? 400 : minMs;
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      if (pct) pct.textContent = String(Math.round(100 * (1 - Math.pow(1 - p, 2.2))));
      if (p < 1) raf = requestAnimationFrame(tick);
      else finish();
    };
    const finish = () => {
      cancelAnimationFrame(raf);
      el.classList.add('is-exit');
      document.body.classList.add('ready');
      document.body.classList.remove('loading');
      setTimeout(() => { el.remove(); resolve(); }, reduced ? 50 : 950);
    };
    raf = requestAnimationFrame(tick);
  });
}

/* ---------- Tweened numbers ---------- */
export function tween(el, to, { dec = 0, dur = 750, suffix = '' } = {}) {
  if (!el) return;
  if (!Number.isFinite(to)) { el.textContent = '--'; el._v = undefined; return; }
  const from = Number.isFinite(el._v) ? el._v : to;
  el._v = to;
  cancelAnimationFrame(el._raf);
  if (reduced || from === to) { el.textContent = to.toFixed(dec) + suffix; return; }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = (from + (to - from) * e).toFixed(dec) + suffix;
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

export function flash(el, cls = 'flash') {
  if (!el) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
}

/* outline glow that works even on elements that already carry a CSS animation */
export function glow(el, color = 'var(--c)') {
  if (!el || reduced || !el.animate) return;
  el.animate([{ boxShadow: `0 0 0 1px ${color}, 0 0 34px -4px ${color}` }, { boxShadow: '0 0 0 0 transparent, 0 0 0 0 transparent' }], { duration: 1000, easing: 'ease-out' });
}

/* ---------- Toasts ---------- */
export function toast(msg, type = 'info', ms = 5000) {
  let host = $('toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `${ic(type === 'bad' ? 'alert' : type === 'good' ? 'check' : 'bell')}<span></span>`;
  t.lastChild.textContent = msg;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, ms);
}

/* ---------- Formatting ---------- */
export const pad = (n) => String(n).padStart(2, '0');
export const fmtClock = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
export const fmtDateTime = (ms) => new Date(ms).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
export function fmtAgo(ms) {
  if (!Number.isFinite(ms)) return '--';
  const s = Math.round(ms / 1000);
  if (s < 2) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(s % 60)}s ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${pad(m % 60)}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}
export function fmtDur(sec) {
  if (!Number.isFinite(sec)) return '--';
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${pad(sec % 60)}s`;
  const h = Math.floor(sec / 3600);
  if (h < 48) return `${h}h ${pad(Math.floor((sec % 3600) / 60))}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/* ---------- Connection pill ---------- */
export function setPill(el, label, state) {
  if (!el) return;
  if (el.dataset.state !== state) { el.dataset.state = state; flash(el, 'pop'); }
  const t = el.querySelector('.pill-txt');
  if (t && t.textContent !== label) t.textContent = label;
}

/* ---------- Scroll reveal, spotlight, ripple, transitions ---------- */
export function initFx() {
  // reveal on scroll
  const items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduced) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach((i) => io.observe(i));
  } else items.forEach((i) => i.classList.add('in'));

  // cursor spotlight on cards
  document.addEventListener('pointermove', (e) => {
    const c = e.target.closest && e.target.closest('.card');
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  // click ripple on buttons
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('.btn, .tab, .seg button');
    if (!b) return;
    const r = b.getBoundingClientRect();
    const s = document.createElement('span');
    s.className = 'ripple';
    const d = Math.max(r.width, r.height) * 2;
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    b.appendChild(s);
    setTimeout(() => s.remove(), 650);
  });

  // page-to-page wipe
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-nav]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    e.preventDefault();
    document.body.classList.add('leaving');
    setTimeout(() => { location.href = a.href; }, reduced ? 0 : 420);
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) document.body.classList.remove('leaving'); });

  // sticky nav shadow
  const nav = document.querySelector('.nav');
  if (nav) {
    const f = () => nav.classList.toggle('scrolled', scrollY > 8);
    addEventListener('scroll', f, { passive: true }); f();
  }
}

/* count-up for static stats when they scroll into view */
export function countUps() {
  const els = document.querySelectorAll('[data-count]');
  const run = (el) => tween(el, +el.dataset.count, { dec: +(el.dataset.dec || 0), dur: 1400 });
  if (!('IntersectionObserver' in window)) { els.forEach(run); return; }
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }), { threshold: 0.6 });
  els.forEach((el) => { el._v = 0; el.textContent = '0'; io.observe(el); });
}
