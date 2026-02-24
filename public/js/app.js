// Chart instances storage
const charts = {};

// Per-room time range overrides (roomId -> range string)
const roomTimeRanges = {};

// Settings with defaults
let settings = {
  pollRate: 10,
  yAxisMode: 'auto',
  yAxisMin: 60,
  yAxisMax: 80
};

// Update interval (will be updated from settings)
let UPDATE_INTERVAL = 10000;
let updateIntervalId = null;

// Convert Celsius to Fahrenheit
function celsiusToFahrenheit(celsius) {
  return (celsius * 9/5) + 32;
}

// Sample readings by a specific time interval (in milliseconds)
function sampleByInterval(readings, intervalMs) {
  if (readings.length === 0) return [];

  const sampled = [];
  let lastTimestamp = null;

  for (const reading of readings) {
    if (lastTimestamp === null || reading.timestamp - lastTimestamp >= intervalMs) {
      sampled.push(reading);
      lastTimestamp = reading.timestamp;
    }
  }

  return sampled;
}

// Sample readings to one per hour
function sampleHourly(readings) {
  return sampleByInterval(readings, 60 * 60 * 1000); // 1 hour in ms
}

// Sample readings to one per 15 minutes
function sample15Minutes(readings) {
  return sampleByInterval(readings, 15 * 60 * 1000); // 15 minutes in ms
}

// Determine which sampling strategy to use and filter time range
function getSampledReadings(readings, timeRange) {
  if (readings.length === 0) return [];

  const now = Date.now();
  const oldestReading = readings[0];
  const newestReading = readings[readings.length - 1];
  const totalDataAge = now - oldestReading.timestamp;
  const totalDataDays = totalDataAge / (24 * 60 * 60 * 1000);

  let cutoffTime;
  let samplingStrategy = 'all';

  // Determine cutoff time and sampling based on timeRange setting
  if (timeRange === 'auto') {
    // Automatic mode: use smart defaults based on data age
    if (totalDataDays > 7) {
      // More than 7 days of data: show 30 days, hourly samples
      cutoffTime = now - (30 * 24 * 60 * 60 * 1000);
      samplingStrategy = 'hourly';
    } else if (totalDataDays > 1) {
      // 1-7 days of data: show 7 days, 15-minute samples
      cutoffTime = now - (7 * 24 * 60 * 60 * 1000);
      samplingStrategy = '15min';
    } else {
      // Less than 1 day: show all data
      cutoffTime = 0;
      samplingStrategy = 'all';
    }
  } else if (timeRange === '30d') {
    cutoffTime = now - (30 * 24 * 60 * 60 * 1000);
    samplingStrategy = 'hourly';
  } else if (timeRange === '7d') {
    cutoffTime = now - (7 * 24 * 60 * 60 * 1000);
    samplingStrategy = '15min';
  } else if (timeRange === '1d') {
    cutoffTime = now - (24 * 60 * 60 * 1000);
    samplingStrategy = 'all';
  } else if (timeRange === '1h') {
    cutoffTime = now - (60 * 60 * 1000);
    samplingStrategy = 'all';
  }

  // Filter by time range
  let filtered = readings.filter(r => r.timestamp >= cutoffTime);

  // If no data in range, return last reading
  if (filtered.length === 0 && readings.length > 0) {
    filtered = [readings[readings.length - 1]];
  }

  // Apply sampling strategy
  let sampled;
  if (samplingStrategy === 'hourly') {
    sampled = sampleHourly(filtered);
  } else if (samplingStrategy === '15min') {
    sampled = sample15Minutes(filtered);
  } else {
    sampled = filtered; // Show all data
  }

  return sampled;
}

// Load settings from localStorage
function loadSettings() {
  const saved = localStorage.getItem('hueSettings');
  if (saved) {
    const parsed = JSON.parse(saved);
    delete parsed.timeRange; // remove stale key from older versions
    settings = { ...settings, ...parsed };
  }
  UPDATE_INTERVAL = settings.pollRate * 1000;
}

// Save settings to localStorage
function saveSettings() {
  localStorage.setItem('hueSettings', JSON.stringify(settings));
}

// Save per-room time range selections to localStorage
function saveRoomTimeRanges() {
  localStorage.setItem('hueRoomTimeRanges', JSON.stringify(roomTimeRanges));
}

// Load per-room time range selections from localStorage
function loadRoomTimeRanges() {
  const saved = localStorage.getItem('hueRoomTimeRanges');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      Object.assign(roomTimeRanges, parsed);
    } catch (e) { /* ignore malformed data */ }
  }
}

// Update footer text with current poll rate
function updateFooter() {
  const footerText = document.getElementById('footer-text');
  if (footerText) {
    footerText.textContent = `Updates and polls Hue Bridge every ${settings.pollRate} seconds | Data persisted to SQLite database | v1.2`;
  }
}

// Settings Modal Management
function initSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const settingsBtn = document.getElementById('settings-btn');
  const closeBtn = modal.querySelector('.close-btn');
  const cancelBtn = document.getElementById('cancel-settings');
  const saveBtn = document.getElementById('save-settings');
  const yAxisRadios = modal.querySelectorAll('input[name="y-axis-mode"]');
  const manualBounds = document.getElementById('manual-bounds');

  // Open modal
  settingsBtn.addEventListener('click', () => {
    // Load current settings into form
    document.getElementById('poll-rate').value = settings.pollRate;
    document.querySelector(`input[name="y-axis-mode"][value="${settings.yAxisMode}"]`).checked = true;
    document.getElementById('y-axis-min').value = settings.yAxisMin;
    document.getElementById('y-axis-max').value = settings.yAxisMax;

    // Show/hide manual bounds
    manualBounds.style.display = settings.yAxisMode === 'manual' ? 'block' : 'none';

    modal.classList.add('active');
  });

  // Close modal
  const closeModal = () => {
    modal.classList.remove('active');
  };

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Close with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeModal();
    }
  });

  // Toggle manual bounds visibility
  yAxisRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      manualBounds.style.display = e.target.value === 'manual' ? 'block' : 'none';
    });
  });

  // Save settings
  saveBtn.addEventListener('click', () => {
    const newPollRate = parseInt(document.getElementById('poll-rate').value);
    const newYAxisMode = document.querySelector('input[name="y-axis-mode"]:checked').value;
    const newYAxisMin = parseFloat(document.getElementById('y-axis-min').value);
    const newYAxisMax = parseFloat(document.getElementById('y-axis-max').value);

    // Validate
    if (newPollRate < 1 || newPollRate > 300) {
      alert('Poll rate must be between 1 and 300 seconds');
      return;
    }

    if (newYAxisMode === 'manual' && newYAxisMin >= newYAxisMax) {
      alert('Lower bound must be less than upper bound');
      return;
    }

    // Update settings
    settings.pollRate = newPollRate;
    settings.yAxisMode = newYAxisMode;
    settings.yAxisMin = newYAxisMin;
    settings.yAxisMax = newYAxisMax;

    saveSettings();

    // Update poll interval
    UPDATE_INTERVAL = settings.pollRate * 1000;

    // Update footer text
    updateFooter();

    // Restart polling with new interval
    if (updateIntervalId) {
      clearInterval(updateIntervalId);
    }
    updateIntervalId = setInterval(fetchAndRenderRooms, UPDATE_INTERVAL);

    // Refresh all charts with new y-axis settings
    Object.keys(charts).forEach(roomId => {
      updateRoomChart(roomId);
    });

    closeModal();
  });
}

// Initialize time range button handlers
function initTimeRangeHandlers() {
  // Use event delegation on the rooms container
  const roomsContainer = document.getElementById('rooms-container');

  roomsContainer.addEventListener('click', (e) => {
    // Check if clicked element is a time range button
    if (e.target.classList.contains('time-range-btn')) {
      const roomId = e.target.dataset.room;
      const range = e.target.dataset.range;

      // Update active state for buttons in this room only
      const card = document.getElementById(`room-${roomId}`);
      if (card) {
        const buttons = card.querySelectorAll('.time-range-btn');
        buttons.forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
      }

      // Update per-room time range and persist to localStorage
      roomTimeRanges[roomId] = range;
      saveRoomTimeRanges();

      // Refresh the chart for this room only
      updateRoomChart(roomId);
    }
  });
}

// Initialize the application
async function init() {
  console.log('Initializing Hue Temperature Dashboard...');

  // Load settings from localStorage
  loadSettings();

  // Load per-room time range selections from localStorage
  loadRoomTimeRanges();

  // Update footer with current settings
  updateFooter();

  // Initialize settings modal
  initSettingsModal();

  // Initialize time range button handlers
  initTimeRangeHandlers();

  // Load initial data
  await fetchAndRenderRooms();

  // Set up auto-refresh with stored interval ID
  updateIntervalId = setInterval(fetchAndRenderRooms, UPDATE_INTERVAL);
}

// Fetch rooms and render/update the UI
async function fetchAndRenderRooms() {
  try {
    const response = await fetch('/api/rooms');
    const data = await response.json();

    if (!data.success) {
      showError('Failed to fetch room data');
      return;
    }

    hideLoading();

    if (data.rooms.length === 0) {
      showNoData();
      return;
    }

    updateStatus('active', `${data.rooms.length} room${data.rooms.length !== 1 ? 's' : ''} connected`);
    updateLastUpdateTime(data.lastPoll);

    // Render or update each room
    for (const room of data.rooms) {
      await renderRoom(room);
    }

  } catch (error) {
    console.error('Error fetching rooms:', error);
    showError(`Connection error: ${error.message}`);
    updateStatus('error', 'Connection failed');
  }
}

// Render or update a single room card
async function renderRoom(room) {
  let card = document.getElementById(`room-${room.id}`);

  if (!card) {
    // Create new card
    card = createRoomCard(room);
    document.getElementById('rooms-container').appendChild(card);
  } else {
    // Update existing card
    updateRoomCard(card, room);
  }

  // Fetch detailed data for chart
  await updateRoomChart(room.id);
}

// Create a new room card element
function createRoomCard(room) {
  const card = document.createElement('div');
  card.className = 'room-card';
  card.id = `room-${room.id}`;

  const tempF = celsiusToFahrenheit(room.currentTemp);
  const luxDisplay = room.currentLux !== null ? `${room.currentLux} lux` : 'N/A';
  const motionDisplay = room.motionDetected ? '🟢 Motion detected' : '⚫ No motion';

  let lastMotionDisplay = 'Never';
  if (room.lastMotion) {
    const timeStr = formatTime(room.lastMotion);
    const relativeStr = formatRelativeTime(room.lastMotion);
    lastMotionDisplay = relativeStr === 'Just now' ? timeStr : `${timeStr} (${relativeStr})`;
  }

  card.innerHTML = `
    <div class="room-header">
      <h2 class="room-name">${escapeHtml(room.name)}</h2>
    </div>
    <div class="room-temp">
      ${tempF.toFixed(1)}<span class="temp-unit">°F</span>
    </div>
    <div class="room-sensors">
      <div class="sensor-item">
        <span class="sensor-label">Light:</span>
        <span class="sensor-value">${luxDisplay}</span>
      </div>
      <div class="sensor-item">
        <span class="sensor-label">Motion:</span>
        <span class="sensor-value">${motionDisplay}</span>
      </div>
      <div class="sensor-item">
        <span class="sensor-label">Last motion:</span>
        <span class="sensor-value">${lastMotionDisplay}</span>
      </div>
    </div>
    <div class="room-meta">
      Last update: ${formatTime(room.lastUpdate)}
    </div>
    <div class="time-range-selector">
      <button class="time-range-btn ${(roomTimeRanges[room.id] || 'auto') === 'auto' ? 'active' : ''}" data-room="${room.id}" data-range="auto">Auto</button>
      <button class="time-range-btn ${(roomTimeRanges[room.id] || 'auto') === '30d' ? 'active' : ''}" data-room="${room.id}" data-range="30d">30 Days</button>
      <button class="time-range-btn ${(roomTimeRanges[room.id] || 'auto') === '7d' ? 'active' : ''}" data-room="${room.id}" data-range="7d">7 Days</button>
      <button class="time-range-btn ${(roomTimeRanges[room.id] || 'auto') === '1d' ? 'active' : ''}" data-room="${room.id}" data-range="1d">1 Day</button>
      <button class="time-range-btn ${(roomTimeRanges[room.id] || 'auto') === '1h' ? 'active' : ''}" data-room="${room.id}" data-range="1h">1 Hour</button>
    </div>
    <div class="chart-container">
      <canvas id="chart-${room.id}"></canvas>
    </div>
  `;

  return card;
}

// Update an existing room card
function updateRoomCard(card, room) {
  const tempElement = card.querySelector('.room-temp');
  const metaElement = card.querySelector('.room-meta');
  const sensorItems = card.querySelectorAll('.sensor-item .sensor-value');

  if (tempElement) {
    const tempF = celsiusToFahrenheit(room.currentTemp);
    tempElement.innerHTML = `${tempF.toFixed(1)}<span class="temp-unit">°F</span>`;
  }

  // Update sensor values
  if (sensorItems.length >= 3) {
    const luxDisplay = room.currentLux !== null ? `${room.currentLux} lux` : 'N/A';
    const motionDisplay = room.motionDetected ? '🟢 Motion detected' : '⚫ No motion';

    let lastMotionDisplay = 'Never';
    if (room.lastMotion) {
      const timeStr = formatTime(room.lastMotion);
      const relativeStr = formatRelativeTime(room.lastMotion);
      lastMotionDisplay = relativeStr === 'Just now' ? timeStr : `${timeStr} (${relativeStr})`;
    }

    sensorItems[0].textContent = luxDisplay; // Light
    sensorItems[1].textContent = motionDisplay; // Motion
    sensorItems[2].textContent = lastMotionDisplay; // Last motion
  }

  if (metaElement) {
    metaElement.textContent = `Last update: ${formatTime(room.lastUpdate)}`;
  }
}

// Update or create a chart for a room
async function updateRoomChart(roomId) {
  try {
    const response = await fetch(`/api/rooms/${roomId}`);
    const data = await response.json();

    if (!data.success || !data.room) {
      return;
    }

    const room = data.room;
    const canvas = document.getElementById(`chart-${roomId}`);

    if (!canvas) {
      return;
    }

    // Get sampled readings based on per-room time range (fallback to global default)
    const allReadings = room.readings;
    const timeRange = roomTimeRanges[roomId] || 'auto';
    const readings = getSampledReadings(allReadings, timeRange);

    if (readings.length === 0) {
      return;
    }

    // Get time range for smart label formatting
    const firstTimestamp = readings[0].timestamp;
    const lastTimestamp = readings[readings.length - 1].timestamp;

    const labels = readings.map(r => formatChartTime(r.timestamp, firstTimestamp, lastTimestamp));
    const temps = readings.map(r => celsiusToFahrenheit(r.temp));

    // Create point styling based on motion detection
    const dataPointCount = readings.length;

    // Adjust point sizes based on data density
    let normalSize = 2;
    let motionSize = 6;
    if (dataPointCount > 360) { // More than 1 hour
      normalSize = 1;
      motionSize = 5;
    }
    if (dataPointCount > 1080) { // More than 3 hours
      normalSize = 0;
      motionSize = 4;
    }
    if (dataPointCount > 4320) { // More than 12 hours
      normalSize = 0;
      motionSize = 3;
    }
    if (dataPointCount > 8640) { // More than 24 hours
      normalSize = 0;
      motionSize = 2;
    }

    const pointColors = readings.map(r => r.motion ? '#4caf50' : '#667eea');
    const pointSizes = readings.map(r => r.motion ? motionSize : normalSize);
    const pointBorderWidths = readings.map(r => r.motion ? 2 : 0);

    // Calculate appropriate tick spacing based on data range
    let maxTicksLimit = 6;
    if (dataPointCount > 360) { // More than 1 hour of data
      maxTicksLimit = 8;
    }
    if (dataPointCount > 720) { // More than 2 hours of data
      maxTicksLimit = 10;
    }
    if (dataPointCount > 2160) { // More than 6 hours of data
      maxTicksLimit = 12;
    }
    if (dataPointCount > 8640) { // More than 24 hours of data
      maxTicksLimit = 15;
    }

    // Destroy old chart if it exists
    if (charts[roomId]) {
      charts[roomId].destroy();
    }

    // Calculate canvas width for horizontal scrolling (desktop only)
    const isMobile = window.innerWidth <= 768;
    let activeCanvas = canvas;

    if (isMobile) {
      // On mobile, replace canvas with a fresh one to avoid stale size attributes
      const freshCanvas = document.createElement('canvas');
      freshCanvas.id = canvas.id;
      canvas.parentElement.replaceChild(freshCanvas, canvas);
      activeCanvas = freshCanvas;
    } else {
      // On desktop, allow horizontal scrolling for dense data
      const containerWidth = canvas.parentElement.clientWidth;
      const minWidthPerPoint = 8;
      const calculatedWidth = Math.max(containerWidth, dataPointCount * minWidthPerPoint);
      canvas.style.width = calculatedWidth + 'px';
    }

    // Create new chart
    const ctx = activeCanvas.getContext('2d');
    charts[roomId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Temperature (°F)',
          data: temps,
          borderColor: '#667eea',
          backgroundColor: 'rgba(102, 126, 234, 0.1)',
          borderWidth: 2,
          tension: 0.3,
          fill: true,
          pointRadius: pointSizes,
          pointBackgroundColor: pointColors,
          pointBorderColor: '#ffffff',
          pointBorderWidth: pointBorderWidths,
          pointHoverRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: dataPointCount > 360 ? 0 : 300 // Disable animation for large datasets
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: function(context) {
                const temp = `${context.parsed.y.toFixed(1)}°F`;
                const hasMotion = readings[context.dataIndex]?.motion;
                return hasMotion ? `${temp} 🟢 Motion` : temp;
              }
            }
          },
          decimation: {
            enabled: dataPointCount > 1000,
            algorithm: 'lttb',
            samples: 500
          }
        },
        scales: {
          x: {
            display: true,
            grid: {
              display: false
            },
            ticks: {
              maxTicksLimit: maxTicksLimit,
              autoSkip: true,
              maxRotation: 0,
              minRotation: 0
            }
          },
          y: {
            display: true,
            grid: {
              color: 'rgba(0, 0, 0, 0.05)'
            },
            ticks: {
              callback: function(value) {
                return value.toFixed(1) + '°F';
              }
            },
            beginAtZero: false,
            min: settings.yAxisMode === 'manual' ? settings.yAxisMin : undefined,
            max: settings.yAxisMode === 'manual' ? settings.yAxisMax : undefined
          }
        },
        interaction: {
          mode: 'nearest',
          axis: 'x',
          intersect: false
        }
      }
    });

  } catch (error) {
    console.error(`Error updating chart for room ${roomId}:`, error);
  }
}

// Update status indicator
function updateStatus(status, text) {
  const indicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');

  indicator.className = `status-indicator ${status}`;
  statusText.textContent = text;
}

// Update last update time
function updateLastUpdateTime(timestamp) {
  const element = document.getElementById('last-update');
  if (timestamp) {
    element.textContent = `Last update: ${formatTime(timestamp)}`;
  }
}

// Show error message
function showError(message) {
  const errorElement = document.getElementById('error');
  const errorMessage = document.getElementById('error-message');

  errorMessage.textContent = message;
  errorElement.classList.remove('hidden');

  hideLoading();
}

// Hide loading indicator
function hideLoading() {
  document.getElementById('loading').classList.add('hidden');
}

// Show no data message
function showNoData() {
  document.getElementById('no-data').classList.remove('hidden');
  hideLoading();
}

// Format timestamp for display
function formatTime(timestamp) {
  if (!timestamp) return '--';

  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// Format timestamp for chart labels
function formatChartTime(timestamp, firstTimestamp = null, lastTimestamp = null) {
  const date = new Date(timestamp);

  // If we have a time range spanning multiple days, include the date
  if (firstTimestamp && lastTimestamp) {
    const timeRangeMs = lastTimestamp - firstTimestamp;
    const timeRangeHours = timeRangeMs / (1000 * 60 * 60);
    const timeRangeDays = timeRangeHours / 24;

    if (timeRangeDays > 3) {
      // For ranges over 3 days, show date only
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
    } else if (timeRangeHours > 12) {
      // Show date and time for ranges over 12 hours
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }

  // Default: just show time
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Format relative time (e.g., "5 minutes ago", "2 hours ago")
function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Never';

  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now - then;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'Just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
