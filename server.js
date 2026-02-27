import express from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './src/config.js';
import { dataStore } from './src/dataStore.js';
import { hueClient } from './src/hueClient.js';
import apiRoutes from './src/api/routes.js';
import { initializeDatabase } from './src/database.js';
import { logger } from './src/logger.js';
import { startHueEventStream } from './src/hueEventStream.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Database instance
let database = null;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function apiRequestLogger(req, res, next) {
  const requestId = randomUUID();
  req.requestId = requestId;

  const start = process.hrtime.bigint();
  logger.info('API_REQUEST_START', 'API request started', {
    requestId,
    method: req.method,
    route: req.originalUrl
  });

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1000000;
    const fields = {
      requestId,
      method: req.method,
      route: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(2))
    };

    if (res.statusCode >= 500) {
      logger.error('API_REQUEST_ERROR', 'API request failed', fields);
      return;
    }

    logger.info('API_REQUEST_END', 'API request completed', fields);
  });

  next();
}

// API Routes
app.use('/api', apiRequestLogger, apiRoutes);

// Polling interval reference
let pollingInterval;
let stopHueEventStream = null;

// Polling function
async function pollHueBridge() {
  const startedAt = Date.now();
  try {
    logger.debug('POLL_START', 'Polling Hue bridge started');
    const roomData = await hueClient.getRoomData();

    if (roomData.length === 0) {
      logger.warn('NO_TEMPERATURE_SENSORS', 'No temperature sensors found on Hue bridge');
    }

    for (const room of roomData) {
      dataStore.addReading(room.id, room.name, room.temperature, room.lux, room.motionDetected, room.lastMotion);
    }

    logger.info('POLL_SUCCESS', 'Polling Hue bridge completed', {
      durationMs: Date.now() - startedAt,
      roomCount: roomData.length,
      readingsWritten: roomData.length
    });
  } catch (error) {
    logger.error('POLL_FAILURE', 'Polling Hue bridge failed', {
      durationMs: Date.now() - startedAt,
      error
    });
  }
}

// Start polling service
function startPolling() {
  // Poll immediately on startup
  pollHueBridge();

  // Then poll at the configured interval
  pollingInterval = setInterval(pollHueBridge, config.POLL_INTERVAL);
  logger.info('POLLING_STARTED', 'Polling service started', {
    intervalSeconds: config.POLL_INTERVAL / 1000
  });
}

// Initialize server with database
async function startServer() {
  try {
    logger.info('APP_START', 'Application startup initiated', {
      port: config.PORT,
      pollIntervalMs: config.POLL_INTERVAL,
      bridgeIp: config.HUE_BRIDGE_IP
    });

    // 1. Initialize database
    const dbPath = config.DB_PATH || path.join(process.cwd(), 'data', 'hue-sensors.db');
    logger.info('DB_INIT_START', 'Initializing database', { dbPath });
    database = initializeDatabase(dbPath);
    logger.info('DB_INIT_SUCCESS', 'Database initialized', { dbPath });

    // 2. Connect dataStore to database
    dataStore.setDatabase(database);

    // 3. Load historical data from database
    logger.info('DATASTORE_LOAD_START', 'Loading historical data from database');
    dataStore.loadFromDatabase();
    logger.info('DATASTORE_LOAD_SUCCESS', 'Loaded historical data from database');

    // 4. Get and display database statistics
    const stats = database.getStats();
    logger.info('DB_STATS', 'Database statistics loaded', {
      totalReadings: stats.totalReadings,
      roomCount: stats.roomCount,
      dbSizeMB: stats.dbSizeMB
    });
    if (stats.oldestReading && stats.newestReading) {
      logger.info('DB_DATA_RANGE', 'Database data range loaded', {
        oldestReading: stats.oldestReading,
        newestReading: stats.newestReading
      });
    }

    // 5. Start Express server
    app.listen(config.PORT, () => {
      logger.info('APP_READY', 'Server listening', {
        port: config.PORT,
        url: `http://localhost:${config.PORT}`,
        bridgeIp: config.HUE_BRIDGE_IP,
        pollIntervalSeconds: config.POLL_INTERVAL / 1000
      });

      // 6. Start polling
      startPolling();

      // 7. Start Hue bridge event stream
      if (config.EVENT_STREAM_ENABLED) {
        stopHueEventStream = startHueEventStream();
      } else {
        logger.info('BRIDGE_EVENT_STREAM_DISABLED', 'Hue bridge event stream is disabled by config');
      }
    });

  } catch (error) {
    logger.error('APP_START_FAILURE', 'Failed to start server', { error });
    process.exit(1);
  }
}

// Start the server
startServer();

// Graceful shutdown
function shutdown(signal = 'unknown') {
  logger.info('APP_SHUTDOWN', 'Shutting down gracefully', { signal });

  // Stop polling
  if (pollingInterval) {
    clearInterval(pollingInterval);
    logger.info('POLLING_STOPPED', 'Polling service stopped');
  }

  // Stop Hue bridge event stream
  if (stopHueEventStream) {
    stopHueEventStream();
    stopHueEventStream = null;
  }

  // Close database connection
  if (database) {
    try {
      database.close();
      logger.info('DB_CLOSED', 'Database connection closed');
    } catch (error) {
      logger.error('DB_CLOSE_ERROR', 'Error closing database connection', { error });
    }
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
