import express from 'express';
import { dataStore } from '../dataStore.js';

const router = express.Router();

// GET /api/rooms - Get all rooms with current temperatures
router.get('/rooms', (req, res) => {
  try {
    const rooms = dataStore.getAllRooms();
    res.json({
      success: true,
      rooms: rooms,
      lastPoll: dataStore.getLastPollTime()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/rooms/:roomId - Get detailed room data with full history
router.get('/rooms/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;
    const room = dataStore.getRoomDetail(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }

    res.json({
      success: true,
      room: room
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/health - Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    lastPoll: dataStore.getLastPollTime(),
    roomCount: dataStore.getAllRooms().length,
    uptime: process.uptime()
  });
});

export default router;
