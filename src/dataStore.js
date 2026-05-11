import { getDatabase } from './database.js';

// Only keep the last N days of readings in the in-memory cache.
// The frontend chart range maxes out at 30 days, so anything older
// would never be displayed but would consume memory on startup.
// (Older history is still preserved in SQLite for ad-hoc queries.)
const READINGS_RETENTION_DAYS = 30;
const READINGS_RETENTION_MS = READINGS_RETENTION_DAYS * 86400 * 1000;

class DataStore {
  constructor() {
    this.rooms = new Map();
    this.lastPollTime = null;
    this.database = null; // Will be set after database initialization
  }

  // Set database instance (called after DB initialization)
  setDatabase(database) {
    this.database = database;
  }

  // Load recent historical data from database (capped at READINGS_RETENTION_DAYS)
  loadFromDatabase() {
    if (!this.database) {
      console.warn('Database not initialized, skipping data load');
      return;
    }

    const cutoff = Date.now() - READINGS_RETENTION_MS;
    console.log(`Loading last ${READINGS_RETENTION_DAYS} days of readings from database...`);

    try {
      const allReadings = this.database.getReadingsSince(cutoff);

      if (allReadings.length === 0) {
        console.log('No historical data found in database');
        return;
      }

      // Group readings by room and reconstruct in-memory structure
      for (const reading of allReadings) {
        const roomId = reading.room_id;

        // Initialize room if not exists
        if (!this.rooms.has(roomId)) {
          this.rooms.set(roomId, {
            id: roomId,
            name: '', // Will be updated with first reading
            readings: [],
            currentTemp: 0,
            currentLux: null,
            motionDetected: false,
            lastMotion: null,
            lastUpdate: new Date(reading.timestamp)
          });
        }

        const room = this.rooms.get(roomId);

        // Add reading to room's history
        room.readings.push({
          timestamp: reading.timestamp,
          temp: reading.temperature,
          motion: reading.motion_detected === 1
        });

        // Update current values (last reading will be the most recent)
        room.currentTemp = reading.temperature;
        room.currentLux = reading.lux;
        room.motionDetected = reading.motion_detected === 1;
        room.lastMotion = reading.last_motion_timestamp;
        room.lastUpdate = new Date(reading.timestamp);
      }

      // Get room names from rooms table
      const roomList = this.database.getRoomList();
      for (const roomInfo of roomList) {
        if (this.rooms.has(roomInfo.room_id)) {
          this.rooms.get(roomInfo.room_id).name = roomInfo.room_name;
        }
      }

      const totalReadings = allReadings.length;
      const roomCount = this.rooms.size;
      console.log(`Loaded ${totalReadings} readings across ${roomCount} rooms from database (last ${READINGS_RETENTION_DAYS} days)`);

      // Set last poll time to most recent reading
      if (allReadings.length > 0) {
        const mostRecent = allReadings[allReadings.length - 1];
        this.lastPollTime = new Date(mostRecent.timestamp);
      }
    } catch (error) {
      console.error('Error loading data from database:', error);
      throw error;
    }
  }

  addReading(roomId, roomName, temperature, lux, motionDetected, lastMotion) {
    const timestamp = Date.now();

    // 1. Add to in-memory cache for fast access
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        id: roomId,
        name: roomName,
        readings: [],
        currentTemp: temperature,
        currentLux: lux,
        motionDetected: motionDetected,
        lastMotion: lastMotion,
        lastUpdate: new Date()
      });
    }

    const room = this.rooms.get(roomId);

    room.readings.push({
      timestamp: timestamp,
      temp: temperature,
      motion: motionDetected
    });

    // Prune readings older than the retention window. Readings are appended in
    // chronological order, so we just walk forward from the front. Typically
    // 0 or 1 readings per call after warmup, so this is O(1) amortized.
    const cutoff = timestamp - READINGS_RETENTION_MS;
    let dropCount = 0;
    while (dropCount < room.readings.length && room.readings[dropCount].timestamp < cutoff) {
      dropCount++;
    }
    if (dropCount > 0) {
      room.readings.splice(0, dropCount);
    }

    room.currentTemp = temperature;
    room.currentLux = lux;
    room.motionDetected = motionDetected;
    room.lastMotion = lastMotion;
    room.lastUpdate = new Date();

    this.lastPollTime = new Date();

    // 2. Persist to database (if available)
    if (this.database) {
      try {
        this.database.insertReading(
          roomId,
          roomName,
          timestamp,
          temperature,
          lux,
          motionDetected,
          lastMotion
        );
      } catch (error) {
        // Log error but don't fail the operation - in-memory data is still valid
        console.error('Failed to persist reading to database:', error);
      }
    }
  }

  getAllRooms() {
    return Array.from(this.rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      currentTemp: room.currentTemp,
      currentLux: room.currentLux,
      motionDetected: room.motionDetected,
      lastMotion: room.lastMotion,
      lastUpdate: room.lastUpdate,
      readingCount: room.readings.length
    }));
  }

  getRoomDetail(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    return {
      id: room.id,
      name: room.name,
      currentTemp: room.currentTemp,
      currentLux: room.currentLux,
      motionDetected: room.motionDetected,
      lastMotion: room.lastMotion,
      lastUpdate: room.lastUpdate,
      readings: room.readings
    };
  }

  getLastPollTime() {
    return this.lastPollTime;
  }
}

export const dataStore = new DataStore();
