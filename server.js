import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './src/config.js';
import { dataStore } from './src/dataStore.js';
import { hueClient } from './src/hueClient.js';
import apiRoutes from './src/api/routes.js';
import { initializeDatabase } from './src/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Database instance
let database = null;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// Initialize server with database
async function startServer() {
  try {
    console.log('='.repeat(50));
    console.log('Hue Temperature Tracker');
    console.log('='.repeat(50));

    // 1. Initialize database
    const dbPath = config.DB_PATH || path.join(process.cwd(), 'data', 'hue-sensors.db');
    console.log(`Initializing database at: ${dbPath}`);
    database = initializeDatabase(dbPath);

    // 2. Connect dataStore to database
    dataStore.setDatabase(database);

    // 3. Load historical data from database
    console.log('Loading historical data from database...');
    dataStore.loadFromDatabase();

    // 4. Get and display database statistics
    const stats = database.getStats();
    console.log(`Database stats:`);
    console.log(`  - Total readings: ${stats.totalReadings}`);
    console.log(`  - Rooms: ${stats.roomCount}`);
    console.log(`  - Database size: ${stats.dbSizeMB} MB`);
    if (stats.oldestReading && stats.newestReading) {
      const oldestDate = new Date(stats.oldestReading);
      const newestDate = new Date(stats.newestReading);
      console.log(`  - Data range: ${oldestDate.toLocaleString()} to ${newestDate.toLocaleString()}`);
    }

    // 5. Start Express server
    app.listen(config.PORT, () => {
      console.log('='.repeat(50));
      console.log(`Server running on http://localhost:${config.PORT}`);
      console.log(`Bridge IP: ${config.HUE_BRIDGE_IP}`);
      console.log(`Poll interval: ${config.POLL_INTERVAL / 1000} seconds`);
      console.log('='.repeat(50));
      console.log('');

      // 6. Start polling
      startPolling();
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

// Graceful shutdown
function shutdown() {
  console.log('\n\nShutting down gracefully...');

  // Stop polling
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }

  // Close database connection
  if (database) {
    try {
      database.close();
      console.log('Database connection closed');
    } catch (error) {
      console.error('Error closing database:', error);
    }
  }

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
