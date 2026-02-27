// Hue Room Detail Page
// Displays all lights with full inline controls, scenes, and automations for a single room

const REFRESH_INTERVAL = 10000;
let refreshIntervalId = null;
let roomId = null;
let roomData = null;
const lightInputActive = {};   // true while user is dragging/editing a light control
const lightSendTimeouts = {};  // debounce timers per light
let roomColorWheel = null;

// Room brightness slider state
let roomBriSliderActive = false;
let roomBriSendTimeout = null;

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

function renderSceneCard(scene) {
  const isAnimated = scene.name.endsWith('-Animation');
  const displayName = isAnimated ? scene.name.slice(0, -'-Animation'.length) : scene.name;
  return `
    <div class="scene-card${isAnimated ? ' scene-animated' : ''}" data-scene-id="${scene.id}">
      <div class="scene-card-name" title="${escapeHtml(scene.name)}">${escapeHtml(displayName)}</div>
      <div class="scene-card-actions">
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

  const animated = scenes.filter(s => s.name.endsWith('-Animation'));
  const staticScenes = scenes.filter(s => !s.name.endsWith('-Animation'));

  let html = '';

  if (staticScenes.length > 0) {
    if (animated.length > 0) {
      html += '<div class="scenes-subsection-title">Scenes</div>';
    }
    html += '<div class="scenes-subgrid">' + staticScenes.map(renderSceneCard).join('') + '</div>';
  }

  if (animated.length > 0) {
    html += '<div class="scenes-subsection-title">Animations</div>';
    html += '<div class="scenes-subgrid">' + animated.map(renderSceneCard).join('') + '</div>';
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

  // Automations
  const autoSection = document.getElementById('automations-section');
  autoSection.classList.remove('hidden');
  renderAutomations(data.schedules, data.rules);

  // Animation effects section — always show (v2 check happens inside initAnimationSection)
  const animSection = document.getElementById('anim-section');
  if (animSection) animSection.classList.remove('hidden');
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
  } catch (error) {
    showError(`Connection error: ${error.message}`);
    updateStatus('error', 'Connection failed');
  }
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

function initSceneControls() {
  const grid = document.getElementById('scenes-grid');

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
  const saveBtn = document.getElementById('save-scene-btn');
  const saveInput = document.getElementById('save-scene-input');

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
        renderDynamicScenesList(); // re-render all cards to show looping state
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
  initAnimBuilderModal();

  await fetchAndRenderRoom();
  refreshIntervalId = setInterval(fetchAndRenderRoom, REFRESH_INTERVAL);

  // Init animation section after initial render (non-blocking)
  initAnimationSection();
}

document.addEventListener('DOMContentLoaded', init);
