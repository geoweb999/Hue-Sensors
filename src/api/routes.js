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

// GET /api/rooms/:groupId/detail - Room detail with lights, scenes, automations
router.get('/rooms/:groupId/detail', async (req, res) => {
  try {
    const { groupId } = req.params;
    const [lightsData, groupsData, scenesData, schedulesData, rulesData] = await Promise.all([
      hueClient.getLights(),
      hueClient.getGroups(),
      hueClient.getScenes(),
      hueClient.getSchedules(),
      hueClient.getRules()
    ]);

    const group = groupsData[groupId];
    if (!group || group.type !== 'Room') {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Build lights list with full state
    const lights = (group.lights || []).map(lightId => {
      const light = lightsData[lightId];
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
        ct: light.state?.ct,
        effect: light.state?.effect || 'none'
      };
    }).filter(Boolean);

    // Filter scenes belonging to this group
    const scenes = Object.entries(scenesData)
      .filter(([, s]) => s.group === groupId || (s.type === 'GroupScene' && s.group === groupId))
      .map(([id, s]) => ({ id, name: s.name, type: s.type, lights: s.lights || [], locked: !!s.locked }));

    // Filter schedules that reference this group
    const groupActionPattern = `/groups/${groupId}/action`;
    const schedules = Object.entries(schedulesData)
      .filter(([, s]) => s.command?.address?.includes(groupActionPattern) || s.command?.address?.includes(`/groups/${groupId}`))
      .map(([id, s]) => ({
        id,
        name: s.name,
        description: s.description || '',
        status: s.status,
        time: s.localtime || s.time || '',
        command: s.command
      }));

    // Filter rules that affect this group
    const rules = Object.entries(rulesData)
      .filter(([, r]) => (r.actions || []).some(a => a.address?.includes(`/groups/${groupId}`)))
      .map(([id, r]) => ({
        id,
        name: r.name,
        status: r.status,
        conditions: r.conditions || [],
        actions: r.actions || []
      }));

    res.json({
      success: true,
      room: {
        id: groupId,
        name: group.name,
        allOn: group.state?.all_on || false,
        anyOn: group.state?.any_on || false,
        brightness: group.action?.bri || 0,
        lights,
        scenes,
        schedules,
        rules
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/rooms/:groupId/scenes - Save current lighting as a new scene
router.post('/rooms/:groupId/scenes', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Scene name is required' });
    }

    const groupsData = await hueClient.getGroups();
    const group = groupsData[groupId];
    if (!group || group.type !== 'Room') {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    const sceneId = await hueClient.createScene(name.trim(), groupId, group.lights || []);
    res.json({ success: true, sceneId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/rooms/:groupId/scene - Activate a scene
router.put('/rooms/:groupId/scene', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { sceneId } = req.body;
    if (!sceneId) {
      return res.status(400).json({ success: false, error: 'sceneId is required' });
    }
    const result = await hueClient.activateScene(groupId, sceneId);
    const errors = (Array.isArray(result) ? result : []).filter(r => r.error);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors: errors.map(e => e.error) });
    }
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/scenes/:sceneId - Delete a scene
router.delete('/scenes/:sceneId', async (req, res) => {
  try {
    const { sceneId } = req.params;
    const result = await hueClient.deleteScene(sceneId);
    const errors = (Array.isArray(result) ? result : []).filter(r => r.error);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors: errors.map(e => e.error) });
    }
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/rooms/:groupId/state - Set group state (all lights in room)
router.put('/rooms/:groupId/state', async (req, res) => {
  try {
    const { groupId } = req.params;
    const stateObj = req.body;
    const allowedKeys = ['on', 'bri', 'hue', 'sat', 'xy', 'ct', 'effect', 'alert', 'transitiontime'];
    const filtered = {};
    for (const key of Object.keys(stateObj)) {
      if (allowedKeys.includes(key)) filtered[key] = stateObj[key];
    }
    if (Object.keys(filtered).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid state properties provided' });
    }
    const result = await hueClient.setGroupState(groupId, filtered);
    const errors = (Array.isArray(result) ? result : []).filter(r => r.error);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors: errors.map(e => e.error) });
    }
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/lights/:id/state - Set light state on the bridge
router.put('/lights/:id/state', async (req, res) => {
  try {
    const { id } = req.params;
    const stateObj = req.body;

    // Only allow known Hue state keys
    const allowedKeys = ['on', 'bri', 'hue', 'sat', 'xy', 'ct', 'effect', 'alert', 'transitiontime'];
    const filtered = {};
    for (const key of Object.keys(stateObj)) {
      if (allowedKeys.includes(key)) {
        filtered[key] = stateObj[key];
      }
    }

    if (Object.keys(filtered).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid state properties provided' });
    }

    const result = await hueClient.setLightState(id, filtered);

    const errors = (Array.isArray(result) ? result : []).filter(r => r.error);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors: errors.map(e => e.error) });
    }

    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
