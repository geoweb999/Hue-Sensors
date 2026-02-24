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

// ── Hue API v2 routes ─────────────────────────────────────────────────────────

// Server-side hex → CIE xy conversion (Wide RGB D65 matrix, matches frontend)
function hexToXy(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const rLin = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  const gLin = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  const bLin = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
  const X = rLin * 0.664511 + gLin * 0.154324 + bLin * 0.162028;
  const Y = rLin * 0.283881 + gLin * 0.668433 + bLin * 0.047685;
  const Z = rLin * 0.000088 + gLin * 0.072310 + bLin * 0.986039;
  const sum = X + Y + Z;
  if (sum === 0) return { x: 0, y: 0 };
  return { x: parseFloat((X / sum).toFixed(4)), y: parseFloat((Y / sum).toFixed(4)) };
}

// Helper: resolve v2 UUIDs from a v1 group ID
// Returns { roomV2Id, groupedLightId, lightIdMap: { v1LightId: v2LightId } }
async function resolveV2Ids(v1GroupId) {
  const [roomsResp, lightsResp] = await Promise.all([
    hueClient.v2GetRooms(),
    hueClient.v2GetLights()
  ]);

  // Log unexpected bridge responses (e.g. auth errors return {errors:[...]} with no .data)
  if (!roomsResp.data) {
    console.error('[v2] v2GetRooms unexpected response:', JSON.stringify(roomsResp));
  }
  if (!lightsResp.data) {
    console.error('[v2] v2GetLights unexpected response:', JSON.stringify(lightsResp));
  }

  const rooms = roomsResp.data || [];
  const lights = lightsResp.data || [];

  const room = rooms.find(r => r.id_v1 === `/groups/${v1GroupId}`);
  if (!room) {
    console.error(`[v2] No room found for /groups/${v1GroupId}. Available id_v1 values:`, rooms.map(r => r.id_v1));
    throw new Error(`No v2 room found for group ${v1GroupId}`);
  }

  const glService = (room.services || []).find(s => s.rtype === 'grouped_light');
  if (!glService) throw new Error(`No grouped_light for room ${room.id}`);

  // Build v1 lightId → v2 lightId map
  const lightIdMap = {};
  for (const light of lights) {
    if (light.id_v1) {
      const v1Id = light.id_v1.replace('/lights/', '');
      lightIdMap[v1Id] = light.id;
    }
  }

  return { roomV2Id: room.id, groupedLightId: glService.rid, lightIdMap };
}

// GET /api/v2/rooms/:groupId/info - v2 IDs for a room (used by frontend on page load)
router.get('/v2/rooms/:groupId/info', async (req, res) => {
  try {
    const { groupId } = req.params;
    const ids = await resolveV2Ids(groupId);
    res.json({ success: true, ...ids });
  } catch (error) {
    console.error('[v2] /info route error for group', req.params.groupId + ':', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v2/rooms/:groupId/effect - apply named effect to whole room
// Body: { effect: "candle" | "fire" | "sparkle" | "colorloop" | "cosmos" | "enchant" | "sunbeam" | "underwater" | "no_effect" }
router.put('/v2/rooms/:groupId/effect', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { effect } = req.body;
    if (!effect) return res.status(400).json({ success: false, error: 'effect is required' });

    const { groupedLightId } = await resolveV2Ids(groupId);
    const result = await hueClient.v2SetRoomEffect(groupedLightId, effect);
    const errors = (result.errors || []);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v2/lights/:v2LightId/effect - apply named effect to a single light
// Body: { effect: "candle" }
router.put('/v2/lights/:v2LightId/effect', async (req, res) => {
  try {
    const { v2LightId } = req.params;
    const { effect } = req.body;
    if (!effect) return res.status(400).json({ success: false, error: 'effect is required' });

    const result = await hueClient.v2SetLightEffect(v2LightId, effect);
    const errors = (result.errors || []);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v2/rooms/:groupId/dynamic-scene - create a dynamic palette scene on the bridge
// Body: { name: string, palette: [{hex: "#rrggbb", brightness: 0-100}], speed: 0-1 }
router.post('/v2/rooms/:groupId/dynamic-scene', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name, palette, speed = 0.5 } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    if (!Array.isArray(palette) || palette.length < 2) {
      return res.status(400).json({ success: false, error: 'palette must have at least 2 colors' });
    }

    const { roomV2Id, lightIdMap } = await resolveV2Ids(groupId);

    // Convert hex + brightness into v2 palette format
    const v2Palette = palette.map(({ hex, brightness = 80 }) => ({
      color: { xy: hexToXy(hex) },
      dimming: { brightness: Math.max(1, Math.min(100, brightness)) }
    }));

    // Build actions array — required by SceneServicePost schema.
    // Distribute palette colors round-robin across lights for the initial state.
    const lightV2Ids = Object.values(lightIdMap);
    const actions = lightV2Ids.map((lightId, i) => {
      const colorEntry = v2Palette[i % v2Palette.length];
      return {
        target: { rid: lightId, rtype: 'light' },
        action: {
          on: { on: true },
          dimming: { brightness: colorEntry.dimming.brightness },
          color: { xy: colorEntry.color.xy }
        }
      };
    });

    const result = await hueClient.v2CreateDynamicScene(name.trim(), roomV2Id, v2Palette, actions);
    const errors = (result.errors || []);
    if (errors.length > 0) {
      const errMsg = errors.map(e => e.description).join('; ');
      return res.status(400).json({ success: false, error: errMsg });
    }

    // Bridge returns { data: [{ rid: "<sceneId>", rtype: "scene" }] }
    const sceneId = result.data?.[0]?.rid;
    if (!sceneId) return res.status(500).json({ success: false, error: 'Bridge did not return a scene ID' });

    // Immediately start the animation at the requested speed
    await hueClient.v2RecallScene(sceneId, 'dynamic_palette', speed);

    res.json({ success: true, sceneId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v2/scenes/:sceneId/recall - play or stop a dynamic scene
// Body: { action: "dynamic_palette", speed: 0-1 }  or  { action: "active" }
router.put('/v2/scenes/:sceneId/recall', async (req, res) => {
  try {
    const { sceneId } = req.params;
    const { action, speed = 0.5 } = req.body;
    if (!action) return res.status(400).json({ success: false, error: 'action is required' });

    const result = await hueClient.v2RecallScene(sceneId, action, speed);
    const errors = (result.errors || []);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v2/scenes/:sceneId - delete a v2 dynamic scene
router.delete('/v2/scenes/:sceneId', async (req, res) => {
  try {
    const { sceneId } = req.params;
    const result = await hueClient.v2DeleteScene(sceneId);
    const errors = (result.errors || []);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
