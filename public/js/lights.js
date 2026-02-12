// Hue Lights Dashboard
// Fetches light state from the bridge and displays rooms with color swatches

const REFRESH_INTERVAL = 5000;
let refreshIntervalId = null;

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
  const color = getLightCssColor(light);
  const brightnessPercent = Math.round((light.brightness / 254) * 100);
  const statusClass = light.on ? 'light-on' : 'light-off';
  const reachableClass = light.reachable ? '' : 'light-unreachable';

  return `
    <div class="light-item ${statusClass} ${reachableClass}">
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
    if (!card) {
      card = document.createElement('div');
      card.className = 'room-card';
      card.id = cardId;
      container.appendChild(card);
    }

    const onCount = room.lights.filter(l => l.on).length;
    const totalCount = room.lights.length;

    card.innerHTML = `
      <div class="room-header">
        <div class="room-name">${escapeHtml(room.name)}</div>
        <span class="room-light-count">${onCount}/${totalCount} on</span>
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

// ── Init ─────────────────────────────────────────────────────────

async function init() {
  await fetchAndRenderLights();
  refreshIntervalId = setInterval(fetchAndRenderLights, REFRESH_INTERVAL);
}

document.addEventListener('DOMContentLoaded', init);
