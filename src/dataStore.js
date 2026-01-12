import { getDatabase } from './database.js';

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

  // Load all historical data from database
  loadFromDatabase() {
    if (!this.database) {
      console.warn('Database not initialized, skipping data load');
      return;
    }

    console.log('Loading historical data from database...');

    try {
      const allReadings = this.database.getAllReadings();

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
      console.log(`Loaded ${totalReadings} readings across ${roomCount} rooms from database`);

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
