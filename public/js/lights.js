// Hue Lights Dashboard
// Fetches light state from the bridge and displays rooms with color swatches

const REFRESH_INTERVAL = 5000;
let refreshIntervalId = null;
const lightDataMap = new Map();
let currentLightId = null;
let sendTimeout = null;
let roomSliderTimeouts = {};    // debounce timers per room
let roomSliderActive = {};      // true while user is dragging a room slider

// ── Color Conversion ─────────────────────────────────────────────

// CIE xy + brightness → RGB (Wide RGB D65 matrix, recommended by Philips)
function xyBriToRgb(x, y, bri) {
  const brightness = bri / 254;
  const z = 1.0 - x - y;
  const Y = brightness;
  const X = (Y / y) * x;
  const Z = (Y / y) * z;

  // Wide RGB D65 conversion
  let r =  X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b =  X * 0.051713 - Y * 0.121364 + Z * 1.011530;

  // Clamp negatives
  r = Math.max(0, r);
  g = Math.max(0, g);
  b = Math.max(0, b);

  // Reverse sRGB companding (gamma correction)
  r = r <= 0.0031308 ? 12.92 * r : 1.055 * Math.pow(r, 1.0 / 2.4) - 0.055;
  g = g <= 0.0031308 ? 12.92 * g : 1.055 * Math.pow(g, 1.0 / 2.4) - 0.055;
  b = b <= 0.0031308 ? 12.92 * b : 1.055 * Math.pow(b, 1.0 / 2.4) - 0.055;

  return {
    r: Math.min(255, Math.max(0, Math.round(r * 255))),
    g: Math.min(255, Math.max(0, Math.round(g * 255))),
    b: Math.min(255, Math.max(0, Math.round(b * 255)))
  };
}

// Mireds → RGB (Tanner Helland algorithm)
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

// Hue (0-65535) + Sat (0-254) + Bri (0-254) → CSS hsl()
function hueSatToCss(hue, sat, bri) {
  const h = Math.round((hue / 65535) * 360);
  const s = Math.round((sat / 254) * 100);
  const l = Math.round((bri / 254) * 50);
  return `hsl(${h}, ${s}%, ${Math.max(l, 10)}%)`;
}

// RGB (0-255) → CIE xy (inverse of xyBriToRgb, Wide RGB D65)
function rgbToXy(r, g, b) {
  let red = r / 255;
  let green = g / 255;
  let blue = b / 255;

  // Apply sRGB gamma correction
  red = red > 0.04045 ? Math.pow((red + 0.055) / 1.055, 2.4) : red / 12.92;
  green = green > 0.04045 ? Math.pow((green + 0.055) / 1.055, 2.4) : green / 12.92;
  blue = blue > 0.04045 ? Math.pow((blue + 0.055) / 1.055, 2.4) : blue / 12.92;

  // Inverse Wide RGB D65 matrix
  const X = red * 0.664511 + green * 0.154324 + blue * 0.162028;
  const Y = red * 0.283881 + green * 0.668433 + blue * 0.047685;
  const Z = red * 0.000088 + green * 0.072310 + blue * 0.986039;

  const sum = X + Y + Z;
  if (sum === 0) return [0.3127, 0.3290]; // D65 white point

  return [X / sum, Y / sum];
}

// Hex color → {r, g, b}
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 255, g: 255, b: 255 };
}

// {r, g, b} → hex string
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

// Unified: pick the right converter based on colormode
function getLightCssColor(light) {
  if (!light.on) {
    return '#555';
  }

  if (!light.colormode) {
    // White-only / dimmable bulb — warm white scaled by brightness
    const pct = light.brightness / 254;
    const r = 255;
    const g = Math.round(200 + pct * 55);
    const b = Math.round(150 + pct * 105);
    return `rgb(${r}, ${g}, ${b})`;
  }

  switch (light.colormode) {
    case 'xy':
      if (light.xy && light.xy.length === 2) {
        const rgb = xyBriToRgb(light.xy[0], light.xy[1], light.brightness);
        return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
      }
      break;
    case 'ct':
      if (light.ct) {
        const rgb = ctToRgb(light.ct);
        return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
      }
      break;
    case 'hs':
      if (light.hue !== undefined && light.sat !== undefined) {
        return hueSatToCss(light.hue, light.sat, light.brightness);
      }
      break;
  }

  return '#ffeedd'; // fallback warm white
}

// ── Utility ──────────────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateStatus(status, text) {
  const indicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  indicator.className = `status-indicator ${status}`;
  statusText.textContent = text;
}

function updateLastUpdateTime() {
  const el = document.getElementById('last-update');
  const now = new Date();
  el.textContent = `Last update: ${now.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })}`;
}

function showError(message) {
  document.getElementById('loading').classList.add('hidden');
  const errorEl = document.getElementById('error');
  errorEl.classList.remove('hidden');
  document.getElementById('error-message').textContent = message;
}

function hideLoading() {
  document.getElementById('loading').classList.add('hidden');
}

function showNoData() {
  document.getElementById('no-data').classList.remove('hidden');
}

// ── Rendering ────────────────────────────────────────────────────

function renderLight(light) {
  lightDataMap.set(light.id, light);

  const color = getLightCssColor(light);
  const brightnessPercent = Math.round((light.brightness / 254) * 100);
  const statusClass = light.on ? 'light-on' : 'light-off';
  const reachableClass = light.reachable ? '' : 'light-unreachable';

  return `
    <div class="light-item ${statusClass} ${reachableClass}" data-light-id="${light.id}">
      <div class="light-swatch" style="background: ${color}; --swatch-color: ${color};"></div>
      <div class="light-info">
        <span class="light-name">${escapeHtml(light.name)}</span>
        <span class="light-brightness">${light.on ? brightnessPercent + '%' : 'Off'}</span>
      </div>
      ${!light.reachable ? '<span class="light-unreachable-badge">Unreachable</span>' : ''}
    </div>
  `;
}

function renderRooms(rooms) {
  const container = document.getElementById('rooms-container');

  const currentIds = new Set();

  for (const room of rooms) {
    const cardId = `room-${room.id}`;
    currentIds.add(cardId);

    let card = document.getElementById(cardId);
    const isNew = !card;
    if (isNew) {
      card = document.createElement('div');
      card.className = 'room-card';
      card.id = cardId;
      container.appendChild(card);
    }

    const onCount = room.lights.filter(l => l.on).length;
    const totalCount = room.lights.length;

    // Calculate average brightness of reachable, on lights
    const onReachable = room.lights.filter(l => l.on && l.reachable);
    const avgBri = onReachable.length > 0
      ? Math.round(onReachable.reduce((sum, l) => sum + l.brightness, 0) / onReachable.length)
      : 0;
    const avgPercent = Math.round((avgBri / 254) * 100);

    // Skip full rebuild if user is actively dragging the room slider
    if (!isNew && roomSliderActive[room.id]) {
      // Update only the light count and lights grid, leave slider alone
      const countEl = card.querySelector('.room-light-count');
      if (countEl) countEl.textContent = `${onCount}/${totalCount} on`;
      const grid = card.querySelector('.lights-grid');
      if (grid) grid.innerHTML = room.lights.map(light => renderLight(light)).join('');
      continue;
    }

    card.innerHTML = `
      <div class="room-header room-header-link" data-room-id="${room.id}" title="Open ${escapeHtml(room.name)} detail">
        <div class="room-name">${escapeHtml(room.name)}</div>
        <span class="room-light-count">${onCount}/${totalCount} on</span>
        <span class="room-detail-arrow">&#8250;</span>
      </div>
      <div class="room-brightness-control">
        <label>Room Brightness: <span class="room-bri-value">${avgPercent}%</span></label>
        <input type="range" class="room-brightness-slider" min="1" max="254" value="${avgBri || 1}" data-room-id="${room.id}">
      </div>
      <div class="lights-grid">
        ${room.lights.map(light => renderLight(light)).join('')}
      </div>
    `;
  }

  // Remove stale cards
  for (const card of container.querySelectorAll('.room-card')) {
    if (!currentIds.has(card.id)) {
      card.remove();
    }
  }
}

// ── Data Fetching ────────────────────────────────────────────────

async function fetchAndRenderLights() {
  try {
    const response = await fetch('/api/lights');
    const data = await response.json();

    if (!data.success) {
      showError(data.error || 'Failed to fetch light data');
      updateStatus('error', 'Error');
      return;
    }

    hideLoading();
    document.getElementById('error').classList.add('hidden');
    document.getElementById('no-data').classList.add('hidden');

    if (data.rooms.length === 0) {
      showNoData();
      updateStatus('active', 'No lights');
      return;
    }

    const totalLights = data.rooms.reduce((sum, r) => sum + r.lights.length, 0);
    const totalOn = data.rooms.reduce((sum, r) => sum + r.lights.filter(l => l.on).length, 0);
    updateStatus('active', `${totalOn}/${totalLights} lights on`);
    updateLastUpdateTime();
    renderRooms(data.rooms);
  } catch (error) {
    showError(`Connection error: ${error.message}`);
    updateStatus('error', 'Connection failed');
  }
}

// ── Light Control Modal ──────────────────────────────────────────

function isFullColorLight(type) {
  return type === 'Extended color light' || type === 'Color light';
}

function isCTLight(type) {
  return type === 'Color temperature light';
}

function openLightModal(light) {
  currentLightId = light.id;

  const modal = document.getElementById('light-control-modal');

  // Title
  document.getElementById('light-modal-title').textContent = light.name;

  // Power
  const powerToggle = document.getElementById('light-power-toggle');
  powerToggle.checked = light.on;
  document.getElementById('light-power-label').textContent = light.on ? 'On' : 'Off';

  // Brightness
  const brightnessSlider = document.getElementById('light-brightness-slider');
  brightnessSlider.value = light.brightness || 127;
  document.getElementById('brightness-value').textContent =
    Math.round(((light.brightness || 127) / 254) * 100) + '%';

  // Determine capabilities
  const fullColor = isFullColorLight(light.type);
  const ctOnly = isCTLight(light.type);

  // Show/hide controls
  document.getElementById('color-group').style.display = fullColor ? 'block' : 'none';
  document.getElementById('ct-group').style.display = (fullColor || ctOnly) ? 'block' : 'none';

  // Populate color picker
  if (fullColor && light.xy && light.xy.length === 2) {
    const rgb = xyBriToRgb(light.xy[0], light.xy[1], 254);
    document.getElementById('light-color-picker').value = rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  // Populate CT slider
  if ((fullColor || ctOnly) && light.ct) {
    document.getElementById('light-ct-slider').value = light.ct;
    document.getElementById('ct-value').textContent = Math.round(1000000 / light.ct) + 'K';
  }

  // Enable/disable controls based on power
  toggleControlsEnabled(light.on);
  updatePreviewSwatch();

  modal.classList.add('active');
}

function closeModal() {
  document.getElementById('light-control-modal').classList.remove('active');
  currentLightId = null;
  if (sendTimeout) clearTimeout(sendTimeout);
}

function toggleControlsEnabled(isOn) {
  const groups = ['brightness-group', 'color-group', 'ct-group'];
  for (const id of groups) {
    const el = document.getElementById(id);
    if (isOn) {
      el.classList.remove('light-controls-disabled');
    } else {
      el.classList.add('light-controls-disabled');
    }
  }
}

function updatePreviewSwatch() {
  const swatch = document.getElementById('light-preview-swatch');
  const isOn = document.getElementById('light-power-toggle').checked;

  if (!isOn) {
    swatch.style.backgroundColor = '#555';
    swatch.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.15)';
    return;
  }

  const bri = parseInt(document.getElementById('light-brightness-slider').value);
  const colorGroup = document.getElementById('color-group');
  const ctGroup = document.getElementById('ct-group');
  const scale = bri / 254;

  let color;
  if (colorGroup.style.display !== 'none') {
    const hex = document.getElementById('light-color-picker').value;
    const rgb = hexToRgb(hex);
    color = `rgb(${Math.round(rgb.r * scale)}, ${Math.round(rgb.g * scale)}, ${Math.round(rgb.b * scale)})`;
  } else if (ctGroup.style.display !== 'none') {
    const ct = parseInt(document.getElementById('light-ct-slider').value);
    const rgb = ctToRgb(ct);
    color = `rgb(${Math.round(rgb.r * scale)}, ${Math.round(rgb.g * scale)}, ${Math.round(rgb.b * scale)})`;
  } else {
    color = `rgb(255, ${Math.round(200 + scale * 55)}, ${Math.round(150 + scale * 105)})`;
  }

  swatch.style.backgroundColor = color;
  swatch.style.boxShadow = `0 0 20px 5px ${color}`;
}

function debouncedSend(stateObj) {
  if (sendTimeout) clearTimeout(sendTimeout);
  sendTimeout = setTimeout(() => sendLightState(stateObj), 100);
}

async function sendLightState(stateObj) {
  if (!currentLightId) return;

  try {
    const response = await fetch(`/api/lights/${currentLightId}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stateObj)
    });
    const data = await response.json();

    if (!data.success) {
      console.error('Failed to set light state:', data.error || data.errors);
    }

    // Update local data so preview stays consistent
    const light = lightDataMap.get(currentLightId);
    if (light) {
      if (stateObj.on !== undefined) light.on = stateObj.on;
      if (stateObj.bri !== undefined) light.brightness = stateObj.bri;
      if (stateObj.xy !== undefined) light.xy = stateObj.xy;
      if (stateObj.ct !== undefined) light.ct = stateObj.ct;
      if (stateObj.hue !== undefined) light.hue = stateObj.hue;
      if (stateObj.sat !== undefined) light.sat = stateObj.sat;
    }
  } catch (error) {
    console.error('Error sending light state:', error);
  }
}

function initLightControlModal() {
  const modal = document.getElementById('light-control-modal');
  const closeBtnEl = modal.querySelector('.close-btn');
  const powerToggle = document.getElementById('light-power-toggle');
  const brightnessSlider = document.getElementById('light-brightness-slider');
  const colorPicker = document.getElementById('light-color-picker');
  const ctSlider = document.getElementById('light-ct-slider');

  // Close handlers
  closeBtnEl.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
  });

  // Click on light item opens modal
  document.getElementById('rooms-container').addEventListener('click', (e) => {
    const lightItem = e.target.closest('.light-item');
    if (!lightItem) return;

    const lightId = lightItem.dataset.lightId;
    const light = lightDataMap.get(lightId);
    if (!light || !light.reachable) return;

    openLightModal(light);
  });

  // Power toggle
  powerToggle.addEventListener('change', () => {
    const isOn = powerToggle.checked;
    document.getElementById('light-power-label').textContent = isOn ? 'On' : 'Off';
    toggleControlsEnabled(isOn);
    updatePreviewSwatch();
    sendLightState({ on: isOn });
  });

  // Brightness slider
  brightnessSlider.addEventListener('input', () => {
    const bri = parseInt(brightnessSlider.value);
    document.getElementById('brightness-value').textContent =
      Math.round((bri / 254) * 100) + '%';
    updatePreviewSwatch();
    debouncedSend({ bri });
  });

  // Color picker
  colorPicker.addEventListener('input', () => {
    const hex = colorPicker.value;
    const rgb = hexToRgb(hex);
    const xy = rgbToXy(rgb.r, rgb.g, rgb.b);
    updatePreviewSwatch();
    debouncedSend({ xy });
  });

  // CT slider
  ctSlider.addEventListener('input', () => {
    const ct = parseInt(ctSlider.value);
    document.getElementById('ct-value').textContent = Math.round(1000000 / ct) + 'K';
    updatePreviewSwatch();
    debouncedSend({ ct });
  });
}

// ── Room Header Navigation ────────────────────────────────────────

function initRoomHeaderNavigation() {
  const container = document.getElementById('rooms-container');
  container.addEventListener('click', (e) => {
    const header = e.target.closest('.room-header-link');
    if (!header) return;
    // Don't navigate if click was on a slider inside the header (shouldn't be, but guard)
    if (e.target.closest('input')) return;
    const roomId = header.dataset.roomId;
    if (roomId) window.location.href = `/room.html?id=${roomId}`;
  });
}

// ── Room Brightness Slider ───────────────────────────────────────

function initRoomBrightnessSliders() {
  const container = document.getElementById('rooms-container');

  container.addEventListener('input', (e) => {
    const slider = e.target.closest('.room-brightness-slider');
    if (!slider) return;

    const roomId = slider.dataset.roomId;
    const bri = parseInt(slider.value);
    const percent = Math.round((bri / 254) * 100);

    // Update the label
    const control = slider.closest('.room-brightness-control');
    const label = control.querySelector('.room-bri-value');
    if (label) label.textContent = percent + '%';

    // Mark slider as active so polling doesn't overwrite it
    roomSliderActive[roomId] = true;

    // Debounce the API calls per room
    if (roomSliderTimeouts[roomId]) clearTimeout(roomSliderTimeouts[roomId]);
    roomSliderTimeouts[roomId] = setTimeout(() => {
      sendRoomBrightness(roomId, bri);
    }, 150);
  });

  // Clear active flag when user releases the slider
  container.addEventListener('pointerup', (e) => {
    const slider = e.target.closest('.room-brightness-slider');
    if (!slider) return;
    const roomId = slider.dataset.roomId;
    // Delay clearing so the last debounced send completes before next poll rebuilds
    setTimeout(() => { roomSliderActive[roomId] = false; }, 500);
  });

  container.addEventListener('change', (e) => {
    const slider = e.target.closest('.room-brightness-slider');
    if (!slider) return;
    const roomId = slider.dataset.roomId;
    setTimeout(() => { roomSliderActive[roomId] = false; }, 500);
  });
}

async function sendRoomBrightness(roomId, bri) {
  // Find all reachable, on lights in this room from lightDataMap
  const container = document.getElementById(`room-${roomId}`);
  if (!container) return;

  const lightItems = container.querySelectorAll('.light-item');
  const promises = [];

  for (const item of lightItems) {
    const lightId = item.dataset.lightId;
    const light = lightDataMap.get(lightId);
    if (!light || !light.reachable) continue;

    // Send brightness (and turn on if off)
    const stateObj = light.on ? { bri } : { on: true, bri };
    promises.push(
      fetch(`/api/lights/${lightId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stateObj)
      }).then(r => r.json()).catch(err => {
        console.error(`Error setting brightness for light ${lightId}:`, err);
      })
    );

    // Update local data
    if (light) {
      light.brightness = bri;
      if (!light.on) light.on = true;
    }
  }

  await Promise.all(promises);
}

// ── Init ─────────────────────────────────────────────────────────

async function init() {
  initLightControlModal();
  initRoomBrightnessSliders();
  initRoomHeaderNavigation();
  await fetchAndRenderLights();
  refreshIntervalId = setInterval(fetchAndRenderLights, REFRESH_INTERVAL);
}

document.addEventListener('DOMContentLoaded', init);
