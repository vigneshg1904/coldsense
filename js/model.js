// Shared constants for the decision engine (mirrors the logic that runs on the ESP32).

export const DECISIONS = [
  { name: 'CONTINUE',            min: 90, color: '#34d399', advice: 'Conditions nominal. Continue transport as planned.' },
  { name: 'MONITOR',             min: 75, color: '#38bdf8', advice: 'Minor exposure recorded. Keep monitoring the shipment.' },
  { name: 'PRIORITIZE DELIVERY', min: 60, color: '#fbbf24', advice: 'Safe-life is shrinking. Expedite delivery of this package.' },
  { name: 'INSPECTION REQUIRED', min: 40, color: '#fb923c', advice: 'Significant exposure. Inspect the package before release.' },
  { name: 'HIGH RISK',           min: 0,  color: '#ff5d73', advice: 'Safe-life critically low. Quarantine and verify package integrity.' }
];

export const LEVELS = {
  low:      { label: 'LOW',      color: '#34d399' },
  elevated: { label: 'ELEVATED', color: '#fbbf24' },
  critical: { label: 'CRITICAL', color: '#ff5d73' }
};

// Used until the ESP32 reports its own configuration in device/cfg.
export const DEFAULT_CFG = { tmin: 2, tmax: 8, shockG: 1.8, k1: 0.9, k2: 1.5, rw: 0.25, iLow: 20, iElev: 10, iCrit: 3 };

export const decisionFor = (cond) => DECISIONS.find((d) => cond >= d.min) || DECISIONS[DECISIONS.length - 1];
export const decisionByName = (n) => DECISIONS.find((d) => d.name === n) || DECISIONS[0];

export function cfgFrom(device) {
  const c = (device && device.cfg) || {};
  const out = { ...DEFAULT_CFG };
  for (const k of Object.keys(out)) if (Number.isFinite(+c[k]) && c[k] !== null) out[k] = +c[k];
  return out;
}

export const isOut = (t, cfg) => t > cfg.tmax || t < cfg.tmin;
