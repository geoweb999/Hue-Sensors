import express from 'express';
import { dataStore } from '../dataStore.js';
import { getDatabase } from '../database.js';
import { hueClient } from '../hueClient.js';

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

// GET /api/stats - Database statistics endpoint
router.get('/stats', (req, res) => {
  try {
    const database = getDatabase();
    const stats = database.getStats();

    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/lights - Get all lights grouped by room
router.get('/lights', async (req, res) => {
  try {
    const [lightsData, groupsData] = await Promise.all([
      hueClient.getLights(),
      hueClient.getGroups()
    ]);

    // Build lights lookup
    const lights = {};
    for (const [id, light] of Object.entries(lightsData)) {
      lights[id] = { id, ...light };
    }

    // Build rooms from groups (only type "Room")
    const rooms = [];
    for (const [groupId, group] of Object.entries(groupsData)) {
      if (group.type === 'Room') {
        const roomLights = (group.lights || []).map(lightId => {
          const light = lights[lightId];
          if (!light) return null;
          return {
            id: lightId,
            name: light.name,
            type: light.type,
            modelid: light.modelid,
            on: light.state?.on || false,
            reachable: light.state?.reachable || false,
            brightness: light.state?.bri || 0,
            colormode: light.state?.colormode || null,
            hue: light.state?.hue,
            sat: light.state?.sat,
            xy: light.state?.xy,
            ct: light.state?.ct
          };
        }).filter(Boolean);

        rooms.push({
          id: groupId,
          name: group.name,
          allOn: group.state?.all_on || false,
          anyOn: group.state?.any_on || false,
          lights: roomLights
        });
      }
    }

    // Collect ungrouped lights
    const groupedLightIds = new Set(rooms.flatMap(r => r.lights.map(l => l.id)));
    const ungroupedLights = Object.values(lights)
      .filter(l => !groupedLightIds.has(l.id))
      .map(light => ({
        id: light.id,
        name: light.name,
        type: light.type,
        modelid: light.modelid,
        on: light.state?.on || false,
        reachable: light.state?.reachable || false,
        brightness: light.state?.bri || 0,
        colormode: light.state?.colormode || null,
        hue: light.state?.hue,
        sat: light.state?.sat,
        xy: light.state?.xy,
        ct: light.state?.ct
      }));

    if (ungroupedLights.length > 0) {
      rooms.push({
        id: 'ungrouped',
        name: 'Other Lights',
        allOn: ungroupedLights.every(l => l.on),
        anyOn: ungroupedLights.some(l => l.on),
        lights: ungroupedLights
      });
    }

    res.json({ success: true, rooms });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
