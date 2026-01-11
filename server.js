import express from 'express';
import { config } from './src/config.js';
import { dataStore } from './src/dataStore.js';
import { hueClient } from './src/hueClient.js';
import apiRoutes from './src/api/routes.js';

const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// API Routes
app.use('/api', apiRoutes);

// Polling interval reference
let pollingInterval;

// Polling function
async function pollHueBridge() {
  try {
    console.log(`[${new Date().toISOString()}] Polling Hue Bridge...`);
    const roomData = await hueClient.getRoomData();

    if (roomData.length === 0) {
      console.log('No temperature sensors found on Hue Bridge');
    } else {
      for (const room of roomData) {
        dataStore.addReading(room.id, room.name, room.temperature, room.lux, room.motionDetected, room.lastMotion);
        const luxStr = room.lux !== null ? ` | ${room.lux} lux` : '';
        const motionStr = room.motionDetected ? ' | Motion: YES' : ' | Motion: no';
        console.log(`  ${room.name}: ${room.temperature.toFixed(2)}°C${luxStr}${motionStr}`);
      }
    }
  } catch (error) {
    console.error(`Polling error: ${error.message}`);
  }
}

// Start polling service
function startPolling() {
  // Poll immediately on startup
  pollHueBridge();

  // Then poll at the configured interval
  pollingInterval = setInterval(pollHueBridge, config.POLL_INTERVAL);
  console.log(`Polling started (every ${config.POLL_INTERVAL / 1000} seconds)`);
}

// Start the server
app.listen(config.PORT, () => {
  console.log('='.repeat(50));
  console.log('Hue Temperature Tracker');
  console.log('='.repeat(50));
  console.log(`Server running on http://localhost:${config.PORT}`);
  console.log(`Bridge IP: ${config.HUE_BRIDGE_IP}`);
  console.log(`Poll interval: ${config.POLL_INTERVAL / 1000} seconds`);
  console.log('='.repeat(50));
  console.log('');

  startPolling();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  clearInterval(pollingInterval);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\nShutting down gracefully...');
  clearInterval(pollingInterval);
  process.exit(0);
});
