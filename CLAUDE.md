# Hue Dashboard — Architecture & Design Reference

> For AI assistants and developers working on this codebase.

## Overview

A full-stack Node.js dashboard for Philips Hue Bridge sensors and lights. Polls the bridge at configurable intervals, persists temperature/motion/light readings to SQLite, and serves two web pages: a **Temperature Dashboard** (with Chart.js graphs) and a **Lights Dashboard** (with live control).

**Stack**: Node.js 18+ · Express · better-sqlite3 · Chart.js 4 · Vanilla JS · ES Modules

---

## Directory Layout

```
├── server.js                   # Entry point — Express, polling loop, DB init
├── .env                        # HUE_BRIDGE_IP, HUE_API_TOKEN, ports, paths
├── package.json                # Dependencies: express, better-sqlite3, dotenv
├── data/
│   └── hue-sensors.db          # SQLite database (auto-created)
├── src/
│   ├── config.js               # Loads .env, validates required keys
│   ├── database.js             # SQLite schema, prepared statements, CRUD
│   ├── dataStore.js            # In-memory cache synced with database
│   ├── hueClient.js            # HTTPS client for Hue Bridge REST API
│   └── api/
│       └── routes.js           # GET /api/rooms, lights; PUT /api/lights/:id/state
└── public/                     # Static files served by Express
    ├── index.html              # Temperature page
    ├── lights.html             # Lights page
    ├── css/styles.css          # All styles including dark mode + responsive
    └── js/
        ├── app.js              # Temperature dashboard logic (736 lines)
        ├── lights.js           # Lights dashboard logic (504 lines)
        └── theme.js            # Light/dark toggle (localStorage)
```

---

## Data Flow

### Polling & Storage

```
Hue Bridge  ──HTTPS──▸  hueClient.getRoomData()
                              │
                              ▼
                     dataStore.addReading()
                        │            │
                  in-memory cache   database.insertReading()
                        │                    │
                        ▼                    ▼
                 /api/rooms/:id        SQLite (persists)
```

- **server.js** runs `setInterval` at the configured poll rate (default 10s)
- **hueClient** fetches `/api/<token>/sensors` from the bridge, groups by device MAC
- **dataStore** holds all room data in memory for fast API responses; writes through to SQLite
- On restart, `dataStore.loadFromDatabase()` rebuilds the in-memory cache from disk

### Frontend Rendering

```
Browser  ──fetch──▸  GET /api/rooms          → room list + current values
         ──fetch──▸  GET /api/rooms/:id      → full reading history
                              │
                              ▼
                   getSampledReadings()  → downsample for chart
                              │
                              ▼
                   Chart.js line graph
```

The temperature page polls `/api/rooms` at the user's configured rate (default 10s). When rendering charts, it fetches per-room detail and applies smart sampling to avoid rendering thousands of points.

---

## Backend Architecture

### server.js

Entry point. Initializes database, loads historical data into memory, starts Express on `SERVER_PORT` (default 3000), begins polling. Handles graceful shutdown (SIGINT/SIGTERM).

### src/config.js

Loads `.env` via dotenv. Required: `HUE_BRIDGE_IP`, `HUE_API_TOKEN`. Optional with defaults: `POLL_INTERVAL` (60000ms), `PORT` (3000), `DB_PATH` (`./data/hue-sensors.db`).

### src/hueClient.js

HTTPS client for the Hue Bridge (self-signed cert, so `rejectUnauthorized: false`).

Key methods:
- `getRoomData()` — fetches all sensors, groups by device MAC address, returns array of room objects with temperature (°C), lux, motion state, timestamps
- `getLights()` / `getGroups()` — raw bridge data for light control
- `setLightState(lightId, stateObj)` — PUT to bridge, used by light control modal

**Device grouping**: Sensors share a MAC prefix in their `uniqueid` (`"00:17:88:01:02:...-02-0406"`). Split on `-` to get MAC; same MAC = same physical device (temp + motion + light sensors).

**Temperature**: Bridge returns centi-Celsius (e.g. 2156 → 21.56°C). Converted in hueClient.

**Lux**: `10^((lightlevel - 1) / 10000)` from Hue's proprietary scale.

### src/database.js

SQLite via better-sqlite3 (synchronous, fast). WAL mode enabled.

**Tables**:
- `rooms` — room_id (PK), room_name, timestamps
- `readings` — room_id (FK), timestamp, temperature (°C), lux, motion_detected, last_motion_timestamp. Indexed on (room_id, timestamp).
- `metadata` — key/value store

Uses prepared statements cached on init for performance. Exported as singleton.

### src/dataStore.js

Dual-layer: in-memory Map for fast reads, SQLite for persistence. Each room stores:
```js
{ id, name, readings: [{timestamp, temp, motion}], currentTemp, currentLux, motionDetected, lastMotion, lastUpdate }
```

### src/api/routes.js

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rooms` | GET | All rooms, current values only |
| `/api/rooms/:roomId` | GET | Single room with full reading history |
| `/api/health` | GET | Health check, uptime |
| `/api/stats` | GET | Database statistics |
| `/api/lights` | GET | All lights grouped by room |
| `/api/lights/:id/state` | PUT | Control a light (on, bri, hue, sat, xy, ct, effect, alert, transitiontime) |

The lights endpoint merges `getLights()` with `getGroups()` to associate lights with rooms. Ungrouped lights go into an "Other Lights" bucket.

---

## Frontend Architecture

### Shared: theme.js

IIFE that runs immediately (before DOMContentLoaded) to prevent flash of wrong theme. Reads `hueTheme` from localStorage; sets `data-theme="dark"` on `<body>`. Click handler toggles and persists.

CSS uses `[data-theme="dark"]` selectors throughout `styles.css`.

### Temperature Page: app.js

**State**:
- `charts` — Map of Chart.js instances by roomId
- `roomTimeRanges` — per-room time range override (`'auto'|'30d'|'7d'|'1d'|'1h'`)
- `settings` — pollRate, yAxisMode, yAxisMin/Max, timeRange (persisted to localStorage)

**Smart Sampling** (`getSampledReadings`):
- Auto: detects data age, picks appropriate window and sample rate
- 30d → hourly samples; 7d → 15-min samples; 1d/1h → all data
- Prevents UI lag from rendering thousands of Chart.js points

**Chart.js Configuration**:
- Line chart with motion-aware point styling (green dots for motion detected)
- Smart time labels: time-only for <12h, date+time for 12h–3d, date-only for >3d
- Decimation via LTTB algorithm for >1000 points
- Animation disabled for >360 points
- Y-axis: auto-scaling or manual bounds from settings

**Mobile Canvas Fix**:
Chart.js sets `width`/`height` attributes directly on the canvas, fighting CSS constraints. On mobile (`<=768px`), the canvas element is **replaced with a fresh one** on each render to prevent accumulated width leaks. On desktop, canvas width is calculated at 8px per data point for horizontal scrolling.

**Settings Modal**: Poll rate (1–300s), y-axis mode (auto/manual with bounds). Saved to localStorage. Changes restart the polling interval.

### Lights Page: lights.js

**State**:
- `lightDataMap` — Map of light objects by ID (populated during render)
- `currentLightId` — which light the modal is editing
- `sendTimeout` — 100ms debounce timer for API calls

**Color Conversion** (Philips Hue uses CIE xy color space):
- `xyBriToRgb(x, y, bri)` — CIE xy + brightness → RGB via Wide RGB D65 matrix + sRGB gamma
- `rgbToXy(r, g, b)` — inverse for color picker → bridge
- `ctToRgb(ct)` — mireds → RGB via Tanner Helland algorithm
- `hueSatToCss(hue, sat, bri)` — Hue (0–65535) + Sat (0–254) → CSS hsl()

**Light Control Modal**:
- Opens on light item click (skips unreachable lights)
- Shows controls based on light type:
  - Extended color light → power, brightness, color picker, CT slider
  - Color temperature light → power, brightness, CT slider
  - Dimmable light → power, brightness
  - On/Off plug → power only
- Changes sent live via debounced PUT (100ms) — no save button
- Preview swatch shows computed color with glow effect
- Controls grayed out when light is off

**Color Temperature**: Hue uses mireds (1,000,000 / Kelvin). Slider range: 153–500 mireds (6500K–2000K). Label shows approximate Kelvin.

---

## CSS Architecture

### Layout
- **Header**: Flexbox with `justify-content: space-between`. On mobile, `flex-wrap: wrap` with `order` to put title + action buttons on row 1, nav on row 2.
- **Room grid**: CSS Grid with `auto-fit, minmax(350px, 1fr)`. Single column on mobile.
- **Modals**: Fixed overlay with `backdrop-filter: blur(4px)`, centered content with slide-up animation.

### Dark Mode
All dark styles use `[data-theme="dark"]` prefix selectors. Key colors:
- Background: `linear-gradient(135deg, #1a1a2e, #16213e)`
- Cards: `rgba(30, 30, 50, 0.95)`
- Accent: `#8b9cf7` (lighter purple for contrast)
- Text: `#e0e0e0`

### Responsive (≤768px)
- Header padding reduced to 1rem
- Header wraps: title + buttons on row 1, nav centered on row 2
- Buttons shrink to 36px
- Time range buttons: smaller font, less padding
- Room cards: single column, full width
- Charts: `overflow-x: hidden`, canvas forced to 100% width
- Modals: 95% width, stacked buttons

---

## Key Design Decisions

1. **In-memory + SQLite dual storage**: Fast API responses from memory; data survives restarts via SQLite reload. Trade-off: memory usage grows with history.

2. **Smart sampling over pagination**: Rather than paginating readings, the frontend samples intelligently (hourly/15min/all) based on the time window. This keeps chart rendering fast without requiring server-side aggregation.

3. **Canvas replacement on mobile**: Chart.js aggressively manages canvas `width`/`height` attributes, overriding CSS. The only reliable fix was replacing the DOM element entirely on each mobile render.

4. **Live light control (no save button)**: Brightness/color changes are sent immediately via debounced PUT calls (100ms). This matches the Hue app's behavior and feels more responsive.

5. **Per-room time ranges**: Each room card independently tracks its time range selection. A global default applies to rooms that haven't been manually changed.

6. **CIE xy color space**: Hue uses CIE 1931 xy coordinates for color. The dashboard converts between xy↔RGB for the color picker and preview, using the Wide RGB D65 conversion matrix recommended by Philips.

7. **Self-signed cert handling**: The Hue Bridge uses a self-signed HTTPS certificate. `rejectUnauthorized: false` is set in hueClient — this is expected and necessary.

8. **ES Modules throughout**: `"type": "module"` in package.json. All imports use `import`/`export` syntax.

9. **No build step**: Vanilla JS served directly. Chart.js loaded from CDN. This keeps the project simple and avoids toolchain dependencies.

10. **Temperature in Fahrenheit**: Bridge returns Celsius; all display is Fahrenheit. Conversion happens in the frontend (`celsiusToFahrenheit`). Database stores Celsius.

---

## Unit Conversions Reference

| Source | Value | Conversion | Result |
|--------|-------|-----------|--------|
| Hue sensor | 2156 (centi-°C) | ÷ 100 | 21.56°C |
| Database | 21.56°C | × 9/5 + 32 | 70.8°F |
| Hue lightlevel | 25000 | 10^((v-1)/10000) | 630 lux |
| Hue color temp | 300 mireds | 1000000 / 300 | 3333K |
| Hue hue | 25500 (0–65535) | × 360/65535 | 140° |
| Hue brightness | 200 (1–254) | × 100/254 | 79% |

---

## Running

```bash
# Install dependencies
npm install

# Configure (copy .env.example or create .env)
# Required: HUE_BRIDGE_IP, HUE_API_TOKEN

# Start server
npm start          # Production
npm run dev        # Development (auto-restart on changes)

# Visit
# Temperature: http://localhost:3000/
# Lights:      http://localhost:3000/lights.html
```
