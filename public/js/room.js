// Hue Room Detail Page
// Displays all lights with full inline controls, scenes, and automations for a single room

const REFRESH_INTERVAL = 10000;
let refreshIntervalId = null;
let roomId = null;
let roomData = null;
const lightInputActive = {};   // true while user is dragging/editing a light control
const lightSendTimeouts = {};  // debounce timers per light
let roomColorWheel = null;
let surpriseStyles = [];
let editingSurpriseScene = null;
const SURPRISE_DEFAULT_ANIMATION_SPEED = 0.5;
let surprisePreviewTimeout = null;

const SURPRISE_PALETTE_LIBRARY_KEY = 'hueSurprisePaletteLibrary';

// Room brightness slider state
let roomBriSliderActive = false;
let roomBriSendTimeout = null;
let deviceData = [];
let deviceSnapshotMeta = {
  stale: true,
  lastUpdated: null,
  lastError: null
};
const ROOM_OPS_MODE_DESCRIPTIONS = {
  timeline: 'Live room operations with bridge snapshot diagnostics and accessory health.',
  studio: 'Control Studio combines scene launch points and light state distribution in one panel.'
};
const ROOM_OPS_MODE_STORAGE_KEY = 'roomOpsMode';
let currentRoomOpsMode = 'timeline';

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ── Color Conversion ──────────────────────────────────────────────

function xyBriToRgb(x, y, bri) {
  const brightness = bri / 254;
  const z = 1.0 - x - y;
  const Y = brightness;
  const X = (Y / y) * x;
  const Z = (Y / y) * z;

  let r =  X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b =  X * 0.051713 - Y * 0.121364 + Z * 1.011530;

  r = Math.max(0, r);
  g = Math.max(0, g);
  b = Math.max(0, b);

  r = r <= 0.0031308 ? 12.92 * r : 1.055 * Math.pow(r, 1.0 / 2.4) - 0.055;
  g = g <= 0.0031308 ? 12.92 * g : 1.055 * Math.pow(g, 1.0 / 2.4) - 0.055;
  b = b <= 0.0031308 ? 12.92 * b : 1.055 * Math.pow(b, 1.0 / 2.4) - 0.055;

  return {
    r: Math.min(255, Math.max(0, Math.round(r * 255))),
    g: Math.min(255, Math.max(0, Math.round(g * 255))),
    b: Math.min(255, Math.max(0, Math.round(b * 255)))
  };
}

function ctToRgb(ct) {
  const kelvin = 1000000 / ct;
  const temp = kelvin / 100;
  let r, g, b;

  if (temp <= 66) {
    r = 255;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
  }

  if (temp <= 66) {
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
  } else {
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
  }

  if (temp >= 66) {
    b = 255;
  } else if (temp <= 19) {
    b = 0;
  } else {
    b = 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  }

  return {
    r: Math.min(255, Math.max(0, Math.round(r))),
    g: Math.min(255, Math.max(0, Math.round(g))),
    b: Math.min(255, Math.max(0, Math.round(b)))
  };
}

function hueSatToCss(hue, sat, bri) {
  const h = Math.round((hue / 65535) * 360);
  const s = Math.round((sat / 254) * 100);
  const l = Math.round((bri / 254) * 50);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 255, g: 255, b: 255 };
}

function rgbToXy(r, g, b) {
  // sRGB to linear
  r = r / 255;
  g = g / 255;
  b = b / 255;
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  // Linear to XYZ (Wide RGB D65)
  const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const Z = r * 0.000088 + g * 0.072310 + b * 0.986039;

  const sum = X + Y + Z;
  if (sum === 0) return [0.3127, 0.3290];
  return [X / sum, Y / sum];
}

function lightToSwatchCss(light) {
  if (!light.on) return '#333';
  const bri = light.brightness || 1;
  if (light.colormode === 'xy' && light.xy) {
    const { r, g, b } = xyBriToRgb(light.xy[0], light.xy[1], bri);
    return `rgb(${r},${g},${b})`;
  }
  if (light.colormode === 'ct' && light.ct) {
    const { r, g, b } = ctToRgb(light.ct);
    const factor = bri / 254;
    return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
  }
  if (light.colormode === 'hs' && light.hue != null && light.sat != null) {
    return hueSatToCss(light.hue, light.sat, bri);
  }
  // Dimmable / on-off
  const dim = Math.round((bri / 254) * 255);
  return `rgb(${dim},${Math.round(dim * 0.9)},${Math.round(dim * 0.7)})`;
}

function lightToPickerHex(light) {
  if (!light.on) return '#ffffff';
  const bri = light.brightness || 128;
  if (light.colormode === 'xy' && light.xy) {
    const { r, g, b } = xyBriToRgb(light.xy[0], light.xy[1], bri);
    return rgbToHex(r, g, b);
  }
  if (light.colormode === 'hs' && light.hue != null && light.sat != null) {
    // Convert HSB to RGB for the picker
    const h = (light.hue / 65535) * 360;
    const s = light.sat / 254;
    const v = bri / 254;
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r = 0, g = 0, bl = 0;
    if (h < 60)      { r = c; g = x; }
    else if (h < 120){ r = x; g = c; }
    else if (h < 180){ g = c; bl = x; }
    else if (h < 240){ g = x; bl = c; }
    else if (h < 300){ r = x; bl = c; }
    else             { r = c; bl = x; }
    return rgbToHex(
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((bl + m) * 255)
    );
  }
  return '#ffffff';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function celsiusToFahrenheit(c) {
  return (c * 9 / 5) + 32;
}

function formatRelativeTime(isoTimestamp) {
  if (!isoTimestamp) return 'Unknown';
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h !== 1 ? 's' : ''} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d !== 1 ? 's' : ''} ago`;
}

function formatDateTime(value) {
  if (value == null) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

function setColorPickerRingColor(picker, colorHex = null) {
  if (!picker) return;
  const control = picker.closest('.color-picker-control');
  const ring = control ? control.querySelector('.color-picker-ring') : null;
  if (!ring) return;
  ring.style.setProperty('--picker-color', colorHex || picker.value || '#ffffff');
}

// ── Light type helpers ────────────────────────────────────────────

function isColorLight(type) {
  return type === 'Extended color light' || type === 'Color light';
}

function isCtLight(type) {
  return type === 'Extended color light' || type === 'Color temperature light';
}

function isDimmable(type) {
  return type !== 'On/Off plug-in unit';
}

// ── Render ────────────────────────────────────────────────────────

const DIMMER_BUTTON_LABELS = { 1: 'On', 2: 'Brighter', 3: 'Dimmer', 4: 'Off' };
const DIMMER_EVENT_LABELS = {
  initial_press: 'Pressed',
  short_release: 'Short press',
  long_release: 'Long press',
  repeat: 'Held'
};

function renderBatteryBadge(battery) {
  if (!battery || battery.level == null) return '';
  const level = battery.level;
  const stateClass = battery.state === 'critical' ? 'battery-critical'
    : battery.state === 'low' ? 'battery-low'
    : 'battery-ok';
  return `<span class="battery-badge ${stateClass}">${level}%</span>`;
}

function renderConnectivityDot(connectivity) {
  if (!connectivity) return '';
  const connected = connectivity.status === 'connected';
  return `<span class="connectivity-dot ${connected ? 'connectivity-connected' : 'connectivity-disconnected'}" title="${connected ? 'Connected' : 'Disconnected'}"></span>`;
}

function renderDeviceCard(device) {
  const deviceKind = String(device.deviceKind || '').toLowerCase();
  const productName = String(device.productName || '').toLowerCase();
  const productArchetype = String(device.productArchetype || '').toLowerCase();
  const isDimmer = deviceKind === 'dimmer'
    || (device.buttons && device.buttons.length > 0)
    || productName.includes('dimmer')
    || productArchetype.includes('dimmer')
    || productArchetype.includes('switch');
  const name = escapeHtml(device.name || device.productName || (isDimmer ? 'Dimmer Switch' : 'Sensor'));

  if (isDimmer) {
    const badges = [
      renderConnectivityDot(device.connectivity),
      renderBatteryBadge(device.battery)
    ].filter(Boolean).join('');
    const btnCount = device.buttons.length;
    return `<div class="device-card device-card--dimmer" data-rid="${escapeHtml(device.rid)}" role="button" tabindex="0" aria-label="${name} details">
      <div class="device-card-header">
        <div class="device-card-name" title="${name}">${name}</div>
        <div class="device-card-badges">${badges}</div>
      </div>
      <div class="device-card-hint">${btnCount} button${btnCount !== 1 ? 's' : ''} &middot; Tap for details</div>
    </div>`;
  }

  // Sensor device (motion/temp/lux)
  const rows = [];

  if (device.temperature?.valid && device.temperature.celsius != null) {
    const f = celsiusToFahrenheit(device.temperature.celsius).toFixed(1);
    rows.push(`<div class="device-sensor-row">
      <span class="device-sensor-label">Temp</span>
      <span class="device-sensor-value">${f}°F</span>
    </div>`);
  }

  if (device.motion?.valid) {
    const active = device.motion.detected;
    rows.push(`<div class="device-sensor-row">
      <span class="device-sensor-label">Motion</span>
      <span class="device-sensor-value${active ? ' motion-active' : ''}">${active ? 'Detected' : 'No motion'}</span>
    </div>`);
    if (device.motion.lastChanged) {
      rows.push(`<div class="device-sensor-row">
        <span class="device-sensor-label">Last seen</span>
        <span class="device-sensor-value device-sensor-secondary">${formatRelativeTime(device.motion.lastChanged)}</span>
      </div>`);
    }
  }

  if (device.lightLevel?.valid && device.lightLevel.lux != null) {
    rows.push(`<div class="device-sensor-row">
      <span class="device-sensor-label">Light</span>
      <span class="device-sensor-value">${Math.round(device.lightLevel.lux)} lux</span>
    </div>`);
  }

  if (rows.length === 0) {
    rows.push(`<p class="no-items-msg">No sensor data</p>`);
  }

  return `<div class="device-card" data-rid="${escapeHtml(device.rid)}">
    <div class="device-card-name" title="${name}">${name}</div>
    <div class="device-sensors">${rows.join('')}</div>
  </div>`;
}

function renderDevices(devices) {
  const grid = document.getElementById('devices-grid');
  if (!grid) return;
  const list = Array.isArray(devices) ? devices : [];
  if (list.length === 0) {
    grid.innerHTML = '<p class="no-items-msg">No accessories found for this room.</p>';
    return;
  }
  grid.innerHTML = list.map(renderDeviceCard).join('');
}

// ── Dimmer modal ──────────────────────────────────────────────────────────────

function openDimmerModal(device) {
  const modal = document.getElementById('dimmer-modal');
  if (!modal) return;

  const name = device.name || device.productName || 'Dimmer Switch';
  document.getElementById('dimmer-modal-title').textContent = name;

  // Meta row: connectivity + battery
  const metaParts = [];
  if (device.connectivity) {
    const connected = device.connectivity.status === 'connected';
    metaParts.push(`${renderConnectivityDot(device.connectivity)} <span class="dimmer-meta-label">${connected ? 'Connected' : 'Disconnected'}</span>`);
  }
  if (device.battery?.level != null) {
    metaParts.push(`${renderBatteryBadge(device.battery)} <span class="dimmer-meta-label">Battery</span>`);
  }
  document.getElementById('dimmer-modal-meta').innerHTML = metaParts.join('<span class="dimmer-meta-sep">·</span>');

  // Button rows
  const rows = (device.buttons || []).map((btn, index) => {
    const label = DIMMER_BUTTON_LABELS[btn.controlId] || `Button ${btn.controlId ?? (index + 1)}`;
    const eventLabel = btn.lastEvent ? (DIMMER_EVENT_LABELS[btn.lastEvent] || btn.lastEvent) : null;
    const timeLabel = btn.lastUpdated ? formatRelativeTime(btn.lastUpdated) : null;
    const hasActivity = eventLabel || timeLabel;
    return `<div class="dimmer-button-row">
      <div class="dimmer-button-label">${escapeHtml(label)}</div>
      <div class="dimmer-button-info">
        ${hasActivity
          ? `<span class="dimmer-button-event">${escapeHtml(eventLabel || '')}</span>
             <span class="dimmer-button-time">${escapeHtml(timeLabel || '')}</span>`
          : `<span class="dimmer-button-never">Never pressed</span>`}
      </div>
    </div>`;
  });
  document.getElementById('dimmer-buttons-list').innerHTML = rows.length > 0
    ? rows.join('')
    : '<div class="dimmer-button-row"><div class="dimmer-button-info"><span class="dimmer-button-never">No button data available</span></div></div>';

  modal.classList.add('active');
}

function closeDimmerModal() {
  const modal = document.getElementById('dimmer-modal');
  if (modal) modal.classList.remove('active');
}

function initDimmerModal() {
  const modal = document.getElementById('dimmer-modal');
  if (!modal) return;

  // Close button
  document.getElementById('dimmer-modal-close')?.addEventListener('click', closeDimmerModal);
  // Click outside
  modal.addEventListener('click', (e) => { if (e.target === modal) closeDimmerModal(); });
  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) closeDimmerModal();
  });

  // Event delegation: clicks on dimmer cards in the devices grid
  document.getElementById('devices-grid')?.addEventListener('click', (e) => {
    const card = e.target.closest('.device-card--dimmer');
    if (!card) return;
    const rid = card.dataset.rid;
    const device = (deviceData || []).find(d => d.rid === rid);
    if (device) openDimmerModal(device);
  });

  // Keyboard activation for accessibility
  document.getElementById('devices-grid')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.device-card--dimmer');
    if (!card) return;
    e.preventDefault();
    const rid = card.dataset.rid;
    const device = (deviceData || []).find(d => d.rid === rid);
    if (device) openDimmerModal(device);
  });
}

function renderLightCard(light) {
  const swatchColor = lightToSwatchCss(light);
  const briPercent = Math.round((light.brightness / 254) * 100);
  const ctKelvin = light.ct ? Math.round(1000000 / light.ct) : 4000;
  const pickerHex = lightToPickerHex(light);
  const unreachable = !light.reachable;
  const controlsDisabled = !light.on || unreachable;

  const colorHtml = isColorLight(light.type) ? `
    <input type="color" class="light-color-picker color-picker-input-hidden" value="${pickerHex}"
      data-light-id="${light.id}" ${controlsDisabled ? 'disabled' : ''}>` : '';

  const ctHtml = isCtLight(light.type) ? `
    <div class="ctrl-ct">
      <label>Color Temp: <span class="ct-value-label">${ctKelvin}K</span></label>
      <div class="ct-row">
        <span class="ct-label-cool">Cool</span>
        <input type="range" class="light-ct-slider" min="153" max="500"
          value="${light.ct || 300}" data-light-id="${light.id}" ${controlsDisabled ? 'disabled' : ''}>
        <span class="ct-label-warm">Warm</span>
      </div>
    </div>` : '';

  const brightnessHtml = isDimmable(light.type) ? `
    <div class="ctrl-bri">
      <label>Brightness: <span class="bri-value-label">${briPercent}%</span></label>
      <input type="range" class="light-bri-slider" min="1" max="254"
        value="${light.brightness || 1}" data-light-id="${light.id}" ${controlsDisabled ? 'disabled' : ''}>
    </div>` : '';

  const swatchInteractive = isColorLight(light.type);
  const swatchAttrs = swatchInteractive
    ? `data-color-trigger="true" tabindex="${controlsDisabled ? -1 : 0}" role="button"
       aria-label="Change ${escapeHtml(light.name)} color"`
    : '';

  return `
    <div class="room-light-card ${light.on ? 'light-on' : ''} ${unreachable ? 'light-unreachable' : ''}"
         data-light-id="${light.id}">
      <div class="room-light-card-header">
        <div class="room-light-swatch ${swatchInteractive ? 'swatch-color-trigger' : ''}" ${swatchAttrs}
          style="background:${swatchColor};${light.on ? `box-shadow:0 0 10px 2px ${swatchColor}88` : ''}"></div>
        <div class="room-light-name" title="${escapeHtml(light.name)}">${escapeHtml(light.name)}</div>
        <label class="toggle-switch room-light-toggle">
          <input type="checkbox" class="light-power-toggle" data-light-id="${light.id}"
            ${light.on ? 'checked' : ''} ${unreachable ? 'disabled' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="room-light-controls ${controlsDisabled ? 'controls-disabled' : ''}">
        ${brightnessHtml}
        ${colorHtml}
        ${ctHtml}
      </div>
    </div>
  `;
}

function renderSceneCard(scene, surpriseMeta = null) {
  const isAnimated = scene.name.endsWith('-Animation');
  const displayName = isAnimated ? scene.name.slice(0, -'-Animation'.length) : scene.name;
  const isSurpriseByName = /^surprise\b/i.test(displayName.trim());
  const isSurpriseByMeta = !!(surpriseMeta && surpriseMeta[scene.id]);
  const isSurprise = isSurpriseByName || isSurpriseByMeta;
  const isSurpriseAnimating = !!(surpriseMeta && surpriseMeta[scene.id]?.isAnimating);
  const isSurprisePaused = !!(surpriseMeta && surpriseMeta[scene.id]?.isPaused);
  const animateLabel = isSurpriseAnimating ? 'Looping' : 'Animate';
  return `
    <div class="scene-card${isAnimated ? ' scene-animated' : ''}" data-scene-id="${scene.id}">
      <div class="scene-card-name" title="${escapeHtml(scene.name)}">${escapeHtml(displayName)}</div>
      <div class="scene-card-actions">
        <button class="scene-edit-btn" data-scene-id="${scene.id}" title="Edit colors and brightness">Edit</button>
        <button class="scene-rename-btn" data-scene-id="${scene.id}" title="Rename scene">Rename</button>
        ${isSurprise ? `<button class="scene-animate-btn" data-scene-id="${scene.id}" title="Animate surprise palette">${animateLabel}</button>` : ''}
        ${isSurprise ? `<button class="scene-pause-btn" data-scene-id="${scene.id}" title="Pause surprise animation" ${isSurpriseAnimating ? '' : 'disabled'}>Pause</button>` : ''}
        ${isSurprise ? `<button class="scene-resume-btn" data-scene-id="${scene.id}" title="Resume surprise animation" ${isSurprisePaused ? '' : 'disabled'}>Resume</button>` : ''}
        ${isSurprise ? `<button class="scene-stop-btn" data-scene-id="${scene.id}" title="Stop surprise animation">Stop</button>` : ''}
        ${isSurprise ? `<button class="scene-remix-btn" data-scene-id="${scene.id}" title="Create a modified surprise">Remix</button>` : ''}
        <button class="scene-activate-btn" data-scene-id="${scene.id}">Activate</button>
        ${!scene.locked ? `<button class="scene-delete-btn" data-scene-id="${scene.id}" title="Delete scene">&times;</button>` : ''}
      </div>
    </div>
  `;
}

function renderScenes(scenes) {
  const grid = document.getElementById('scenes-grid');
  if (!scenes || scenes.length === 0) {
    grid.innerHTML = '<p class="no-items-msg">No scenes saved for this room.</p>';
    return;
  }
  const surpriseMeta = loadSurpriseSceneMeta(roomId);

  const animated = scenes.filter(s => s.name.endsWith('-Animation'));
  const staticScenes = scenes.filter(s => !s.name.endsWith('-Animation'));

  let html = '';

  if (staticScenes.length > 0) {
    if (animated.length > 0) {
      html += '<div class="scenes-subsection-title">Scenes</div>';
    }
    html += '<div class="scenes-subgrid">' + staticScenes.map((scene) => renderSceneCard(scene, surpriseMeta)).join('') + '</div>';
  }

  if (animated.length > 0) {
    html += '<div class="scenes-subsection-title">Animations</div>';
    html += '<div class="scenes-subgrid">' + animated.map((scene) => renderSceneCard(scene, surpriseMeta)).join('') + '</div>';
  }

  grid.innerHTML = html;
}

function formatScheduleTime(timeStr) {
  if (!timeStr) return '';
  // Recurring weekly: W<bitmask>/T<HH:MM:SS>
  const weeklyMatch = timeStr.match(/^W(\d+)\/T(\d{2}):(\d{2})/);
  if (weeklyMatch) {
    const bitmask = parseInt(weeklyMatch[1]);
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const activeDays = days.filter((_, i) => bitmask & (64 >> i));
    const h = parseInt(weeklyMatch[2]);
    const m = weeklyMatch[3];
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${activeDays.join(', ')} at ${h12}:${m} ${ampm}`;
  }
  // Absolute: YYYY-MM-DDTHH:MM:SS
  const absMatch = timeStr.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (absMatch) {
    const d = new Date(absMatch[1] + 'T' + absMatch[2] + ':' + absMatch[3] + ':00');
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  // Daily: PT<HH:MM:SS>
  const dailyMatch = timeStr.match(/^PT(\d{2}):(\d{2})/);
  if (dailyMatch) {
    const h = parseInt(dailyMatch[1]);
    const m = dailyMatch[2];
    if (h === 0) return `Every ${parseInt(m)} minutes`;
    return `Every ${h}h ${parseInt(m)}m`;
  }
  return timeStr;
}

function renderAutomations(schedules, rules) {
  const list = document.getElementById('automations-list');
  const items = [];

  for (const s of (schedules || [])) {
    items.push(`
      <div class="automation-item">
        <div class="automation-item-info">
          <div class="automation-item-name">${escapeHtml(s.name)}</div>
          <div class="automation-item-detail">${escapeHtml(formatScheduleTime(s.time))}${s.description ? ' — ' + escapeHtml(s.description) : ''}</div>
        </div>
        <div style="display:flex;gap:0.4rem;flex-shrink:0;">
          <span class="automation-badge badge-schedule">Schedule</span>
          <span class="automation-badge ${s.status === 'enabled' ? 'badge-enabled' : 'badge-disabled'}">${escapeHtml(s.status || 'disabled')}</span>
        </div>
      </div>
    `);
  }

  for (const r of (rules || [])) {
    const conditionText = (r.conditions || []).map(c => {
      if (c.address?.includes('presence')) return 'motion detected';
      if (c.address?.includes('lightlevel')) return 'light level';
      if (c.address?.includes('buttonevent')) return 'button press';
      return c.address?.split('/').pop() || 'trigger';
    }).filter((v, i, a) => a.indexOf(v) === i).join(', ');

    items.push(`
      <div class="automation-item">
        <div class="automation-item-info">
          <div class="automation-item-name">${escapeHtml(r.name)}</div>
          <div class="automation-item-detail">${conditionText ? 'Triggers on: ' + conditionText : 'Event-based automation'}</div>
        </div>
        <div style="display:flex;gap:0.4rem;flex-shrink:0;">
          <span class="automation-badge badge-rule">Rule</span>
          <span class="automation-badge ${r.status === 'enabled' ? 'badge-enabled' : 'badge-disabled'}">${escapeHtml(r.status || 'disabled')}</span>
        </div>
      </div>
    `);
  }

  if (items.length === 0) {
    list.innerHTML = '<p class="no-items-msg">No automations found for this room.</p>';
  } else {
    list.innerHTML = items.join('');
  }
}

function renderRoom(data) {
  document.getElementById('room-title').textContent = data.name;
  document.title = `${data.name} — Hue Dashboard`;

  // Room brightness bar
  const anyOn = data.lights.some(l => l.on && l.reachable);
  const briBar = document.getElementById('room-page-brightness');
  briBar.classList.remove('hidden');
  if (!roomBriSliderActive) {
    const onLights = data.lights.filter(l => l.on && l.reachable);
    const avgBri = onLights.length > 0
      ? Math.round(onLights.reduce((s, l) => s + l.brightness, 0) / onLights.length)
      : 127;
    document.getElementById('room-bri-slider').value = avgBri;
    document.getElementById('room-bri-value').textContent = Math.round((avgBri / 254) * 100) + '%';
  }

  // Lights
  const lightsSection = document.getElementById('lights-section');
  lightsSection.classList.remove('hidden');
  const grid = document.getElementById('lights-grid');

  // Update each card in-place if it exists (to preserve control state for active inputs)
  for (const light of data.lights) {
    const existing = grid.querySelector(`[data-light-id="${light.id}"]`);
    if (existing && lightInputActive[light.id]) {
      // Only update the swatch color to reflect reality; don't overwrite controls
      const swatch = existing.querySelector('.room-light-swatch');
      if (swatch) {
        const color = lightToSwatchCss(light);
        swatch.style.background = color;
        swatch.style.boxShadow = light.on ? `0 0 10px 2px ${color}88` : '';
      }
    } else if (existing) {
      existing.outerHTML = renderLightCard(light);
    } else {
      grid.insertAdjacentHTML('beforeend', renderLightCard(light));
    }
  }
  // Remove stale cards
  const currentIds = new Set(data.lights.map(l => l.id));
  for (const card of grid.querySelectorAll('[data-light-id]')) {
    if (!currentIds.has(card.dataset.lightId)) card.remove();
  }

  // Scenes
  const scenesSection = document.getElementById('scenes-section');
  scenesSection.classList.remove('hidden');
  renderScenes(data.scenes);
  pruneSurpriseSceneMeta(data.scenes);

  // Automations
  const autoSection = document.getElementById('automations-section');
  autoSection.classList.remove('hidden');
  renderAutomations(data.schedules, data.rules);

  // Animation effects section — always show (v2 check happens inside initAnimationSection)
  const animSection = document.getElementById('anim-section');
  if (animSection) animSection.classList.remove('hidden');

  renderRoomLayoutShowcase();
}

// ── Status helpers ────────────────────────────────────────────────

function updateStatus(state, text) {
  const indicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  indicator.className = `status-indicator status-${state}`;
  statusText.textContent = text;
}

function updateLastUpdateTime() {
  const el = document.getElementById('last-update');
  el.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
}

function showError(msg) {
  document.getElementById('loading').classList.add('hidden');
  const err = document.getElementById('error');
  err.classList.remove('hidden');
  document.getElementById('error-message').textContent = msg;
}

// ── Fetch ─────────────────────────────────────────────────────────

async function fetchAndRenderRoom() {
  try {
    const res = await fetch(`/api/rooms/${roomId}/detail`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'API error');

    roomData = data.room;
    document.getElementById('loading').classList.add('hidden');
    updateStatus('active', 'Connected');
    updateLastUpdateTime();
    renderRoom(data.room);
    fetchAndRenderDevices(); // refresh sensor readings on every poll
  } catch (error) {
    showError(`Connection error: ${error.message}`);
    updateStatus('error', 'Connection failed');
  }
}

async function fetchAndRenderDevices() {
  const section = document.getElementById('devices-section');
  const grid = document.getElementById('devices-grid');
  if (!section || !grid) return;
  try {
    const res = await fetch(`/api/rooms/${roomId}/devices`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch room accessories');

    deviceData = Array.isArray(data.devices) ? data.devices : [];
    deviceSnapshotMeta = {
      stale: !!data.stale,
      lastUpdated: data.lastUpdated ?? null,
      lastError: data.lastError ?? null
    };
    renderDevices(deviceData);
    section.classList.remove('hidden');
    renderRoomLayoutShowcase();
  } catch {
    deviceData = [];
    deviceSnapshotMeta = {
      stale: true,
      lastUpdated: null,
      lastError: 'Accessory snapshot unavailable'
    };
    grid.innerHTML = '';
    section.classList.add('hidden');
    renderRoomLayoutShowcase();
  }
}

function buildNowCards() {
  const lights = roomData?.lights || [];
  const devices = deviceData || [];
  const onCount = lights.filter((l) => l.on && l.reachable).length;
  const unreachableCount = lights.filter((l) => !l.reachable).length;
  const dimmerCount = devices.filter((d) => d.deviceKind === 'dimmer' || (d.buttons || []).length > 0).length;
  const motionDetectedCount = devices.filter((d) => d.motion?.valid && d.motion.detected).length;
  const tempDevice = devices.find((d) => d.temperature?.valid && Number.isFinite(d.temperature.celsius));
  const staleState = deviceSnapshotMeta.stale ? 'Stale' : 'Fresh';
  const staleUpdated = deviceSnapshotMeta.lastUpdated ? ` (${formatRelativeTime(deviceSnapshotMeta.lastUpdated)})` : '';

  return [
    { label: 'Lights', value: `${onCount}/${lights.length} on` },
    { label: 'Unreachable Lights', value: String(unreachableCount) },
    { label: 'Motions Active', value: String(motionDetectedCount) },
    { label: 'Dimmers', value: String(dimmerCount) },
    { label: 'Temperature', value: tempDevice ? `${celsiusToFahrenheit(tempDevice.temperature.celsius).toFixed(1)}°F` : 'Unknown' },
    { label: 'Snapshot', value: `${staleState}${staleUpdated}` }
  ];
}

function renderRoomLayoutShowcase() {
  const el = document.getElementById('room-layout-showcase');
  if (!el) return;

  if (!roomData) {
    el.classList.add('hidden');
    return;
  }

  const cards = buildNowCards();
  const lights = roomData?.lights || [];
  const devices = deviceData || [];
  const connectedCount = devices.filter((d) => d.connectivity?.status === 'connected').length;
  const disconnectedCount = devices.filter((d) => d.connectivity?.status && d.connectivity.status !== 'connected').length;
  const batteryLowCount = devices.filter((d) => d.battery && (d.battery.state === 'low' || (d.battery.level != null && d.battery.level <= 20))).length;
  const batteryCriticalCount = devices.filter((d) => d.battery && (d.battery.state === 'critical' || (d.battery.level != null && d.battery.level <= 5))).length;
  const motionCapableCount = devices.filter((d) => d.motion != null).length;
  const sensorCount = devices.filter((d) => d.deviceKind !== 'dimmer').length;
  const dimmerCount = devices.filter((d) => d.deviceKind === 'dimmer' || (d.buttons || []).length > 0).length;
  const schedulesCount = (roomData?.schedules || []).length;
  const rulesCount = (roomData?.rules || []).length;
  const timelineRows = [
    `Snapshot ${deviceSnapshotMeta.stale ? 'stale' : 'fresh'} as of ${formatDateTime(deviceSnapshotMeta.lastUpdated)}`,
    `${lights.filter((l) => l.on && l.reachable).length} lights on, ${lights.filter((l) => !l.reachable).length} unreachable`,
    `${motionCapableCount} motion-capable accessories, ${devices.filter((d) => d.motion?.valid && d.motion.detected).length} currently detecting`,
    `${rulesCount} rule automations and ${schedulesCount} schedules configured`
  ];

  el.className = 'room-layout-showcase';
  el.classList.remove('hidden');

  if (currentRoomOpsMode === 'studio') {
    const scenes = (roomData?.scenes || []).slice(0, 10);
    const onLights = lights.filter((l) => l.on).length;
    const unreachableLights = lights.filter((l) => !l.reachable).length;
    const colorLights = lights.filter((l) => isColorLight(l.type)).length;
    const dimmableLights = lights.filter((l) => isDimmable(l.type)).length;
    const matrix = lights.slice(0, 16).map((light) =>
      `<span class="mock-dot ${light.on ? 'on' : ''} ${light.reachable ? '' : 'offline'}" title="${escapeHtml(light.name)}"></span>`
    ).join('');

    el.innerHTML = `
      <div class="room-layout-grid two-col">
        <section class="mock-panel">
          <h3>Scene Launch Deck</h3>
          <div class="mock-chip-row">
            ${scenes.length > 0
              ? scenes.map((scene) => `<span class="mock-chip">${escapeHtml(scene.name)}</span>`).join('')
              : '<span class="mock-chip">No scenes available</span>'}
          </div>
          <ul class="mock-list">
            <li>Lights active: ${onLights}/${lights.length}</li>
            <li>Color-capable lights: ${colorLights}</li>
            <li>Dimmable lights: ${dimmableLights}</li>
          </ul>
        </section>
        <section class="mock-panel">
          <h3>Fixture Matrix</h3>
          <div class="mock-matrix">${matrix || '<span class="mock-empty">No lights</span>'}</div>
          <ul class="mock-list">
            <li>Snapshot status: ${deviceSnapshotMeta.stale ? 'Stale' : 'Fresh'}</li>
            <li>Unreachable fixtures: ${unreachableLights}</li>
            <li>Connected accessories: ${connectedCount}</li>
          </ul>
        </section>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="mock-nowcards">
      ${cards.map((card) => `<article class="mock-nowcard"><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.value)}</strong></article>`).join('')}
    </div>
    <div class="room-layout-grid two-col">
      <section class="mock-panel">
        <h3>Activity Timeline</h3>
        <ul class="mock-list">${timelineRows.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul>
      </section>
      <section class="mock-panel">
        <h3>Bridge Diagnostics</h3>
        <ul class="mock-list">
          <li>Snapshot status: ${deviceSnapshotMeta.stale ? 'Stale' : 'Fresh'}</li>
          <li>Snapshot updated: ${escapeHtml(formatDateTime(deviceSnapshotMeta.lastUpdated))}</li>
          <li>Snapshot error: ${escapeHtml(deviceSnapshotMeta.lastError || 'None')}</li>
          <li>Accessories: ${devices.length} total (${sensorCount} sensors, ${dimmerCount} dimmers)</li>
          <li>Connectivity: ${connectedCount} connected, ${disconnectedCount} disconnected</li>
          <li>Battery health: ${batteryLowCount} low, ${batteryCriticalCount} critical</li>
        </ul>
      </section>
    </div>
  `;
}

function setRoomOpsMode(mode) {
  if (!ROOM_OPS_MODE_DESCRIPTIONS[mode]) return;
  currentRoomOpsMode = mode;
  localStorage.setItem(ROOM_OPS_MODE_STORAGE_KEY, mode);

  const description = document.getElementById('room-ops-mode-description');
  if (description) description.textContent = ROOM_OPS_MODE_DESCRIPTIONS[mode];

  const group = document.getElementById('room-ops-mode-group');
  if (group) {
    for (const button of group.querySelectorAll('.layout-mode-btn')) {
      button.classList.toggle('active', button.dataset.roomOpsMode === mode);
    }
  }

  renderRoomLayoutShowcase();
}

function initRoomOpsModePicker() {
  const savedMode = localStorage.getItem(ROOM_OPS_MODE_STORAGE_KEY);
  if (savedMode && ROOM_OPS_MODE_DESCRIPTIONS[savedMode]) {
    currentRoomOpsMode = savedMode;
  }

  const group = document.getElementById('room-ops-mode-group');
  if (!group) return;
  group.addEventListener('click', (event) => {
    const button = event.target.closest('.layout-mode-btn');
    if (!button) return;
    setRoomOpsMode(button.dataset.roomOpsMode);
  });
  setRoomOpsMode(currentRoomOpsMode);
}

// ── Light controls ────────────────────────────────────────────────

async function sendLightState(lightId, stateObj) {
  try {
    const res = await fetch(`/api/lights/${lightId}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stateObj)
    });
    await res.json();
  } catch (err) {
    console.error('sendLightState error', err);
  }
}

function debouncedSendLight(lightId, stateObj, delay = 100) {
  if (lightSendTimeouts[lightId]) clearTimeout(lightSendTimeouts[lightId]);
  lightSendTimeouts[lightId] = setTimeout(() => sendLightState(lightId, stateObj), delay);
}

function updateCardSwatch(lightId, cssColor, isOn) {
  const card = document.querySelector(`.room-light-card[data-light-id="${lightId}"]`);
  if (!card) return;
  const swatch = card.querySelector('.room-light-swatch');
  if (swatch) {
    swatch.style.background = cssColor;
    swatch.style.boxShadow = isOn ? `0 0 10px 2px ${cssColor}88` : '';
  }
}

function setControlsDisabled(lightId, disabled) {
  const card = document.querySelector(`.room-light-card[data-light-id="${lightId}"]`);
  if (!card) return;
  const controls = card.querySelector('.room-light-controls');
  if (controls) {
    if (disabled) {
      controls.classList.add('controls-disabled');
    } else {
      controls.classList.remove('controls-disabled');
    }
    for (const control of controls.querySelectorAll('input, button')) {
      control.disabled = disabled;
    }
  }
}

function initLightControls() {
  const grid = document.getElementById('lights-grid');
  roomColorWheel = typeof window.createCircleColorPicker === 'function'
    ? window.createCircleColorPicker()
    : null;

  grid.addEventListener('click', (e) => {
    const swatch = e.target.closest('.swatch-color-trigger');
    if (!swatch || !roomColorWheel) return;
    const card = swatch.closest('.room-light-card');
    const picker = card?.querySelector('.light-color-picker');
    if (!picker || picker.disabled) return;
    roomColorWheel.open(swatch, picker);
  });

  grid.addEventListener('keydown', (e) => {
    const swatch = e.target.closest('.swatch-color-trigger');
    if (!swatch || !roomColorWheel) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const card = swatch.closest('.room-light-card');
    const picker = card?.querySelector('.light-color-picker');
    if (!picker || picker.disabled) return;
    roomColorWheel.open(swatch, picker);
  });

  // Power toggle
  grid.addEventListener('change', async (e) => {
    const toggle = e.target.closest('.light-power-toggle');
    if (!toggle) return;
    const lightId = toggle.dataset.lightId;
    const on = toggle.checked;

    lightInputActive[lightId] = true;
    setControlsDisabled(lightId, !on);

    // Update swatch
    const light = roomData?.lights.find(l => l.id === lightId);
    const color = on ? lightToSwatchCss({ ...light, on: true }) : '#333';
    updateCardSwatch(lightId, color, on);

    await sendLightState(lightId, { on });
    setTimeout(() => { lightInputActive[lightId] = false; }, 1000);
  });

  // Brightness slider
  grid.addEventListener('input', (e) => {
    const slider = e.target.closest('.light-bri-slider');
    if (!slider) return;
    const lightId = slider.dataset.lightId;
    const bri = parseInt(slider.value);

    lightInputActive[lightId] = true;
    const label = slider.closest('.ctrl-bri')?.querySelector('.bri-value-label');
    if (label) label.textContent = Math.round((bri / 254) * 100) + '%';

    // Update swatch brightness
    const light = roomData?.lights.find(l => l.id === lightId);
    if (light) {
      const color = lightToSwatchCss({ ...light, brightness: bri });
      updateCardSwatch(lightId, color, light.on);
    }

    debouncedSendLight(lightId, { bri });
  });

  // Color picker
  grid.addEventListener('input', (e) => {
    const picker = e.target.closest('.light-color-picker');
    if (!picker) return;
    const lightId = picker.dataset.lightId;
    const hex = picker.value;
    setColorPickerRingColor(picker, hex);
    const { r, g, b } = hexToRgb(hex);
    const xy = rgbToXy(r, g, b);

    lightInputActive[lightId] = true;
    updateCardSwatch(lightId, hex, true);
    debouncedSendLight(lightId, { xy, on: true });
  });

  // CT slider
  grid.addEventListener('input', (e) => {
    const slider = e.target.closest('.light-ct-slider');
    if (!slider) return;
    const lightId = slider.dataset.lightId;
    const ct = parseInt(slider.value);
    const kelvin = Math.round(1000000 / ct);

    lightInputActive[lightId] = true;
    const label = slider.closest('.ctrl-ct')?.querySelector('.ct-value-label');
    if (label) label.textContent = kelvin + 'K';

    const { r, g, b } = ctToRgb(ct);
    const light = roomData?.lights.find(l => l.id === lightId);
    const factor = light ? light.brightness / 254 : 1;
    const color = `rgb(${Math.round(r*factor)},${Math.round(g*factor)},${Math.round(b*factor)})`;
    updateCardSwatch(lightId, color, true);

    debouncedSendLight(lightId, { ct });
  });

  // Clear active flag on pointer release (for sliders)
  grid.addEventListener('pointerup', (e) => {
    const slider = e.target.closest('.light-bri-slider, .light-ct-slider');
    if (!slider) return;
    setTimeout(() => { lightInputActive[slider.dataset.lightId] = false; }, 600);
  });

  grid.addEventListener('change', (e) => {
    const slider = e.target.closest('.light-bri-slider, .light-ct-slider');
    if (!slider) return;
    setTimeout(() => { lightInputActive[slider.dataset.lightId] = false; }, 600);
  });

  // Color picker closes = clear active
  grid.addEventListener('change', (e) => {
    const picker = e.target.closest('.light-color-picker');
    if (!picker) return;
    setTimeout(() => { lightInputActive[picker.dataset.lightId] = false; }, 600);
  });
}

// ── Room brightness slider ─────────────────────────────────────────

function initRoomBrightness() {
  const slider = document.getElementById('room-bri-slider');
  const label = document.getElementById('room-bri-value');

  slider.addEventListener('input', () => {
    roomBriSliderActive = true;
    const bri = parseInt(slider.value);
    label.textContent = Math.round((bri / 254) * 100) + '%';
    if (roomBriSendTimeout) clearTimeout(roomBriSendTimeout);
    roomBriSendTimeout = setTimeout(() => sendRoomBrightness(bri), 150);
  });

  slider.addEventListener('pointerup', () => {
    setTimeout(() => { roomBriSliderActive = false; }, 600);
  });

  slider.addEventListener('change', () => {
    setTimeout(() => { roomBriSliderActive = false; }, 600);
  });

  const offBtn = document.getElementById('room-all-off-btn');
  offBtn.addEventListener('click', async () => {
    offBtn.disabled = true;
    try {
      await fetch(`/api/rooms/${roomId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: false })
      });
      setTimeout(fetchAndRenderRoom, 600);
    } finally {
      offBtn.disabled = false;
    }
  });
}

async function sendRoomBrightness(bri) {
  try {
    await fetch(`/api/rooms/${roomId}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bri, on: true })
    });
  } catch (err) {
    console.error('sendRoomBrightness error', err);
  }
}

// ── Scenes ────────────────────────────────────────────────────────

function renderSurpriseStylePreview(style) {
  const preview = document.getElementById('surprise-style-preview');
  if (!preview) return;
  if (!style) {
    preview.innerHTML = '';
    return;
  }

  const dots = (style.samplePalette || [])
    .map((hex) => `<span class="surprise-style-dot" style="background:${escapeHtml(hex)}"></span>`)
    .join('');
  const description = style.description ? escapeHtml(style.description) : 'Randomized cohesive swatches.';

  preview.innerHTML = `
    <div class="surprise-style-dots">${dots}</div>
    <div class="surprise-style-desc">${description}</div>
  `;
}

async function loadSurpriseStyles() {
  const select = document.getElementById('surprise-style-select');
  const button = document.getElementById('surprise-scene-btn');
  if (!select || !button) return;

  try {
    const res = await fetch('/api/surprises');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load surprise styles');
    surpriseStyles = Array.isArray(data.styles) ? data.styles : [];
  } catch (error) {
    console.error('loadSurpriseStyles error:', error.message);
    surpriseStyles = [];
  }

  if (surpriseStyles.length === 0) {
    select.innerHTML = '<option value="">No surprise styles available</option>';
    select.disabled = true;
    button.disabled = true;
    renderSurpriseStylePreview(null);
    return;
  }

  select.innerHTML = surpriseStyles.map((style) =>
    `<option value="${escapeHtml(style.id)}">${escapeHtml(style.name)}</option>`
  ).join('');

  select.disabled = false;
  button.disabled = false;
  renderSurpriseStylePreview(surpriseStyles[0]);
}

function loadSurpriseSceneMeta(rid) {
  try {
    const parsed = JSON.parse(localStorage.getItem(`hueSurpriseScenes_${rid}`) || '{}');
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function saveSurpriseSceneMeta(rid, meta) {
  localStorage.setItem(`hueSurpriseScenes_${rid}`, JSON.stringify(meta));
}

function loadSurprisePaletteLibrary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SURPRISE_PALETTE_LIBRARY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSurprisePaletteLibrary(items) {
  localStorage.setItem(SURPRISE_PALETTE_LIBRARY_KEY, JSON.stringify(items));
}

function upsertSurpriseSceneMeta(sceneId, sceneName, styleId, palette) {
  if (!roomId || !sceneId || !Array.isArray(palette) || palette.length === 0) return;
  const meta = loadSurpriseSceneMeta(roomId);
  const previous = meta[sceneId] || {};
  meta[sceneId] = {
    sceneName,
    styleId: styleId || null,
    palette,
    animationSceneId: previous.animationSceneId || null,
    isAnimating: previous.isAnimating || false,
    isPaused: previous.isPaused || false,
    animationOptions: previous.animationOptions || null,
    assignmentMode: previous.assignmentMode || 'random',
    lightAssignments: previous.lightAssignments || {},
    transitionMs: Number.isFinite(previous.transitionMs) ? previous.transitionMs : 0,
    updatedAt: Date.now()
  };
  saveSurpriseSceneMeta(roomId, meta);
}

function setSurpriseAnimatingByAnimationScene(animationSceneId, isAnimating, isPaused = !isAnimating) {
  if (!roomId || !animationSceneId) return;
  const meta = loadSurpriseSceneMeta(roomId);
  let changed = false;
  for (const sceneMeta of Object.values(meta)) {
    if (sceneMeta && sceneMeta.animationSceneId === animationSceneId) {
      sceneMeta.isAnimating = !!isAnimating;
      sceneMeta.isPaused = !!isPaused;
      sceneMeta.updatedAt = Date.now();
      changed = true;
    }
  }
  if (changed) {
    saveSurpriseSceneMeta(roomId, meta);
  }
}

function pruneSurpriseSceneMeta(scenes = []) {
  if (!roomId) return;
  const meta = loadSurpriseSceneMeta(roomId);
  const sceneIds = new Set((scenes || []).map((scene) => scene.id));
  let changed = false;
  for (const sceneId of Object.keys(meta)) {
    if (!sceneIds.has(sceneId)) {
      delete meta[sceneId];
      changed = true;
    }
  }
  if (changed) {
    saveSurpriseSceneMeta(roomId, meta);
  }
}

function inferSurpriseStyleFromName(sceneName) {
  const normalized = String(sceneName || '').toLowerCase();
  return surpriseStyles.find((style) => normalized.includes(String(style.name || '').toLowerCase())) || null;
}

function getDefaultSurprisePalette(scene) {
  const meta = loadSurpriseSceneMeta(roomId);
  const stored = scene ? meta[scene.id] : null;
  if (stored && Array.isArray(stored.palette) && stored.palette.length >= 2) {
    return stored.palette.map((swatch) => ({
      hex: swatch.hex,
      brightness: clampNumber(parseInt(swatch.brightness, 10) || 75, 1, 100)
    }));
  }

  let style = null;
  if (stored?.styleId) {
    style = surpriseStyles.find((entry) => entry.id === stored.styleId) || null;
  }
  if (!style && scene) {
    style = inferSurpriseStyleFromName(scene.name);
  }
  if (!style && surpriseStyles.length > 0) {
    style = surpriseStyles[0];
  }

  const samplePalette = (style?.samplePalette || ['#c8d8ff', '#f6b8d0', '#c4f0dd']);
  return samplePalette.slice(0, 6).map((hex) => ({ hex, brightness: 75 }));
}

function getSelectedSurpriseAnimationSpeed() {
  const speedSelect = document.getElementById('surprise-speed-select');
  const speed = parseFloat(speedSelect?.value || String(SURPRISE_DEFAULT_ANIMATION_SPEED));
  return clampNumber(Number.isFinite(speed) ? speed : SURPRISE_DEFAULT_ANIMATION_SPEED, 0.1, 1);
}

function getSelectedSurpriseAnimationDirection() {
  const select = document.getElementById('surprise-anim-direction');
  return select?.value === 'reverse' ? 'reverse' : 'forward';
}

function getSelectedSurpriseAnimationPattern() {
  const select = document.getElementById('surprise-anim-pattern');
  const pattern = String(select?.value || 'rotate');
  if (pattern === 'bounce' || pattern === 'random') return pattern;
  return 'rotate';
}

function shuffleArray(input) {
  const arr = input.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function applyAnimationPattern(palette, direction, pattern) {
  let output = Array.isArray(palette) ? palette.slice() : [];
  if (direction === 'reverse') {
    output.reverse();
  }
  if (pattern === 'bounce') {
    const tail = output.length > 2 ? output.slice(1, -1).reverse() : output.slice().reverse();
    output = output.concat(tail);
  } else if (pattern === 'random') {
    output = shuffleArray(output);
  } else if (pattern === 'rotate') {
    const offset = output.length > 1 ? Math.floor(Math.random() * (output.length - 1)) + 1 : 0;
    output = rotatePalette(output, offset);
  }
  return output;
}

function rotatePalette(palette, offset = 0) {
  if (!Array.isArray(palette) || palette.length === 0) return [];
  const normalized = ((offset % palette.length) + palette.length) % palette.length;
  if (normalized === 0) return palette.slice();
  return palette.slice(normalized).concat(palette.slice(0, normalized));
}

function upsertDynamicSceneStorage(sceneId, name, palette, speed) {
  if (!roomId || !sceneId) return;
  const scenes = loadAnimScenes(roomId);
  const entry = {
    sceneId,
    name,
    palette: Array.isArray(palette) ? palette : [],
    speed: clampNumber(parseFloat(speed) || SURPRISE_DEFAULT_ANIMATION_SPEED, 0.1, 1)
  };
  const existingIndex = scenes.findIndex((scene) => scene.sceneId === sceneId);
  if (existingIndex >= 0) {
    scenes[existingIndex] = { ...scenes[existingIndex], ...entry };
  } else {
    scenes.push(entry);
  }
  saveAnimScenes(roomId, scenes);
}

function makeSurpriseSwatchRow(hex = '#ffffff', brightness = 75) {
  const row = document.createElement('div');
  row.className = 'anim-frame-row';
  row.innerHTML = `
    <span class="anim-frame-swatch" style="background:${escapeHtml(hex)}"></span>
    <input type="color" class="anim-frame-color" value="${escapeHtml(hex)}">
    <label class="anim-frame-bri-label">
      <span>Brightness</span>
      <input type="range" class="anim-frame-bri" min="1" max="100" value="${clampNumber(parseInt(brightness, 10) || 75, 1, 100)}">
      <span class="anim-frame-bri-val">${clampNumber(parseInt(brightness, 10) || 75, 1, 100)}%</span>
    </label>
    <button class="anim-frame-remove" title="Remove swatch">×</button>
  `;

  const colorInput = row.querySelector('.anim-frame-color');
  const swatch = row.querySelector('.anim-frame-swatch');
  const briSlider = row.querySelector('.anim-frame-bri');
  const briVal = row.querySelector('.anim-frame-bri-val');
  const removeBtn = row.querySelector('.anim-frame-remove');

  colorInput.addEventListener('input', () => {
    swatch.style.background = colorInput.value;
  });
  briSlider.addEventListener('input', () => {
    briVal.textContent = `${briSlider.value}%`;
  });
  removeBtn.addEventListener('click', () => {
    const list = document.getElementById('surprise-swatches-list');
    if (list.querySelectorAll('.anim-frame-row').length > 2) {
      row.remove();
      updateSurpriseSwatchRemovability();
    }
  });

  return row;
}

function updateSurpriseSwatchRemovability() {
  const list = document.getElementById('surprise-swatches-list');
  if (!list) return;
  const rows = list.querySelectorAll('.anim-frame-row');
  rows.forEach((row) => {
    const removeBtn = row.querySelector('.anim-frame-remove');
    if (removeBtn) removeBtn.disabled = rows.length <= 2;
  });
}

function getSurprisePaletteFromModal() {
  const rows = document.querySelectorAll('#surprise-swatches-list .anim-frame-row');
  return Array.from(rows).map((row) => ({
    hex: row.querySelector('.anim-frame-color').value,
    brightness: clampNumber(parseInt(row.querySelector('.anim-frame-bri').value, 10) || 75, 1, 100)
  }));
}

function setSurprisePaletteInModal(palette) {
  const list = document.getElementById('surprise-swatches-list');
  if (!list) return;
  list.innerHTML = '';
  const normalized = (Array.isArray(palette) ? palette : []).slice(0, 8);
  normalized.forEach((swatch) => {
    list.appendChild(makeSurpriseSwatchRow(swatch.hex || '#ffffff', swatch.brightness || 75));
  });
  if (normalized.length < 2) {
    ['#c8d8ff', '#f6b8d0'].forEach((hex) => list.appendChild(makeSurpriseSwatchRow(hex, 75)));
  }
  updateSurpriseSwatchRemovability();
  refreshSurpriseLightAssignmentRows();
}

function refreshSavedPaletteSelect() {
  const select = document.getElementById('surprise-saved-palette-select');
  if (!select) return;
  const library = loadSurprisePaletteLibrary();
  if (library.length === 0) {
    select.innerHTML = '<option value="">No saved palettes</option>';
    return;
  }
  select.innerHTML = library.map((item, index) =>
    `<option value="${index}">${escapeHtml(item.name || `Palette ${index + 1}`)}</option>`
  ).join('');
}

function refreshSurpriseTemplateSelect() {
  const select = document.getElementById('surprise-template-select');
  if (!select) return;
  const options = surpriseStyles.map((style) =>
    `<option value="${escapeHtml(style.id)}">${escapeHtml(style.name)}</option>`
  );
  options.unshift('<option value="">Choose template…</option>');
  select.innerHTML = options.join('');
}

function applyBrightnessConstraintsToModalSwatches() {
  const minInput = document.getElementById('surprise-min-brightness');
  const maxInput = document.getElementById('surprise-max-brightness');
  const minLabel = document.getElementById('surprise-min-brightness-label');
  const maxLabel = document.getElementById('surprise-max-brightness-label');
  if (!minInput || !maxInput) return;

  let minValue = clampNumber(parseInt(minInput.value, 10) || 1, 1, 100);
  let maxValue = clampNumber(parseInt(maxInput.value, 10) || 100, 1, 100);
  if (minValue > maxValue) {
    [minValue, maxValue] = [maxValue, minValue];
  }
  minInput.value = String(minValue);
  maxInput.value = String(maxValue);
  if (minLabel) minLabel.textContent = `${minValue}%`;
  if (maxLabel) maxLabel.textContent = `${maxValue}%`;

  const rows = document.querySelectorAll('#surprise-swatches-list .anim-frame-row');
  rows.forEach((row) => {
    const slider = row.querySelector('.anim-frame-bri');
    const label = row.querySelector('.anim-frame-bri-val');
    const constrained = clampNumber(parseInt(slider.value, 10) || 75, minValue, maxValue);
    slider.value = String(constrained);
    if (label) label.textContent = `${constrained}%`;
  });
}

function getSurpriseLightAssignmentsFromModal() {
  const mode = document.getElementById('surprise-assignment-mode')?.value || 'random';
  if (mode !== 'per-light') {
    return { assignmentMode: 'random', lightAssignments: {} };
  }
  const assignments = {};
  const rows = document.querySelectorAll('#surprise-light-assignments .surprise-light-assign-row');
  rows.forEach((row) => {
    const lightId = row.dataset.lightId;
    const select = row.querySelector('select');
    const swatchIndex = parseInt(select?.value, 10);
    if (lightId && Number.isFinite(swatchIndex) && swatchIndex >= 0) {
      assignments[lightId] = swatchIndex;
    }
  });
  return { assignmentMode: 'per-light', lightAssignments: assignments };
}

function refreshSurpriseLightAssignmentRows(savedAssignments = null) {
  const mode = document.getElementById('surprise-assignment-mode')?.value || 'random';
  const container = document.getElementById('surprise-light-assignments');
  if (!container) return;
  if (mode !== 'per-light') {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  const palette = getSurprisePaletteFromModal();
  const assignmentSource = savedAssignments && typeof savedAssignments === 'object'
    ? savedAssignments
    : (loadSurpriseSceneMeta(roomId)[editingSurpriseScene?.id || '']?.lightAssignments || {});
  const lights = roomData?.lights || [];
  container.innerHTML = lights.map((light) => {
    const savedIndex = Number.parseInt(assignmentSource?.[light.id], 10);
    const selectedIndex = Number.isFinite(savedIndex) && savedIndex >= 0 && savedIndex < palette.length ? savedIndex : 0;
    const options = palette.map((swatch, index) => {
      const selected = index === selectedIndex ? 'selected' : '';
      return `<option value="${index}" ${selected}>${index + 1}: ${escapeHtml(swatch.hex)} (${swatch.brightness}%)</option>`;
    }).join('');
    return `
      <div class="surprise-light-assign-row" data-light-id="${light.id}">
        <span class="surprise-light-name" title="${escapeHtml(light.name)}">${escapeHtml(light.name)}</span>
        <select class="surprise-style-select">${options}</select>
      </div>
    `;
  }).join('');
}

function queueSurpriseLivePreview() {
  const livePreviewEnabled = !!document.getElementById('surprise-live-preview-toggle')?.checked;
  if (!livePreviewEnabled || !editingSurpriseScene) return;
  if (surprisePreviewTimeout) clearTimeout(surprisePreviewTimeout);
  surprisePreviewTimeout = setTimeout(async () => {
    try {
      const palette = getSurprisePaletteFromModal();
      if (palette.length < 2) return;
      const styleId = document.getElementById('surprise-style-select')?.value || null;
      const transitionMs = parseInt(document.getElementById('surprise-transition-ms')?.value || '0', 10) || 0;
      const assignmentData = getSurpriseLightAssignmentsFromModal();
      await fetch(`/api/rooms/${roomId}/surprise/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          styleId,
          palette,
          assignmentMode: assignmentData.assignmentMode,
          lightAssignments: assignmentData.lightAssignments,
          transitionMs
        })
      });
    } catch (error) {
      console.warn('Surprise live preview error:', error.message);
    }
  }, 280);
}

function openSurpriseEditor(sceneId) {
  const scene = (roomData?.scenes || []).find((entry) => entry.id === sceneId);
  if (!scene) return;

  editingSurpriseScene = scene;

  const modal = document.getElementById('surprise-editor-modal');
  const title = document.getElementById('surprise-editor-title');
  const nameInput = document.getElementById('surprise-editor-name');
  const list = document.getElementById('surprise-swatches-list');

  title.textContent = 'Edit Surprise';
  nameInput.value = scene.name || '';
  const meta = loadSurpriseSceneMeta(roomId);
  const sceneMeta = meta[scene.id] || {};

  const palette = getDefaultSurprisePalette(scene);
  setSurprisePaletteInModal(palette);
  refreshSurpriseTemplateSelect();
  refreshSavedPaletteSelect();

  const assignmentModeSelect = document.getElementById('surprise-assignment-mode');
  const transitionSelect = document.getElementById('surprise-transition-ms');
  const livePreviewToggle = document.getElementById('surprise-live-preview-toggle');
  const minBrightness = document.getElementById('surprise-min-brightness');
  const maxBrightness = document.getElementById('surprise-max-brightness');

  if (assignmentModeSelect) {
    assignmentModeSelect.value = sceneMeta.assignmentMode === 'per-light' ? 'per-light' : 'random';
  }
  if (transitionSelect) {
    const transitionMs = Number.isFinite(sceneMeta.transitionMs) ? sceneMeta.transitionMs : 0;
    transitionSelect.value = ['0', '400', '1000', '2000', '4000'].includes(String(transitionMs))
      ? String(transitionMs)
      : '0';
  }
  if (livePreviewToggle) {
    livePreviewToggle.checked = false;
  }
  if (minBrightness) minBrightness.value = '35';
  if (maxBrightness) maxBrightness.value = '100';
  applyBrightnessConstraintsToModalSwatches();
  refreshSurpriseLightAssignmentRows(sceneMeta.lightAssignments || {});

  modal.classList.add('active');
  nameInput.focus();
}

function closeSurpriseEditor() {
  const modal = document.getElementById('surprise-editor-modal');
  const wasPreviewing = !!document.getElementById('surprise-live-preview-toggle')?.checked;
  const sceneToRestore = editingSurpriseScene?.id || null;
  modal.classList.remove('active');
  editingSurpriseScene = null;
  if (surprisePreviewTimeout) {
    clearTimeout(surprisePreviewTimeout);
    surprisePreviewTimeout = null;
  }
  if (wasPreviewing && sceneToRestore && roomId) {
    fetch(`/api/rooms/${roomId}/scene`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId: sceneToRestore })
    }).catch(() => {});
  }
}

function initSurpriseEditorModal() {
  const modal = document.getElementById('surprise-editor-modal');
  const closeBtn = document.getElementById('surprise-editor-close');
  const cancelBtn = document.getElementById('surprise-cancel-btn');
  const addBtn = document.getElementById('surprise-add-swatch-btn');
  const saveBtn = document.getElementById('surprise-save-btn');
  const styleSelect = document.getElementById('surprise-style-select');
  const templateSelect = document.getElementById('surprise-template-select');
  const templateApplyBtn = document.getElementById('surprise-template-apply-btn');
  const assignmentModeSelect = document.getElementById('surprise-assignment-mode');
  const transitionSelect = document.getElementById('surprise-transition-ms');
  const livePreviewToggle = document.getElementById('surprise-live-preview-toggle');
  const minBrightness = document.getElementById('surprise-min-brightness');
  const maxBrightness = document.getElementById('surprise-max-brightness');
  const savePaletteBtn = document.getElementById('surprise-save-palette-btn');
  const loadPaletteBtn = document.getElementById('surprise-load-palette-btn');
  const deletePaletteBtn = document.getElementById('surprise-delete-palette-btn');
  const savedPaletteSelect = document.getElementById('surprise-saved-palette-select');
  const paletteNameInput = document.getElementById('surprise-palette-name');

  closeBtn.addEventListener('click', closeSurpriseEditor);
  cancelBtn.addEventListener('click', closeSurpriseEditor);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeSurpriseEditor(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeSurpriseEditor();
    }
  });

  addBtn.addEventListener('click', () => {
    const list = document.getElementById('surprise-swatches-list');
    if (list.querySelectorAll('.anim-frame-row').length >= 8) return;
    list.appendChild(makeSurpriseSwatchRow('#ffffff', 75));
    updateSurpriseSwatchRemovability();
    applyBrightnessConstraintsToModalSwatches();
    refreshSurpriseLightAssignmentRows();
    queueSurpriseLivePreview();
  });

  document.getElementById('surprise-swatches-list').addEventListener('input', () => {
    applyBrightnessConstraintsToModalSwatches();
    refreshSurpriseLightAssignmentRows();
    queueSurpriseLivePreview();
  });

  if (assignmentModeSelect) {
    assignmentModeSelect.addEventListener('change', () => {
      refreshSurpriseLightAssignmentRows();
      queueSurpriseLivePreview();
    });
  }

  if (transitionSelect) {
    transitionSelect.addEventListener('change', () => queueSurpriseLivePreview());
  }

  if (livePreviewToggle) {
    livePreviewToggle.addEventListener('change', () => {
      if (livePreviewToggle.checked) queueSurpriseLivePreview();
    });
  }

  if (minBrightness) {
    minBrightness.addEventListener('input', () => {
      applyBrightnessConstraintsToModalSwatches();
      queueSurpriseLivePreview();
    });
  }
  if (maxBrightness) {
    maxBrightness.addEventListener('input', () => {
      applyBrightnessConstraintsToModalSwatches();
      queueSurpriseLivePreview();
    });
  }

  if (templateApplyBtn) {
    templateApplyBtn.addEventListener('click', () => {
      const styleId = templateSelect?.value || '';
      if (!styleId) return;
      const style = surpriseStyles.find((entry) => entry.id === styleId);
      const palette = (style?.samplePalette || ['#c8d8ff', '#f6b8d0', '#c4f0dd'])
        .slice(0, 6)
        .map((hex) => ({ hex, brightness: 75 }));
      setSurprisePaletteInModal(palette);
      applyBrightnessConstraintsToModalSwatches();
      queueSurpriseLivePreview();
    });
  }

  if (savePaletteBtn) {
    savePaletteBtn.addEventListener('click', () => {
      const name = String(paletteNameInput?.value || '').trim();
      if (!name) {
        alert('Enter a palette name to save.');
        return;
      }
      const palette = getSurprisePaletteFromModal();
      const library = loadSurprisePaletteLibrary();
      const existingIndex = library.findIndex((entry) => String(entry.name || '').toLowerCase() === name.toLowerCase());
      const next = { name, palette, updatedAt: Date.now() };
      if (existingIndex >= 0) {
        library[existingIndex] = next;
      } else {
        library.push(next);
      }
      saveSurprisePaletteLibrary(library);
      refreshSavedPaletteSelect();
      if (savedPaletteSelect) savedPaletteSelect.value = String(existingIndex >= 0 ? existingIndex : library.length - 1);
    });
  }

  if (loadPaletteBtn) {
    loadPaletteBtn.addEventListener('click', () => {
      const library = loadSurprisePaletteLibrary();
      const index = parseInt(savedPaletteSelect?.value || '-1', 10);
      if (!Number.isFinite(index) || index < 0 || index >= library.length) return;
      setSurprisePaletteInModal(library[index].palette || []);
      applyBrightnessConstraintsToModalSwatches();
      queueSurpriseLivePreview();
    });
  }

  if (deletePaletteBtn) {
    deletePaletteBtn.addEventListener('click', () => {
      const library = loadSurprisePaletteLibrary();
      const index = parseInt(savedPaletteSelect?.value || '-1', 10);
      if (!Number.isFinite(index) || index < 0 || index >= library.length) return;
      library.splice(index, 1);
      saveSurprisePaletteLibrary(library);
      refreshSavedPaletteSelect();
    });
  }

  document.getElementById('surprise-light-assignments').addEventListener('change', () => {
    queueSurpriseLivePreview();
  });

  saveBtn.addEventListener('click', async () => {
    if (!editingSurpriseScene) return;

    const name = document.getElementById('surprise-editor-name').value.trim() || editingSurpriseScene.name;
    const palette = getSurprisePaletteFromModal();
    const assignmentData = getSurpriseLightAssignmentsFromModal();
    const transitionMs = parseInt(transitionSelect?.value || '0', 10) || 0;

    if (palette.length < 2) {
      alert('Please choose at least 2 swatches.');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const styleId = styleSelect?.value || null;
      const res = await fetch(`/api/rooms/${roomId}/surprise/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseSceneId: editingSurpriseScene.id,
          styleId,
          name,
          palette,
          replaceExisting: true,
          assignmentMode: assignmentData.assignmentMode,
          lightAssignments: assignmentData.lightAssignments,
          transitionMs
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to edit surprise scene');

      const meta = loadSurpriseSceneMeta(roomId);
      let preservedAnimationSceneId = null;
      let preservedIsAnimating = false;
      let preservedIsPaused = false;
      let preservedAnimationOptions = null;
      if (data.replacedSceneId && meta[data.replacedSceneId]) {
        preservedAnimationSceneId = meta[data.replacedSceneId].animationSceneId || null;
        preservedIsAnimating = !!meta[data.replacedSceneId].isAnimating;
        preservedIsPaused = !!meta[data.replacedSceneId].isPaused;
        preservedAnimationOptions = meta[data.replacedSceneId].animationOptions || null;
        delete meta[data.replacedSceneId];
      }
      meta[data.sceneId] = {
        sceneName: data.sceneName,
        styleId: data.style?.id || styleId || null,
        palette: data.palette,
        animationSceneId: preservedAnimationSceneId,
        isAnimating: preservedIsAnimating,
        isPaused: preservedIsPaused,
        animationOptions: preservedAnimationOptions,
        assignmentMode: assignmentData.assignmentMode,
        lightAssignments: assignmentData.lightAssignments,
        transitionMs,
        updatedAt: Date.now()
      };
      saveSurpriseSceneMeta(roomId, meta);

      closeSurpriseEditor();
      setTimeout(fetchAndRenderRoom, 500);
    } catch (error) {
      alert(`Could not edit surprise scene: ${error.message}`);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Surprise';
    }
  });
}

function initSceneControls() {
  const grid = document.getElementById('scenes-grid');
  const saveBtn = document.getElementById('save-scene-btn');
  const saveInput = document.getElementById('save-scene-input');
  const surpriseSelect = document.getElementById('surprise-style-select');
  const surpriseSpeedSelect = document.getElementById('surprise-speed-select');
  const surpriseDirectionSelect = document.getElementById('surprise-anim-direction');
  const surprisePatternSelect = document.getElementById('surprise-anim-pattern');
  const surpriseBtn = document.getElementById('surprise-scene-btn');

  // Activate scene
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.scene-activate-btn');
    if (!btn) return;
    const sceneId = btn.dataset.sceneId;
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const res = await fetch(`/api/rooms/${roomId}/scene`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');
      btn.textContent = 'Activated!';
      setTimeout(() => { btn.textContent = 'Activate'; btn.disabled = false; }, 1500);
      // Refresh after a short delay to show new state
      setTimeout(fetchAndRenderRoom, 800);
    } catch (err) {
      btn.textContent = 'Error';
      setTimeout(() => { btn.textContent = 'Activate'; btn.disabled = false; }, 2000);
    }
  });

  // Rename non-surprise scene
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.scene-rename-btn');
    if (!btn) return;
    const sceneId = btn.dataset.sceneId;
    const scene = (roomData?.scenes || []).find((entry) => entry.id === sceneId);
    if (!scene) return;

    const currentName = scene.name || '';
    const nextNameRaw = prompt('Enter a new scene name:', currentName);
    if (nextNameRaw == null) return;
    const nextName = nextNameRaw.trim();
    if (!nextName || nextName === currentName) return;

    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const res = await fetch(`/api/scenes/${sceneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to update scene');

      btn.textContent = 'Saved';
      setTimeout(() => {
        btn.textContent = 'Rename';
        btn.disabled = false;
      }, 1100);
      setTimeout(fetchAndRenderRoom, 300);
    } catch (err) {
      btn.textContent = 'Error';
      setTimeout(() => {
        btn.textContent = 'Rename';
        btn.disabled = false;
      }, 1800);
      alert(`Could not edit scene: ${err.message}`);
    }
  });

  // Edit surprise with custom swatches (colors + brightness)
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.scene-edit-btn');
    if (!btn) return;
    openSurpriseEditor(btn.dataset.sceneId);
  });

  // Animate surprise scene using dynamic palette rotation and preset speed
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.scene-animate-btn');
    if (!btn) return;

    if (!v2RoomInfo) {
      alert('Surprise animation requires Hue API v2 support for this room.');
      return;
    }

    const surpriseScene = (roomData?.scenes || []).find((scene) => scene.id === btn.dataset.sceneId);
    if (!surpriseScene) return;

    const meta = loadSurpriseSceneMeta(roomId);
    const storedMeta = meta[surpriseScene.id] || null;
    const basePalette = getDefaultSurprisePalette(surpriseScene);
    if (!Array.isArray(basePalette) || basePalette.length < 2) {
      alert('Could not animate surprise scene: no usable palette found.');
      return;
    }

    const direction = getSelectedSurpriseAnimationDirection();
    const pattern = getSelectedSurpriseAnimationPattern();
    const animatedPalette = applyAnimationPattern(basePalette, direction, pattern);
    const speed = getSelectedSurpriseAnimationSpeed();
    const animationName = `${surpriseScene.name} Animation`.slice(0, 32);

    btn.disabled = true;
    btn.textContent = 'Animating...';
    try {
      let animationSceneId = storedMeta?.animationSceneId || null;
      let reusedExistingAnimation = false;

      if (animationSceneId) {
        const recallRes = await fetch(`/api/v2/scenes/${animationSceneId}/recall`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'dynamic_palette', speed })
        });
        const recallData = await recallRes.json();
        if (recallData.success) {
          reusedExistingAnimation = true;
        } else {
          animationSceneId = null;
        }
      }

      if (!reusedExistingAnimation) {
        const createRes = await fetch(`/api/v2/rooms/${roomId}/dynamic-scene`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: animationName,
            palette: animatedPalette,
            speed
          })
        });
        const createData = await createRes.json();
        if (!createData.success) {
          throw new Error(createData.error || createData.errors?.[0]?.description || 'Failed to animate surprise');
        }
        animationSceneId = createData.sceneId;
      }

      const nextMeta = {
        sceneName: storedMeta?.sceneName || surpriseScene.name,
        styleId: storedMeta?.styleId || null,
        palette: storedMeta?.palette || basePalette,
        animationSceneId,
        isAnimating: true,
        isPaused: false,
        animationOptions: {
          speed,
          direction,
          pattern
        },
        updatedAt: Date.now()
      };
      meta[surpriseScene.id] = nextMeta;
      saveSurpriseSceneMeta(roomId, meta);

      upsertDynamicSceneStorage(animationSceneId, animationName, animatedPalette, speed);
      activeDynamicSceneId = animationSceneId;
      setSurpriseAnimatingByAnimationScene(animationSceneId, true);
      renderDynamicScenesList();
      renderScenes(roomData?.scenes || []);

      btn.textContent = 'Looping';
      btn.disabled = false;
    } catch (err) {
      btn.textContent = 'Error';
      setTimeout(() => {
        btn.textContent = 'Animate';
        btn.disabled = false;
      }, 2000);
      alert(`Could not animate surprise scene: ${err.message}`);
    }
  });

  // Pause surprise animation
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.scene-pause-btn');
    if (!btn) return;
    const scene = (roomData?.scenes || []).find((entry) => entry.id === btn.dataset.sceneId);
    if (!scene) return;
    const meta = loadSurpriseSceneMeta(roomId);
    const sceneMeta = meta[scene.id] || {};
    const animationSceneId = sceneMeta.animationSceneId || null;
    if (!animationSceneId) {
      alert('No animation scene is linked to this surprise yet.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Pausing...';
    try {
      const res = await fetch(`/api/v2/scenes/${animationSceneId}/recall`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'active' })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || data.errors?.[0]?.description || 'Failed to pause');
      sceneMeta.isAnimating = false;
      sceneMeta.isPaused = true;
      sceneMeta.updatedAt = Date.now();
      meta[scene.id] = sceneMeta;
      saveSurpriseSceneMeta(roomId, meta);
      if (activeDynamicSceneId === animationSceneId) activeDynamicSceneId = null;
      renderDynamicScenesList();
      renderScenes(roomData?.scenes || []);
    } catch (error) {
      alert(`Could not pause surprise animation: ${error.message}`);
    } finally {
      btn.textContent = 'Pause';
      btn.disabled = false;
    }
  });

  // Resume surprise animation
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.scene-resume-btn');
    if (!btn) return;
    const scene = (roomData?.scenes || []).find((entry) => entry.id === btn.dataset.sceneId);
    if (!scene) return;
    const meta = loadSurpriseSceneMeta(roomId);
    const sceneMeta = meta[scene.id] || {};
    const animationSceneId = sceneMeta.animationSceneId || null;
    if (!animationSceneId) {
      alert('No paused animation scene is linked to this surprise.');
      return;
    }
    const speed = clampNumber(parseFloat(sceneMeta.animationOptions?.speed) || getSelectedSurpriseAnimationSpeed(), 0.1, 1);

    btn.disabled = true;
    btn.textContent = 'Resuming...';
    try {
      const res = await fetch(`/api/v2/scenes/${animationSceneId}/recall`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dynamic_palette', speed })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || data.errors?.[0]?.description || 'Failed to resume');
      sceneMeta.isAnimating = true;
      sceneMeta.isPaused = false;
      sceneMeta.updatedAt = Date.now();
      meta[scene.id] = sceneMeta;
      saveSurpriseSceneMeta(roomId, meta);
      activeDynamicSceneId = animationSceneId;
      renderDynamicScenesList();
      renderScenes(roomData?.scenes || []);
    } catch (error) {
      alert(`Could not resume surprise animation: ${error.message}`);
    } finally {
      btn.textContent = 'Resume';
      btn.disabled = false;
    }
  });

  // Stop surprise animation for this scene's dedicated dynamic scene
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.scene-stop-btn');
    if (!btn) return;

    const surpriseScene = (roomData?.scenes || []).find((scene) => scene.id === btn.dataset.sceneId);
    if (!surpriseScene) return;

    const meta = loadSurpriseSceneMeta(roomId);
    const animationSceneId = meta[surpriseScene.id]?.animationSceneId || null;
    if (!animationSceneId) {
      alert('No running surprise animation is linked to this scene yet.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Stopping...';
    try {
      const stopRes = await fetch(`/api/v2/scenes/${animationSceneId}/recall`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'active' })
      });
      const stopData = await stopRes.json();
      if (!stopData.success) {
        throw new Error(stopData.error || stopData.errors?.[0]?.description || 'Failed to stop surprise animation');
      }

      if (activeDynamicSceneId === animationSceneId) {
        activeDynamicSceneId = null;
      }
      setSurpriseAnimatingByAnimationScene(animationSceneId, false, false);
      const sceneMeta = meta[surpriseScene.id] || {};
      sceneMeta.isAnimating = false;
      sceneMeta.isPaused = false;
      sceneMeta.updatedAt = Date.now();
      meta[surpriseScene.id] = sceneMeta;
      saveSurpriseSceneMeta(roomId, meta);
      renderDynamicScenesList();
      renderScenes(roomData?.scenes || []);

      btn.textContent = 'Stopped';
      setTimeout(() => {
        btn.textContent = 'Stop';
        btn.disabled = false;
      }, 1300);
    } catch (err) {
      btn.textContent = 'Error';
      setTimeout(() => {
        btn.textContent = 'Stop';
        btn.disabled = false;
      }, 2000);
      alert(`Could not stop surprise animation: ${err.message}`);
    }
  });

  // Remix existing surprise scene into a new one
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.scene-remix-btn');
    if (!btn) return;

    const baseSceneId = btn.dataset.sceneId;
    const styleId = surpriseSelect?.value || null;
    btn.disabled = true;
    btn.textContent = 'Remixing...';

    try {
      const res = await fetch(`/api/rooms/${roomId}/surprise/remix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseSceneId, styleId })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to remix surprise');

      upsertSurpriseSceneMeta(data.sceneId, data.sceneName, data.style?.id || styleId, data.palette || []);
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        console.warn('Surprise remix created with warnings:', data.warnings);
      }

      btn.textContent = 'Remixed!';
      setTimeout(() => { btn.textContent = 'Remix'; btn.disabled = false; }, 1500);
      setTimeout(fetchAndRenderRoom, 500);
    } catch (err) {
      btn.textContent = 'Error';
      setTimeout(() => { btn.textContent = 'Remix'; btn.disabled = false; }, 2000);
      alert(`Could not remix surprise scene: ${err.message}`);
    }
  });

  // Delete scene
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.scene-delete-btn');
    if (!btn) return;
    const sceneId = btn.dataset.sceneId;
    const card = btn.closest('.scene-card');
    const name = card?.querySelector('.scene-card-name')?.textContent || 'this scene';
    if (!confirm(`Delete scene "${name}"?`)) return;

    btn.disabled = true;
    try {
      const res = await fetch(`/api/scenes/${sceneId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');
      card?.remove();
      if (!document.getElementById('scenes-grid').querySelector('.scene-card')) {
        document.getElementById('scenes-grid').innerHTML = '<p class="no-items-msg">No scenes saved for this room.</p>';
      }
    } catch (err) {
      btn.disabled = false;
      alert(`Could not delete scene: ${err.message}`);
    }
  });

  // Save current as new scene
  saveInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
  });

  saveBtn.addEventListener('click', async () => {
    const name = saveInput.value.trim();
    if (!name) { saveInput.focus(); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      const res = await fetch(`/api/rooms/${roomId}/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');
      saveInput.value = '';
      saveBtn.textContent = 'Saved!';
      setTimeout(() => { saveBtn.textContent = 'Save Current'; saveBtn.disabled = false; }, 1500);
      // Refresh scenes list
      setTimeout(fetchAndRenderRoom, 500);
    } catch (err) {
      saveBtn.textContent = 'Error';
      setTimeout(() => { saveBtn.textContent = 'Save Current'; saveBtn.disabled = false; }, 2000);
      alert(`Could not save scene: ${err.message}`);
    }
  });

  if (surpriseSelect) {
    surpriseSelect.addEventListener('change', () => {
      const selected = surpriseStyles.find((style) => style.id === surpriseSelect.value);
      renderSurpriseStylePreview(selected || null);
    });
  }

  if (surpriseSpeedSelect && !surpriseSpeedSelect.value) {
    surpriseSpeedSelect.value = String(SURPRISE_DEFAULT_ANIMATION_SPEED);
  }
  if (surpriseDirectionSelect && !surpriseDirectionSelect.value) {
    surpriseDirectionSelect.value = 'forward';
  }
  if (surprisePatternSelect && !surprisePatternSelect.value) {
    surprisePatternSelect.value = 'rotate';
  }

  if (surpriseBtn) {
    surpriseBtn.addEventListener('click', async () => {
      const styleId = surpriseSelect?.value;
      if (!styleId) return;

      surpriseBtn.disabled = true;
      surpriseBtn.textContent = 'Creating...';

      try {
        const res = await fetch(`/api/rooms/${roomId}/surprise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ styleId })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to create surprise scene');

        upsertSurpriseSceneMeta(data.sceneId, data.sceneName, data.style?.id || styleId, data.palette || []);
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          console.warn('Surprise scene created with warnings:', data.warnings);
        }

        surpriseBtn.textContent = 'Created!';
        setTimeout(() => {
          surpriseBtn.textContent = 'Create Surprise';
          surpriseBtn.disabled = false;
        }, 1500);
        setTimeout(fetchAndRenderRoom, 500);
      } catch (err) {
        surpriseBtn.textContent = 'Error';
        setTimeout(() => {
          surpriseBtn.textContent = 'Create Surprise';
          surpriseBtn.disabled = false;
        }, 2000);
        alert(`Could not create surprise scene: ${err.message}`);
      }
    });
  }

  loadSurpriseStyles();
}

// ── Animation Effects (Hue API v2) ────────────────────────────────

// v2 IDs for this room — resolved once on init
let v2RoomInfo = null; // { roomV2Id, groupedLightId, lightIdMap }
let activeDynamicSceneId = null; // sceneId currently looping on the bridge

const EFFECTS = [
  { id: 'candle',     label: '🕯 Candle' },
  { id: 'fire',       label: '🔥 Fire' },
  { id: 'sparkle',    label: '✨ Sparkle' },
  { id: 'colorloop',  label: '🌈 Colorloop' },
  { id: 'cosmos',     label: '🌌 Cosmos' },
  { id: 'enchant',    label: '🪄 Enchant' },
  { id: 'sunbeam',    label: '☀️ Sunbeam' },
  { id: 'underwater', label: '🐠 Underwater' },
  { id: 'no_effect',  label: '⏹ Stop', isStop: true }
];

function speedLabel(value) {
  if (value <= 20) return 'Very Slow';
  if (value <= 40) return 'Slow';
  if (value <= 60) return 'Medium';
  if (value <= 80) return 'Fast';
  return 'Very Fast';
}

// localStorage helpers
function loadAnimScenes(rid) {
  try {
    return JSON.parse(localStorage.getItem(`hueV2Scenes_${rid}`) || '[]');
  } catch { return []; }
}
function saveAnimScenes(rid, scenes) {
  localStorage.setItem(`hueV2Scenes_${rid}`, JSON.stringify(scenes));
}

function renderDynamicSceneCard(scene) {
  const speed = Math.round((scene.speed || 0.5) * 100);
  const isPlaying = activeDynamicSceneId === scene.sceneId;
  return `
    <div class="anim-scene-card${isPlaying ? ' is-playing' : ''}" data-scene-id="${escapeHtml(scene.sceneId)}">
      <div class="anim-scene-info">
        <span class="anim-scene-name">${escapeHtml(scene.name)}</span>
        <span class="anim-scene-speed-badge">${speedLabel(speed)}</span>
      </div>
      <div class="anim-scene-palette">
        ${(scene.palette || []).map(p => `<span class="anim-palette-dot" style="background:${escapeHtml(p.hex)}"></span>`).join('')}
      </div>
      <div class="anim-scene-actions">
        <button class="anim-play-btn${isPlaying ? ' is-playing' : ''}" data-scene-id="${escapeHtml(scene.sceneId)}" data-speed="${scene.speed || 0.5}">${isPlaying ? '● Looping' : '▶ Play'}</button>
        <button class="anim-stop-btn" data-scene-id="${escapeHtml(scene.sceneId)}">■ Stop</button>
        <button class="anim-delete-scene-btn" data-scene-id="${escapeHtml(scene.sceneId)}" title="Delete">×</button>
      </div>
    </div>
  `;
}

function renderDynamicScenesList() {
  const list = document.getElementById('anim-dynamic-scenes-list');
  if (!list) return;
  const scenes = loadAnimScenes(roomId);
  if (scenes.length === 0) {
    list.innerHTML = '<p class="no-items-msg">No dynamic scenes saved yet.</p>';
  } else {
    list.innerHTML = scenes.map(renderDynamicSceneCard).join('');
  }
}

function renderEffectChips() {
  const row = document.getElementById('anim-room-effects');
  if (!row) return;
  row.innerHTML = EFFECTS.map(e => `
    <button class="anim-effect-chip${e.isStop ? ' stop-chip' : ''}" data-effect="${e.id}">
      ${e.label}
    </button>
  `).join('');
}

async function initAnimationSection() {
  // Fetch v2 room info — if bridge doesn't support v2 hide the section gracefully
  const animSection = document.getElementById('anim-section');
  try {
    const res = await fetch(`/api/v2/rooms/${roomId}/info`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'v2 not available');
    v2RoomInfo = { roomV2Id: data.roomV2Id, groupedLightId: data.groupedLightId, lightIdMap: data.lightIdMap };
  } catch (err) {
    console.warn('Hue v2 API not available for this room:', err.message);
    if (animSection) {
      animSection.querySelector('p.anim-section-hint').textContent = `Animation effects unavailable: ${err.message}`;
      animSection.querySelector('#anim-room-effects').style.display = 'none';
      animSection.querySelector('.anim-builder').style.display = 'none';
    }
    return;
  }

  renderEffectChips();
  renderDynamicScenesList();

  // Effect chip clicks — apply effect to whole room
  const effectsRow = document.getElementById('anim-room-effects');
  effectsRow.addEventListener('click', async (e) => {
    const btn = e.target.closest('.anim-effect-chip');
    if (!btn) return;
    const effect = btn.dataset.effect;

    // Visual feedback
    effectsRow.querySelectorAll('.anim-effect-chip').forEach(b => b.classList.remove('active'));
    if (!btn.classList.contains('stop-chip')) btn.classList.add('active');

    btn.disabled = true;
    try {
      const res = await fetch(`/api/v2/rooms/${roomId}/effect`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ effect })
      });
      const data = await res.json();
      if (!data.success) throw new Error((data.errors?.[0]?.description) || 'Failed');
    } catch (err) {
      console.error('Effect error:', err.message);
      effectsRow.querySelectorAll('.anim-effect-chip').forEach(b => b.classList.remove('active'));
    } finally {
      btn.disabled = false;
    }
  });

  // Dynamic scene list — play / stop / delete
  const scenesList = document.getElementById('anim-dynamic-scenes-list');
  scenesList.addEventListener('click', async (e) => {
    // Play — starts looping animation on bridge; stays in "Looping" state until stopped
    const playBtn = e.target.closest('.anim-play-btn');
    if (playBtn) {
      const sceneId = playBtn.dataset.sceneId;
      const speed = parseFloat(playBtn.dataset.speed) || 0.5;
      playBtn.disabled = true;
      playBtn.textContent = '...';
      try {
        const res = await fetch(`/api/v2/scenes/${sceneId}/recall`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'dynamic_palette', speed })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || (data.errors?.[0]?.description) || 'Failed');
        activeDynamicSceneId = sceneId;
        setSurpriseAnimatingByAnimationScene(sceneId, true);
        renderDynamicScenesList(); // re-render all cards to show looping state
        renderScenes(roomData?.scenes || []);
      } catch (err) {
        console.error('Play error:', err.message);
        playBtn.textContent = '▶ Play';
        playBtn.disabled = false;
      }
      return;
    }

    // Stop — recalls scene statically, clearing the loop
    const stopBtn = e.target.closest('.anim-stop-btn');
    if (stopBtn) {
      const sceneId = stopBtn.dataset.sceneId;
      stopBtn.disabled = true;
      try {
        await fetch(`/api/v2/scenes/${sceneId}/recall`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'active' })
        });
        if (activeDynamicSceneId === sceneId) {
          activeDynamicSceneId = null;
          renderDynamicScenesList();
        }
        setSurpriseAnimatingByAnimationScene(sceneId, false, false);
        renderScenes(roomData?.scenes || []);
      } catch (err) {
        console.error('Stop error:', err.message);
      } finally {
        stopBtn.disabled = false;
      }
      return;
    }

    // Delete
    const delBtn = e.target.closest('.anim-delete-scene-btn');
    if (delBtn) {
      const sceneId = delBtn.dataset.sceneId;
      const card = delBtn.closest('.anim-scene-card');
      const name = card?.querySelector('.anim-scene-name')?.textContent || 'this scene';
      if (!confirm(`Delete dynamic scene "${name}"?\nThis will also remove it from the Hue Bridge.`)) return;

      delBtn.disabled = true;
      try {
        await fetch(`/api/v2/scenes/${sceneId}`, { method: 'DELETE' });
        // Remove from localStorage regardless of bridge result
        const scenes = loadAnimScenes(roomId).filter(s => s.sceneId !== sceneId);
        saveAnimScenes(roomId, scenes);
        renderDynamicScenesList();
      } catch (err) {
        console.error('Delete error:', err.message);
        delBtn.disabled = false;
      }
    }
  });
}

// ── Animation builder modal ────────────────────────────────────────

const DEFAULT_FRAME_COLORS = ['#c45cff', '#3c8fff', '#5cffc4'];
let editingSceneIndex = -1; // -1 = new scene

function makeFrameRow(hex = '#ffffff', brightness = 80) {
  const row = document.createElement('div');
  row.className = 'anim-frame-row';
  row.innerHTML = `
    <span class="anim-frame-swatch" style="background:${escapeHtml(hex)}"></span>
    <input type="color" class="anim-frame-color" value="${escapeHtml(hex)}">
    <label class="anim-frame-bri-label">
      <span>Brightness</span>
      <input type="range" class="anim-frame-bri" min="1" max="100" value="${brightness}">
      <span class="anim-frame-bri-val">${brightness}%</span>
    </label>
    <button class="anim-frame-remove" title="Remove color">×</button>
  `;

  const colorInput = row.querySelector('.anim-frame-color');
  const swatch = row.querySelector('.anim-frame-swatch');
  const briSlider = row.querySelector('.anim-frame-bri');
  const briVal = row.querySelector('.anim-frame-bri-val');
  const removeBtn = row.querySelector('.anim-frame-remove');

  colorInput.addEventListener('input', () => {
    swatch.style.background = colorInput.value;
  });
  briSlider.addEventListener('input', () => {
    briVal.textContent = briSlider.value + '%';
  });
  removeBtn.addEventListener('click', () => {
    const framesList = document.getElementById('anim-frames-list');
    if (framesList.querySelectorAll('.anim-frame-row').length > 2) {
      row.remove();
      updateFrameRemovability();
    }
  });

  return row;
}

function updateFrameRemovability() {
  const rows = document.getElementById('anim-frames-list').querySelectorAll('.anim-frame-row');
  rows.forEach(r => {
    r.querySelector('.anim-frame-remove').disabled = rows.length <= 2;
  });
}

function openAnimModal(scene = null) {
  const modal = document.getElementById('anim-builder-modal');
  const title = document.getElementById('anim-modal-title');
  const nameInput = document.getElementById('anim-scene-name');
  const framesList = document.getElementById('anim-frames-list');
  const speedSlider = document.getElementById('anim-speed-slider');
  const speedLabelEl = document.getElementById('anim-speed-label');

  framesList.innerHTML = '';

  if (scene) {
    title.textContent = 'Edit Dynamic Scene';
    nameInput.value = scene.name;
    const speedVal = Math.round((scene.speed || 0.5) * 100);
    speedSlider.value = speedVal;
    speedLabelEl.textContent = speedLabel(speedVal);
    (scene.palette || []).forEach(p => framesList.appendChild(makeFrameRow(p.hex, p.brightness || 80)));
    editingSceneIndex = loadAnimScenes(roomId).findIndex(s => s.sceneId === scene.sceneId);
  } else {
    title.textContent = 'New Dynamic Scene';
    nameInput.value = '';
    speedSlider.value = 40;
    speedLabelEl.textContent = speedLabel(40);
    DEFAULT_FRAME_COLORS.forEach(hex => framesList.appendChild(makeFrameRow(hex)));
    editingSceneIndex = -1;
  }

  updateFrameRemovability();
  modal.classList.add('active');
  nameInput.focus();
}

function closeAnimModal() {
  document.getElementById('anim-builder-modal').classList.remove('active');
}

function initAnimBuilderModal() {
  const modal = document.getElementById('anim-builder-modal');
  const closeBtn = document.getElementById('anim-modal-close');
  const cancelBtn = document.getElementById('anim-cancel-btn');
  const addFrameBtn = document.getElementById('anim-add-frame-btn');
  const speedSlider = document.getElementById('anim-speed-slider');
  const speedLabelEl = document.getElementById('anim-speed-label');
  const saveBtn = document.getElementById('anim-save-btn');
  const newSceneBtn = document.getElementById('anim-new-scene-btn');

  // Open modal for new scene
  newSceneBtn.addEventListener('click', () => openAnimModal());

  // Close
  closeBtn.addEventListener('click', closeAnimModal);
  cancelBtn.addEventListener('click', closeAnimModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAnimModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) closeAnimModal();
  });

  // Speed slider label
  speedSlider.addEventListener('input', () => {
    speedLabelEl.textContent = speedLabel(parseInt(speedSlider.value));
  });

  // Add frame
  addFrameBtn.addEventListener('click', () => {
    const framesList = document.getElementById('anim-frames-list');
    if (framesList.querySelectorAll('.anim-frame-row').length >= 6) return;
    framesList.appendChild(makeFrameRow());
    updateFrameRemovability();
  });

  // Save
  saveBtn.addEventListener('click', async () => {
    const nameInput = document.getElementById('anim-scene-name');
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }

    const frameRows = document.getElementById('anim-frames-list').querySelectorAll('.anim-frame-row');
    const palette = Array.from(frameRows).map(row => ({
      hex: row.querySelector('.anim-frame-color').value,
      brightness: parseInt(row.querySelector('.anim-frame-bri').value)
    }));
    const speed = parseInt(document.getElementById('anim-speed-slider').value) / 100;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      // If editing, delete the old bridge scene first
      if (editingSceneIndex >= 0) {
        const existing = loadAnimScenes(roomId)[editingSceneIndex];
        if (existing?.sceneId) {
          await fetch(`/api/v2/scenes/${existing.sceneId}`, { method: 'DELETE' }).catch(() => {});
        }
      }

      const res = await fetch(`/api/v2/rooms/${roomId}/dynamic-scene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, palette, speed })
      });
      const data = await res.json();
      if (!data.success) throw new Error((data.errors?.[0]?.description) || data.error || 'Failed');

      // Persist to localStorage
      const scenes = loadAnimScenes(roomId);
      const sceneEntry = { sceneId: data.sceneId, name, palette, speed };
      if (editingSceneIndex >= 0) {
        scenes[editingSceneIndex] = sceneEntry;
      } else {
        scenes.push(sceneEntry);
      }
      saveAnimScenes(roomId, scenes);
      renderDynamicScenesList();
      closeAnimModal();
    } catch (err) {
      saveBtn.textContent = 'Error — retry?';
      alert(`Could not save dynamic scene: ${err.message}`);
      setTimeout(() => { saveBtn.textContent = 'Save & Play'; saveBtn.disabled = false; }, 2000);
      return;
    }

    saveBtn.textContent = 'Save & Play';
    saveBtn.disabled = false;
  });
}

// ── Init ──────────────────────────────────────────────────────────

async function init() {
  const params = new URLSearchParams(window.location.search);
  roomId = params.get('id');
  if (!roomId) {
    showError('No room ID specified. Go back to the lights page.');
    return;
  }

  initLightControls();
  initRoomBrightness();
  initSceneControls();
  initSurpriseEditorModal();
  initAnimBuilderModal();
  initDimmerModal();
  initRoomOpsModePicker();

  await fetchAndRenderRoom();
  refreshIntervalId = setInterval(fetchAndRenderRoom, REFRESH_INTERVAL);

  // Init animation section after initial render (non-blocking)
  initAnimationSection();
}

document.addEventListener('DOMContentLoaded', init);
