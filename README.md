# ColdSense — Cold-Chain Remaining Safe-Life Dashboard

Static site (HTML + CSS + JS modules, **no build step**). Live data only: Firebase Realtime Database ← ESP32.
Chart.js, the Firebase SDK and the fonts are vendored in the repo, so the site has no CDN dependency.

## 1. Firebase (one-time)
1. Console → **Build → Realtime Database** (already created: asia-southeast1).
2. **Rules** tab → paste `database.rules.json` → **Publish**.
3. Nothing else: the web config is already in `js/firebase-config.js`.

## 2. ESP32
1. Open `firmware/coldsense_esp32/coldsense_esp32.ino` in Arduino IDE.
2. Install libraries: DHT sensor library, Adafruit Unified Sensor, Adafruit MPU6050, Adafruit SSD1306, Adafruit GFX.
3. Set `WIFI_SSID` / `WIFI_PASS`, upload. Serial Monitor (115200) shows each sample and sync result.
4. The site flips to **DEVICE ONLINE** within ~8 s of the first heartbeat, and to **OFFLINE** ~26 s after the last one.

## 3. Deploy
Push to GitHub → Vercel redeploys automatically (Framework preset: **Other**, no build command, output = root).

## Database layout (`/coldchain`)
| Node | Written by | Purpose |
|---|---|---|
| `device` | ESP32 every 8 s | `lastSeen` (server time), ip, rssi, uptime, fw, heap, sensor health, model constants `cfg` |
| `live` | ESP32 each sample | newest reading |
| `readings/<epoch-ms>` | ESP32 | history (key = timestamp → retries are idempotent; buffered offline readings are back-filled) |
| `command/resetId` | Dashboard | "Start new shipment" button; device resets risk and answers with `device/ack` + `shipment` |

## Risk model
`excursion = max(T−8, 2−T, 0)`; `risk += excursion·(Δt/60)·0.9·(1+0.25·(repeats−1))`; `risk += max(shock−1.8,0)·1.5`;
`condition = max(0, 100−risk)`. Constants live at the top of the firmware and are reported to the site automatically.

## Hardware notes
- DHT11 is ±2 °C / 1 °C resolution — marginal for a 2–8 °C band. A DS18B20 is the upgrade that matters most.
- Switch Peltiers/fans only through MOSFET modules. A TEC1-12706 draws ~5–6 A at 12 V; four 1800 mAh cells cannot run two for long (and a 4S pack needs a BMS). Use a 12 V ≥10 A supply for the cooling stage; the buck converter should only feed the ESP32 logic (5 V).
- No reed switch / RTC / BME280 in this build: time comes from NTP, door events are not sensed.

## Security (prototype)
Rules allow public read and write under `/coldchain` (the ESP32 writes without login). Anyone with the URL could write fake data. Before a real deployment, add Firebase Auth for the device (REST sign-in) and restrict `.write` to it.
