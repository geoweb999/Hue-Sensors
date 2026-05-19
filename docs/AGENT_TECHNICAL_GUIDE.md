# Agent Technical Guide

This document is a technical handoff for coding agents working in this repository.

## 1. Project Summary

This is a Node.js + Express Hue dashboard with three primary UI surfaces:
- Temperature dashboard (`/`, `public/index.html`)
- Lights dashboard (`/lights.html`)
- Room detail dashboard (`/room.html?id=<groupId>`)

The backend integrates Hue v1 + v2 APIs, persists historical sensor readings in SQLite, and provides API routes used by the frontend.

## 2. Runtime Architecture

### Server entrypoint
- File: `server.js`
- Responsibilities:
1. Load config and initialize DB
2. Restore historical data into in-memory store
3. Start Express API/static server
4. Start poll loop (`pollHueBridge`) for temperature/lux/motion history
5. Start accessory snapshot refresher (`accessorySnapshotService.start(...)`)
6. Start optional Hue v2 SSE event stream (`hueEventStream.js`)

### Core services
- `src/hueClient.js`
  - Bridge HTTP client.
  - v1 requests (`/api/<token>/...`) now use protocol fallback: `https:443 -> http:80`.
  - v2 requests (`/clip/v2/resource/...`) use HTTPS with `hue-application-key`.
- `src/accessorySnapshotService.js`
  - Builds per-room accessory snapshots for room detail pages.
  - Uses `Promise.allSettled(...)` so one endpoint failure does not kill the whole refresh.
  - Returns `devices`, `stale`, `lastUpdated`, `lastError`.
- `src/dataStore.js`
  - In-memory cache of room sensor history used by temperature endpoints.
  - Writes each poll to DB.
- `src/database.js`
  - SQLite wrapper (better-sqlite3), schema setup, prepared statements.
- `src/logger.js`
  - Structured JSON logger, key redaction for sensitive fields.
- `src/hueEventStream.js`
  - Optional Hue event stream consumer for real-time bridge events.

## 3. Data Storage

### SQLite schema
Defined in `src/database.js`.

- `rooms`
  - `room_id` TEXT PK
  - `room_name` TEXT
  - `created_at`, `updated_at` INTEGER
- `readings`
  - `id` INTEGER PK AUTOINCREMENT
  - `room_id` TEXT FK -> rooms
  - `timestamp` INTEGER (epoch ms)
  - `temperature` REAL (Celsius in storage path from poll)
  - `lux` INTEGER nullable
  - `motion_detected` INTEGER (0/1)
  - `last_motion_timestamp` TEXT nullable
- `metadata`
  - key/value pairs (`schema_version` currently `1.0`)

DB defaults:
- WAL enabled (`journal_mode = WAL`)
- `synchronous = NORMAL`

## 4. API Surface (Backend)

All routes are in `src/api/routes.js` and mounted under `/api`.

### Temperature/history
- `GET /api/rooms`
- `GET /api/rooms/:roomId`
- `GET /api/health`
- `GET /api/stats`

### Lights and room detail
- `GET /api/lights`
- `GET /api/rooms/:groupId/detail`
- `PUT /api/lights/:id/state`
- `PUT /api/rooms/:groupId/state`
- `PUT /api/rooms/:groupId/scene`
- `POST /api/rooms/:groupId/scenes`
- `DELETE /api/scenes/:sceneId`
- `PUT /api/scenes/:sceneId`

### Accessory diagnostics / snapshots
- `GET /api/rooms/:groupId/devices`
  - Returns snapshot-backed accessories with:
    - `devices[]`
    - `stale` (boolean)
    - `lastUpdated` (timestamp or null)
    - `lastError` (string or null)
- `GET /api/debug/devices/:groupId`
  - Raw diagnostic endpoint for bridge/resource mapping issues.

### Surprise scenes + animation controls
- `GET /api/surprises`
- `POST /api/rooms/:groupId/surprise`
- `POST /api/rooms/:groupId/surprise/remix`
- `POST /api/rooms/:groupId/surprise/custom`
- `POST /api/rooms/:groupId/surprise/preview`

### Hue v2 effects/scenes helpers
- `GET /api/v2/rooms/:groupId/info`
- `PUT /api/v2/rooms/:groupId/effect`
- `PUT /api/v2/lights/:v2LightId/effect`
- `POST /api/v2/rooms/:groupId/dynamic-scene`
- `PUT /api/v2/scenes/:sceneId/recall`
- `DELETE /api/v2/scenes/:sceneId`

## 5. Frontend Architecture

### Temperature page
- Files: `public/index.html`, `public/js/app.js`
- Uses room + history endpoints.
- Includes chart rendering and time-range controls.

### Lights page
- Files: `public/lights.html`, `public/js/lights.js`
- Features:
  - Room-grouped light cards
  - Per-light control (power, brightness, color, color temp)
  - Color conversion helpers (`xy`, `ct`, `hs`)

### Room detail page
- Files: `public/room.html`, `public/js/room.js`
- Features:
  - Full room light controls
  - Scene management (activate, rename, delete, edit surprise/remix)
  - Surprise scene editor modal
  - Dynamic animation scene builder
  - Accessory section (sensor + dimmer cards)
  - Dimmer detail modal
  - Timeline Ops / Control Studio modes
  - Bridge diagnostics panel fed by `/api/rooms/:groupId/devices`

## 6. Important State and Local Storage Keys

Client-side keys used in `public/js/room.js`:
- `roomOpsMode` (Timeline Ops vs Control Studio)
- `hueSurpriseScenes_<roomId>` (surprise metadata)
- `hueSurprisePaletteLibrary` (saved user palettes)
- `hueAnimScenes_<roomId>` (dynamic scene metadata)

Theme persistence is handled in `public/js/theme.js`.

## 7. Accessory Snapshot Pipeline (Critical)

Main logic: `src/accessorySnapshotService.js`

1. Fetch resource sets (rooms/zones/lights/devices/motion/temp/etc., plus v1 groups/sensors)
2. Resource requests are resilient (`Promise.allSettled`)
3. Build room snapshots by group id
4. Mark snapshot entries with metadata (`stale`, `lastUpdated`, `lastError`)
5. API route serves cached snapshot to UI

Design intent:
- Keep room detail accessories stable across bridge hiccups
- Prefer partial data over total failure

## 8. Bridge Protocol Notes (Common Failure Point)

- v2 endpoints are HTTPS and should return JSON.
- v1 endpoints can vary by bridge/network setup; client attempts HTTPS then HTTP fallback.
- If bridge returns HTML, `hueClient` normalizes this to actionable errors.

Typical error message:
- `Hue bridge returned HTML instead of JSON. Check bridge IP, API token, and bridge availability.`

When debugging, confirm what the server host receives for:
- `/api/<token>/groups`
- `/api/<token>/sensors`
- `/clip/v2/resource/room`

## 9. Logging and Observability

Structured logs include:
- App lifecycle (`APP_START`, `APP_READY`, `APP_SHUTDOWN`)
- Polling (`POLL_START`, `POLL_SUCCESS`, `POLL_FAILURE`)
- Hue requests/responses (`HUE_REQUEST`, `HUE_RESPONSE`, `HUE_WARNING`, `HUE_ERROR`)
- Snapshot lifecycle (`ACCESSORY_SNAPSHOT_*`)

Logger redacts keys containing `token`, `authorization`, `hue-application-key`, etc.

## 10. Development Workflow

### Start
```bash
npm install
npm start
```

### Env required
- `HUE_BRIDGE_IP`
- `HUE_API_TOKEN`

### Useful checks
- Syntax checks:
```bash
node --check server.js
node --check src/hueClient.js
node --check src/accessorySnapshotService.js
node --check public/js/room.js
```

### Where to modify by feature
- Bridge/API behavior: `src/hueClient.js`, `src/api/routes.js`
- Accessory consistency/mapping: `src/accessorySnapshotService.js`
- Scene/surprise UX: `public/js/room.js`, `src/api/routes.js`
- Lights dashboard UX: `public/js/lights.js`, `public/css/styles.css`

## 11. Current Technical Risks / Caveats

1. Multi-source accessory mapping (v1 + v2) is inherently brittle across bridge firmware variations.
2. Snapshot service may return partial data if some Hue resources fail; check `lastError` details.
3. Frontend room logic (`public/js/room.js`) is large and stateful; changes should be validated carefully.
4. No automated test suite is currently wired in `package.json`; validation is mostly runtime/manual.

## 12. Quick Mental Model for Agents

- `server.js` orchestrates lifecycle.
- `hueClient` is the only bridge transport layer.
- `routes.js` contains business logic and endpoint contracts.
- `dataStore + database` back historical temperature data.
- `accessorySnapshotService` backs room accessory diagnostics and stability.
- `public/js/room.js` is the highest complexity frontend surface.

If you need to debug "room detail has wrong/missing accessories", start here:
1. `/api/debug/devices/:groupId`
2. `src/accessorySnapshotService.js` mapping logic
3. `GET /api/rooms/:groupId/devices` payload (`stale`, `lastError`, `lastUpdated`)
