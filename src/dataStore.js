class DataStore {
  constructor() {
    this.rooms = new Map();
    this.lastPollTime = null;
  }

  addReading(roomId, roomName, temperature, lux, motionDetected, lastMotion) {
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
      timestamp: Date.now(),
      temp: temperature,
      motion: motionDetected
    });

    room.currentTemp = temperature;
    room.currentLux = lux;
    room.motionDetected = motionDetected;
    room.lastMotion = lastMotion;
    room.lastUpdate = new Date();

    // Keep all readings until app shutdown (as per requirement)
    this.lastPollTime = new Date();
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
