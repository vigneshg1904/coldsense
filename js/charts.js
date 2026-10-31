// Chart.js wrappers for the dashboard. All charts share one linear time axis (epoch ms) so offline gaps stay visible.
import { DECISIONS, isOut } from './model.js';
import { pad } from './ui.js';

const COL = { teal: '#2ee6c5', cyan: '#38bdf8', amber: '#ffb020', red: '#ff5d73', green: '#34d399', violet: '#a78bfa', grid: 'rgba(255,255,255,.055)', txt: '#86a1a6' };

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const gradient = (hex, a0 = 0.32) => (c) => {
  const { chart } = c; const area = chart.chartArea;
  if (!area) return 'transparent';
  const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, rgba(hex, a0)); g.addColorStop(1, rgba(hex, 0));
  return g;
};

export function createCharts({ getCfg, isOnline }) {
  const Chart = window.Chart;
  if (!Chart) return null;
  Chart.defaults.color = COL.txt;
  Chart.defaults.font.family = "'JetBrains Mono', ui-monospace, monospace";
  Chart.defaults.font.size = 11;

  let rangeMs = 1800000;
  let firstDraw = true, animateNext = false;

  const tick = (v) => {
    const d = new Date(v);
    return rangeMs && rangeMs <= 300000 ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const gapMs = () => { const c = getCfg(); return (Math.max(c.iLow, 10) * 3 + 20) * 1000; };

  const base = (extra = {}, yExtra = {}) => ({
    responsive: true, maintainAspectRatio: false, parsing: false, normalized: true,
    animation: { duration: 1100, easing: 'easeOutQuart' },
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    layout: { padding: { top: 8, right: 8 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(5,14,18,.96)', borderColor: 'rgba(46,230,197,.3)', borderWidth: 1, padding: 11, cornerRadius: 10,
        titleFont: { weight: '600' }, displayColors: false,
        callbacks: { title: (it) => new Date(it[0].parsed.x).toLocaleTimeString(), ...(extra.tooltip || {}) }
      }
    },
    scales: {
      x: { type: 'linear', border: { display: false }, grid: { color: 'rgba(255,255,255,.035)' }, ticks: { maxTicksLimit: 6, maxRotation: 0, callback: tick } },
      y: { border: { display: false }, grid: { color: COL.grid }, ticks: { maxTicksLimit: 6 }, ...yExtra },
      ...(extra.scales || {})
    }
  });

  /* plugins */
  const bandPlugin = {
    id: 'band',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: a, scales: { y } } = chart; if (!a) return;
      const c = getCfg();
      const y0 = Math.max(a.top, y.getPixelForValue(c.tmax)), y1 = Math.min(a.bottom, y.getPixelForValue(c.tmin));
      if (y1 <= y0) return;
      ctx.save();
      ctx.fillStyle = 'rgba(52,211,153,.075)'; ctx.fillRect(a.left, y0, a.right - a.left, y1 - y0);
      ctx.strokeStyle = 'rgba(52,211,153,.4)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1;
      for (const yy of [y0, y1]) { ctx.beginPath(); ctx.moveTo(a.left, yy); ctx.lineTo(a.right, yy); ctx.stroke(); }
      ctx.setLineDash([]); ctx.fillStyle = 'rgba(52,211,153,.75)'; ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(`SAFE ${c.tmin}–${c.tmax} °C`, a.left + 8, y0 + 14);
      ctx.restore();
    }
  };
  const zonesPlugin = {
    id: 'zones',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: a, scales: { y } } = chart; if (!a) return;
      ctx.save();
      DECISIONS.forEach((d, i) => {
        const hi = i === 0 ? 100 : DECISIONS[i - 1].min;
        const yt = y.getPixelForValue(hi), yb = y.getPixelForValue(d.min);
        ctx.fillStyle = rgba(d.color, 0.055); ctx.fillRect(a.left, yt, a.right - a.left, yb - yt);
        if (d.min > 0) { ctx.strokeStyle = rgba(d.color, 0.28); ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(a.left, yb); ctx.lineTo(a.right, yb); ctx.stroke(); ctx.setLineDash([]); }
      });
      ctx.restore();
    }
  };
  const haloPlugin = {
    id: 'halo',
    afterDatasetsDraw(chart) {
      const ds = chart.data.datasets[0]; const meta = chart.getDatasetMeta(0);
      if (!ds || !ds.data.length || !meta.data.length) return;
      const p = meta.data[meta.data.length - 1]; if (!p || p.skip) return;
      const { ctx, chartArea: a } = chart; if (p.x < a.left || p.x > a.right) return;
      const live = isOnline();
      ctx.save();
      ctx.fillStyle = live ? ds.borderColor : '#5a747a';
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.fill();
      if (live) { ctx.strokeStyle = rgba(typeof ds.borderColor === 'string' && ds.borderColor[0] === '#' ? ds.borderColor : COL.teal, 0.5); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 4 + ((Date.now() / 90) % 10), 0, 7); ctx.stroke(); }
      ctx.restore();
    }
  };

  const mk = (id, config) => new Chart(document.getElementById(id), config);
  const line = (label, color, extra = {}) => ({
    label, data: [], borderColor: color, borderWidth: 2.2, tension: 0.3, cubicInterpolationMode: 'monotone',
    pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: color, fill: true, backgroundColor: gradient(color), ...extra
  });

  /* 1 — temperature */
  const chTemp = mk('chTemp', {
    type: 'line', plugins: [bandPlugin, haloPlugin],
    data: { datasets: [line('Temperature', COL.teal, {
      segment: {
        borderColor: (c) => (isOut(c.p1.parsed.y, getCfg()) ? COL.red : COL.teal),
        borderDash: (c) => ((c.p1.parsed.x - c.p0.parsed.x) > gapMs() ? [4, 5] : undefined)
      }
    })] },
    options: base({ tooltip: { label: (c) => ` ${c.parsed.y.toFixed(1)} °C` } }, { title: { display: false } })
  });

  /* 2 — condition & risk */
  const chCond = mk('chCond', {
    type: 'line', plugins: [zonesPlugin, haloPlugin],
    data: { datasets: [
      line('Safe-life %', COL.green, { yAxisID: 'y', tension: 0.15, cubicInterpolationMode: 'default' }),
      line('Risk', COL.amber, { yAxisID: 'y1', fill: false, borderDash: [6, 4], borderWidth: 1.8, tension: 0.15, cubicInterpolationMode: 'default' })
    ] },
    options: base({
      tooltip: { label: (c) => (c.datasetIndex === 0 ? ` safe-life ${c.parsed.y.toFixed(1)} %` : ` risk ${c.parsed.y.toFixed(2)}`) },
      scales: { y1: { position: 'right', min: 0, suggestedMax: 8, border: { display: false }, grid: { drawOnChartArea: false }, ticks: { maxTicksLimit: 5, color: 'rgba(255,176,32,.8)' } } }
    }, { min: 0, max: 100, ticks: { stepSize: 25 } })
  });
  chCond.options.interaction = { mode: 'nearest', axis: 'x', intersect: false };

  /* 3 — humidity */
  const chHum = mk('chHum', {
    type: 'line', plugins: [haloPlugin],
    data: { datasets: [line('Humidity', COL.cyan)] },
    options: base({ tooltip: { label: (c) => ` ${c.parsed.y.toFixed(0)} %` } }, { grace: '12%' })
  });

  /* 4 — adaptive sampling interval */
  const chInt = mk('chInt', {
    type: 'line', plugins: [haloPlugin],
    data: { datasets: [line('Interval', COL.violet, { stepped: 'before', tension: 0, cubicInterpolationMode: 'default',
      segment: { borderColor: (c) => { const v = c.p0.parsed.y, cf = getCfg(); return v <= cf.iCrit ? COL.red : v <= cf.iElev ? COL.amber : COL.violet; } } })] },
    options: base({ tooltip: { label: (c) => ` every ${c.parsed.y} s` } }, { min: 0 })
  });

  /* 5 — shock */
  const chShock = mk('chShock', {
    type: 'bar',
    data: { datasets: [
      { type: 'bar', label: 'Peak g', data: [], backgroundColor: [], borderRadius: 3, barThickness: 2, order: 2 },
      { type: 'line', label: 'Limit', data: [], borderColor: 'rgba(255,93,115,.7)', borderDash: [5, 5], borderWidth: 1.4, pointRadius: 0, fill: false, order: 1 }
    ] },
    options: base({ tooltip: { label: (c) => (c.datasetIndex === 0 ? ` ${c.parsed.y.toFixed(2)} g` : ` limit ${c.parsed.y} g`) } }, { min: 0, suggestedMax: 3, ticks: { maxTicksLimit: 5 } })
  });

  const all = [chTemp, chCond, chHum, chInt, chShock];

  return {
    setRange(ms) { rangeMs = ms; animateNext = true; },
    redrawHalos() { all.forEach((c) => { if (c.chartArea) c.draw(); }); },
    update(records, now) {
      const cfg = getCfg();
      let t0, t1 = now;
      if (rangeMs) t0 = now - rangeMs;
      else t0 = records.length ? records[0].ts - Math.max(10000, (now - records[0].ts) * 0.02) : now - 600000;
      // keep one point before the window so lines enter from the left edge
      let i0 = 0; while (i0 < records.length && records[i0].ts < t0) i0++;
      const vis = records.slice(Math.max(0, i0 - 1));
      const dots = vis.length < 90 ? 2.6 : 0;

      const xy = (f) => vis.map((r) => ({ x: r.ts, y: f(r) }));
      const setX = (c) => { c.options.scales.x.min = t0; c.options.scales.x.max = t1; };

      // temperature
      chTemp.data.datasets[0].data = xy((r) => r.temp);
      chTemp.data.datasets[0].pointRadius = dots;
      const temps = vis.map((r) => r.temp);
      chTemp.options.scales.y.min = Math.floor(Math.min(cfg.tmin - 2, ...(temps.length ? [Math.min(...temps) - 1] : [99])));
      chTemp.options.scales.y.max = Math.ceil(Math.max(cfg.tmax + 2, ...(temps.length ? [Math.max(...temps) + 1] : [-99])));
      // condition / risk
      chCond.data.datasets[0].data = xy((r) => r.cond);
      chCond.data.datasets[1].data = xy((r) => r.risk);
      chCond.data.datasets[0].pointRadius = dots;
      // humidity
      chHum.data.datasets[0].data = xy((r) => r.hum);
      chHum.data.datasets[0].pointRadius = dots;
      // interval
      chInt.data.datasets[0].data = xy((r) => r.interval);
      chInt.options.scales.y.max = Math.max(cfg.iLow * 1.3, 10);
      // shock
      chShock.data.datasets[0].data = xy((r) => r.shock);
      chShock.data.datasets[0].backgroundColor = vis.map((r) => (r.shock > cfg.shockG ? COL.red : rgba(COL.cyan, 0.55)));
      chShock.data.datasets[1].data = [{ x: t0, y: cfg.shockG }, { x: t1, y: cfg.shockG }];
      chShock.options.scales.y.suggestedMax = Math.max(3, cfg.shockG * 1.5);

      all.forEach(setX);
      const mode = (firstDraw || animateNext) ? undefined : 'none';
      all.forEach((c) => c.update(mode));
      if (records.length) { firstDraw = false; animateNext = false; }
    }
  };
}
