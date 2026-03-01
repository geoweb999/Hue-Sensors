import express from 'express';
import { dataStore } from '../dataStore.js';
import { getDatabase } from '../database.js';
import { hueClient } from '../hueClient.js';
import { logger } from '../logger.js';

const router = express.Router();

function requestContext(req) {
  return {
    requestId: req.requestId,
    method: req.method,
    route: req.originalUrl
  };
}

const SURPRISE_STYLES = [
  {
    id: 'pastel-bloom',
    name: 'Pastel Bloom',
    description: 'Soft low-contrast pastels with airy brightness.',
    samplePalette: ['#f6b8d0', '#c8d8ff', '#c4f0dd', '#fff0b9']
  },
  {
    id: 'contrast-pop',
    name: 'Contrast Pop',
    description: 'Bold complementary pairs with punchy saturation.',
    samplePalette: ['#ef476f', '#06d6a0', '#ffd166', '#118ab2']
  },
  {
    id: 'sunset-glow',
    name: 'Sunset Glow',
    description: 'Warm oranges, rose tones, and amber dusk colors.',
    samplePalette: ['#ff8a5b', '#ff5f87', '#ffb347', '#ff6f61']
  },
  {
    id: 'ocean-mist',
    name: 'Ocean Mist',
    description: 'Calm blue-green gradients inspired by coastal light.',
    samplePalette: ['#66d9ef', '#3f88c5', '#63cdda', '#9ad1ff']
  },
  {
    id: 'forest-earth',
    name: 'Forest & Earth',
    description: 'Natural greens with moss, bark, and warm earth accents.',
    samplePalette: ['#7cb342', '#4caf50', '#a1887f', '#c0ca33']
  },
  {
    id: 'jewel-box',
    name: 'Jewel Box',
    description: 'Deep gem-like colors with rich contrast.',
    samplePalette: ['#7b2cbf', '#3a86ff', '#ff006e', '#00b4d8']
  },
  {
    id: 'candy-mix',
    name: 'Candy Mix',
    description: 'Playful sweet tones with bright, friendly energy.',
    samplePalette: ['#ff6ec7', '#ffd166', '#70e000', '#4cc9f0']
  },
  {
    id: 'mono-drift',
    name: 'Monochrome Drift',
    description: 'Single-hue story with layered shade and tint variation.',
    samplePalette: ['#6d9eeb', '#4a86e8', '#3c78d8', '#9fc5f8']
  },
  {
    id: 'aurora-night',
    name: 'Aurora Night',
    description: 'Northern-light inspired greens, cyans, and violets.',
    samplePalette: ['#80ffdb', '#64dfdf', '#5390d9', '#6930c3']
  },
  {
    id: 'vintage-film',
    name: 'Vintage Film',
    description: 'Muted cinematic palette with nostalgic tones.',
    samplePalette: ['#b08968', '#ddb892', '#a5a58d', '#6b705c']
  }
];

const SURPRISE_STYLE_MAP = new Map(SURPRISE_STYLES.map((style) => [style.id, style]));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hueWrap(hue) {
  const wrapped = hue % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function randomInt(min, max) {
  return Math.floor(randomRange(min, max + 1));
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function hslToHex(h, s, l) {
  const hue = hueWrap(h) / 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;

  if (sat === 0) {
    const value = Math.round(light * 255);
    return `#${value.toString(16).padStart(2, '0').repeat(3)}`;
  }

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channels = [hue + 1 / 3, hue, hue - 1 / 3].map((channel) => {
    let t = channel;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  });

  return `#${channels.map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`;
}

function hslToSwatch(h, s, l) {
  const brightness = Math.round(clamp((l / 100) * 90 + (s / 100) * 10, 20, 100));
  return {
    hex: hslToHex(h, s, l),
    brightness
  };
}

function isColorLightType(type) {
  return type === 'Extended color light' || type === 'Color light';
}

function isCtLightType(type) {
  return type === 'Extended color light' || type === 'Color temperature light';
}

function isDimmableType(type) {
  return type !== 'On/Off plug-in unit';
}

function randomizeAround(baseHue, count, spread, satMin, satMax, lightMin, lightMax) {
  const swatches = [];
  for (let i = 0; i < count; i += 1) {
    const segmentOffset = count <= 1 ? 0 : (i / (count - 1) - 0.5) * spread;
    const hue = baseHue + segmentOffset + randomRange(-8, 8);
    const sat = randomRange(satMin, satMax);
    const light = randomRange(lightMin, lightMax);
    swatches.push(hslToSwatch(hue, sat, light));
  }
  return swatches;
}

function buildSurprisePalette(styleId, count = 4) {
  const size = clamp(Math.round(count), 2, 8);
  const baseHue = randomRange(0, 360);

  switch (styleId) {
    case 'pastel-bloom':
      return randomizeAround(baseHue, size, 90, 35, 58, 72, 86);
    case 'contrast-pop': {
      const swatches = [];
      for (let i = 0; i < size; i += 1) {
        const family = i % 3;
        let hue = baseHue;
        if (family === 1) hue += 180;
        if (family === 2) hue += 90;
        swatches.push(hslToSwatch(hue + randomRange(-12, 12), randomRange(70, 95), randomRange(46, 62)));
      }
      return swatches;
    }
    case 'sunset-glow': {
      const warmHues = [10, 22, 32, 44, 350];
      const swatches = [];
      for (let i = 0; i < size; i += 1) {
        const hue = randomItem(warmHues) + randomRange(-8, 8);
        swatches.push(hslToSwatch(hue, randomRange(62, 88), randomRange(52, 68)));
      }
      return swatches;
    }
    case 'ocean-mist':
      return randomizeAround(200 + randomRange(-15, 15), size, 70, 45, 78, 45, 68);
    case 'forest-earth': {
      const accents = [35, 48, 84, 112, 132];
      const swatches = [];
      for (let i = 0; i < size; i += 1) {
        const hue = randomItem(accents) + randomRange(-10, 10);
        swatches.push(hslToSwatch(hue, randomRange(30, 68), randomRange(34, 62)));
      }
      return swatches;
    }
    case 'jewel-box':
      return randomizeAround(baseHue, size, 220, 65, 92, 34, 58);
    case 'candy-mix':
      return randomizeAround(baseHue, size, 260, 62, 88, 58, 74);
    case 'mono-drift':
      return randomizeAround(baseHue, size, 20, 40, 70, 34, 76);
    case 'aurora-night': {
      const swatches = [];
      const anchors = [155, 178, 210, 255, 285];
      for (let i = 0; i < size; i += 1) {
        const hue = randomItem(anchors) + randomRange(-10, 10);
        swatches.push(hslToSwatch(hue, randomRange(58, 88), randomRange(42, 66)));
      }
      return swatches;
    }
    case 'vintage-film':
      return randomizeAround(baseHue + 35, size, 100, 18, 42, 45, 68);
    default:
      return randomizeAround(baseHue, size, 120, 45, 70, 48, 70);
  }
}

function swatchToCt(swatch) {
  const red = parseInt(swatch.hex.slice(1, 3), 16);
  const blue = parseInt(swatch.hex.slice(5, 7), 16);
  const warmth = clamp((red - blue + 255) / 510, 0, 1);
  return Math.round(153 + (1 - warmth) * (500 - 153));
}

function sanitizeSceneName(rawName, fallback = 'Surprise Scene') {
  const cleaned = String(rawName || '')
    .replace(/[^a-zA-Z0-9 ._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normalized = cleaned || fallback;
  return normalized.slice(0, 32);
}

function isSurpriseSceneName(name) {
  return /^surprise\b/i.test(String(name || '').trim());
}

function inferStyleFromSceneName(sceneName) {
  const normalized = String(sceneName || '').toLowerCase();
  for (const style of SURPRISE_STYLES) {
    if (normalized.includes(style.name.toLowerCase())) {
      return style;
    }
  }
  return null;
}

function normalizeSurprisePalette(palette) {
  if (!Array.isArray(palette)) return null;
  const normalized = [];
  for (const swatch of palette) {
    const hex = String(swatch?.hex || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
    const brightnessValue = Number.parseInt(swatch?.brightness, 10);
    normalized.push({
      hex: hex.toLowerCase(),
      brightness: Number.isFinite(brightnessValue) ? clamp(brightnessValue, 1, 100) : 75
    });
  }
  if (normalized.length < 2 || normalized.length > 8) return null;
  return normalized;
}

async function createSurpriseScene({
  groupId,
  style,
  name,
  basedOnSceneId = null,
  paletteOverride = null
}) {
  const [groupsData, lightsData] = await Promise.all([
    hueClient.getGroups(),
    hueClient.getLights()
  ]);

  const group = groupsData[groupId];
  if (!group || group.type !== 'Room') {
    throw new Error('Room not found');
  }

  const groupLightIds = group.lights || [];
  if (groupLightIds.length === 0) {
    throw new Error('Room has no lights to surprise');
  }

  const paletteSize = Math.max(3, Math.min(6, groupLightIds.length));
  const hasPaletteOverride = Array.isArray(paletteOverride) && paletteOverride.length > 0;
  const basePalette = hasPaletteOverride
    ? paletteOverride
    : buildSurprisePalette(style.id, paletteSize);
  const palette = basePalette.map((swatch) => ({
    ...swatch,
    brightness: hasPaletteOverride
      ? clamp(Number.parseInt(swatch?.brightness, 10) || 75, 1, 100)
      : randomInt(80, 100)
  }));

  const lightAssignments = [];
  for (const lightId of groupLightIds) {
    const light = lightsData[lightId];
    if (!light) continue;

    const swatch = randomItem(palette);
    const state = { on: true };

    if (isDimmableType(light.type)) {
      state.bri = Math.round(clamp((swatch.brightness / 100) * 254, 1, 254));
    }
    if (isColorLightType(light.type)) {
      const xy = hexToXy(swatch.hex);
      state.xy = [xy.x, xy.y];
    } else if (isCtLightType(light.type)) {
      state.ct = swatchToCt(swatch);
    }

    lightAssignments.push({
      lightId,
      lightName: light.name,
      swatch,
      state
    });
  }

  const updateResults = await Promise.all(lightAssignments.map(async (assignment) => {
    try {
      const result = await hueClient.setLightState(assignment.lightId, assignment.state);
      const errors = (Array.isArray(result) ? result : [])
        .filter((entry) => entry.error)
        .map((entry) => entry.error);
      return { lightId: assignment.lightId, errors };
    } catch (error) {
      return { lightId: assignment.lightId, errors: [{ description: error.message }] };
    }
  }));

  const warnings = updateResults.filter((result) => result.errors.length > 0);
  const sceneName = sanitizeSceneName(name || `Surprise ${style.name}`, 'Surprise Scene');

  // Give the bridge a short moment to apply light updates before snapshotting scene state.
  await new Promise((resolve) => setTimeout(resolve, 350));
  const sceneId = await hueClient.createScene(sceneName, groupId, groupLightIds);

  return {
    sceneId,
    sceneName,
    style,
    palette,
    warnings,
    basedOnSceneId,
    lightAssignments: lightAssignments.map((assignment) => ({
      lightId: assignment.lightId,
      lightName: assignment.lightName,
      swatch: assignment.swatch
    }))
  };
}

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

// GET /api/surprises - Surprise style presets for randomized scene creation
router.get('/surprises', (req, res) => {
  res.json({
    success: true,
    styles: SURPRISE_STYLES
  });
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
      logger.warn('SCENE_CREATE_REJECTED', 'Scene create rejected due to missing name', {
        ...requestContext(req),
        groupId
      });
      return res.status(400).json({ success: false, error: 'Scene name is required' });
    }

    const groupsData = await hueClient.getGroups();
    const group = groupsData[groupId];
    if (!group || group.type !== 'Room') {
      logger.warn('SCENE_CREATE_REJECTED', 'Scene create rejected because room was not found', {
        ...requestContext(req),
        groupId
      });
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    const sceneId = await hueClient.createScene(name.trim(), groupId, group.lights || []);
    logger.info('SCENE_CREATE', 'Scene created', {
      ...requestContext(req),
      groupId,
      sceneId,
      name: name.trim(),
      lightCount: (group.lights || []).length
    });
    res.json({ success: true, sceneId });
  } catch (error) {
    logger.error('SCENE_CREATE_ERROR', 'Failed to create scene', {
      ...requestContext(req),
      groupId: req.params.groupId,
      error
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/rooms/:groupId/surprise - Create a randomized scene with cohesive swatches
// Body: { styleId?: string, name?: string }
router.post('/rooms/:groupId/surprise', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { styleId, name } = req.body || {};
    const style = styleId ? SURPRISE_STYLE_MAP.get(styleId) : randomItem(SURPRISE_STYLES);

    if (!style) {
      return res.status(400).json({ success: false, error: `Unknown surprise style: ${styleId}` });
    }
    const requestedName = typeof name === 'string' ? name : '';
    const surprise = await createSurpriseScene({
      groupId,
      style,
      name: requestedName || `Surprise ${style.name}`
    });

    logger.info('SURPRISE_SCENE_CREATE', 'Created surprise scene', {
      ...requestContext(req),
      groupId,
      sceneId: surprise.sceneId,
      sceneName: surprise.sceneName,
      styleId: style.id,
      lightCount: surprise.lightAssignments.length,
      warningCount: surprise.warnings.length
    });

    res.json({
      success: true,
      sceneId: surprise.sceneId,
      sceneName: surprise.sceneName,
      style: {
        id: surprise.style.id,
        name: surprise.style.name,
        description: surprise.style.description
      },
      palette: surprise.palette,
      lightAssignments: surprise.lightAssignments,
      warnings: surprise.warnings
    });
  } catch (error) {
    logger.error('SURPRISE_SCENE_ERROR', 'Failed to create surprise scene', {
      ...requestContext(req),
      groupId: req.params.groupId,
      styleId: req.body?.styleId,
      error
    });
    if (error.message === 'Room not found') {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (error.message === 'Room has no lights to surprise') {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/rooms/:groupId/surprise/remix - Modify an existing surprise and save as a new scene
// Body: { baseSceneId: string, styleId?: string, name?: string }
router.post('/rooms/:groupId/surprise/remix', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { baseSceneId, styleId, name } = req.body || {};

    if (!baseSceneId) {
      return res.status(400).json({ success: false, error: 'baseSceneId is required' });
    }

    const scenesData = await hueClient.getScenes();
    const baseScene = scenesData[baseSceneId];
    if (!baseScene) {
      return res.status(404).json({ success: false, error: 'Base scene not found' });
    }

    if (String(baseScene.group) !== String(groupId)) {
      return res.status(400).json({ success: false, error: 'Base scene does not belong to this room' });
    }

    if (!isSurpriseSceneName(baseScene.name)) {
      return res.status(400).json({ success: false, error: 'Base scene is not a surprise scene' });
    }

    const style = styleId
      ? SURPRISE_STYLE_MAP.get(styleId)
      : inferStyleFromSceneName(baseScene.name) || randomItem(SURPRISE_STYLES);

    if (!style) {
      return res.status(400).json({ success: false, error: `Unknown surprise style: ${styleId}` });
    }

    const requestedName = typeof name === 'string' ? name : '';
    const defaultName = `${baseScene.name} Remix`;
    const surprise = await createSurpriseScene({
      groupId,
      style,
      name: requestedName || defaultName,
      basedOnSceneId: baseSceneId
    });

    logger.info('SURPRISE_SCENE_REMIX', 'Remixed surprise scene into new scene', {
      ...requestContext(req),
      groupId,
      baseSceneId,
      newSceneId: surprise.sceneId,
      styleId: style.id,
      warningCount: surprise.warnings.length
    });

    res.json({
      success: true,
      sceneId: surprise.sceneId,
      sceneName: surprise.sceneName,
      basedOnSceneId: baseSceneId,
      style: {
        id: surprise.style.id,
        name: surprise.style.name,
        description: surprise.style.description
      },
      palette: surprise.palette,
      lightAssignments: surprise.lightAssignments,
      warnings: surprise.warnings
    });
  } catch (error) {
    logger.error('SURPRISE_SCENE_REMIX_ERROR', 'Failed to remix surprise scene', {
      ...requestContext(req),
      groupId: req.params.groupId,
      baseSceneId: req.body?.baseSceneId,
      styleId: req.body?.styleId,
      error
    });
    if (error.message === 'Room not found') {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (error.message === 'Room has no lights to surprise') {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/rooms/:groupId/surprise/custom - Edit surprise with custom swatches and create a new scene
// Body: { baseSceneId?: string, styleId?: string, name?: string, palette: [{hex, brightness}], replaceExisting?: boolean }
router.post('/rooms/:groupId/surprise/custom', async (req, res) => {
  try {
    const { groupId } = req.params;
    const {
      baseSceneId = null,
      styleId = null,
      name = '',
      palette,
      replaceExisting = false
    } = req.body || {};

    const normalizedPalette = normalizeSurprisePalette(palette);
    if (!normalizedPalette) {
      return res.status(400).json({
        success: false,
        error: 'palette must contain 2-8 swatches with valid hex colors and brightness (1-100)'
      });
    }

    let baseScene = null;
    if (baseSceneId) {
      const scenesData = await hueClient.getScenes();
      baseScene = scenesData[baseSceneId];
      if (!baseScene) {
        return res.status(404).json({ success: false, error: 'Base scene not found' });
      }
      if (String(baseScene.group) !== String(groupId)) {
        return res.status(400).json({ success: false, error: 'Base scene does not belong to this room' });
      }
      if (!isSurpriseSceneName(baseScene.name)) {
        return res.status(400).json({ success: false, error: 'Base scene is not a surprise scene' });
      }
    }

    const style = styleId
      ? SURPRISE_STYLE_MAP.get(styleId)
      : (baseScene ? inferStyleFromSceneName(baseScene.name) : null) || {
          id: 'custom-surprise',
          name: 'Custom Surprise',
          description: 'User-defined surprise swatches.'
        };

    if (!style) {
      return res.status(400).json({ success: false, error: `Unknown surprise style: ${styleId}` });
    }

    const requestedName = typeof name === 'string' ? name.trim() : '';
    const defaultName = baseScene?.name || `Surprise ${style.name}`;
    const surprise = await createSurpriseScene({
      groupId,
      style,
      name: requestedName || defaultName,
      basedOnSceneId: baseSceneId || null,
      paletteOverride: normalizedPalette
    });

    let replacedSceneId = null;
    const replaceWarnings = [];
    if (replaceExisting && baseSceneId && baseScene) {
      if (baseScene.locked) {
        replaceWarnings.push({ description: 'Base scene is locked and could not be deleted' });
      } else {
        const deleteResult = await hueClient.deleteScene(baseSceneId);
        const deleteErrors = (Array.isArray(deleteResult) ? deleteResult : [])
          .filter((entry) => entry.error)
          .map((entry) => entry.error);
        if (deleteErrors.length > 0) {
          replaceWarnings.push(...deleteErrors);
        } else {
          replacedSceneId = baseSceneId;
        }
      }
    }

    logger.info('SURPRISE_SCENE_CUSTOM', 'Created custom surprise scene', {
      ...requestContext(req),
      groupId,
      sceneId: surprise.sceneId,
      basedOnSceneId: baseSceneId || null,
      replacedSceneId,
      styleId: surprise.style.id,
      paletteSize: normalizedPalette.length,
      warningCount: surprise.warnings.length + replaceWarnings.length
    });

    res.json({
      success: true,
      sceneId: surprise.sceneId,
      sceneName: surprise.sceneName,
      basedOnSceneId: baseSceneId || null,
      replacedSceneId,
      style: {
        id: surprise.style.id,
        name: surprise.style.name,
        description: surprise.style.description
      },
      palette: surprise.palette,
      lightAssignments: surprise.lightAssignments,
      warnings: [...surprise.warnings, ...replaceWarnings]
    });
  } catch (error) {
    logger.error('SURPRISE_SCENE_CUSTOM_ERROR', 'Failed to create custom surprise scene', {
      ...requestContext(req),
      groupId: req.params.groupId,
      baseSceneId: req.body?.baseSceneId,
      styleId: req.body?.styleId,
      error
    });
    if (error.message === 'Room not found') {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (error.message === 'Room has no lights to surprise') {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/rooms/:groupId/scene - Activate a scene
router.put('/rooms/:groupId/scene', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { sceneId } = req.body;
    if (!sceneId) {
      logger.warn('SCENE_ACTIVATE_REJECTED', 'Scene activation rejected due to missing sceneId', {
        ...requestContext(req),
        groupId
      });
      return res.status(400).json({ success: false, error: 'sceneId is required' });
    }
    const result = await hueClient.activateScene(groupId, sceneId);
    const errors = (Array.isArray(result) ? result : []).filter(r => r.error);
    if (errors.length > 0) {
      logger.warn('SCENE_ACTIVATE_REJECTED', 'Scene activation returned bridge errors', {
        ...requestContext(req),
        groupId,
        sceneId,
        errorCount: errors.length
      });
      return res.status(400).json({ success: false, errors: errors.map(e => e.error) });
    }
    logger.info('SCENE_ACTIVATE', 'Scene activated', {
      ...requestContext(req),
      groupId,
      sceneId
    });
    res.json({ success: true, result });
  } catch (error) {
    logger.error('SCENE_ACTIVATE_ERROR', 'Failed to activate scene', {
      ...requestContext(req),
      groupId: req.params.groupId,
      sceneId: req.body?.sceneId,
      error
    });
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
      logger.warn('SCENE_DELETE_REJECTED', 'Scene deletion returned bridge errors', {
        ...requestContext(req),
        sceneId,
        errorCount: errors.length
      });
      return res.status(400).json({ success: false, errors: errors.map(e => e.error) });
    }
    logger.info('SCENE_DELETE', 'Scene deleted', {
      ...requestContext(req),
      sceneId
    });
    res.json({ success: true, result });
  } catch (error) {
    logger.error('SCENE_DELETE_ERROR', 'Failed to delete scene', {
      ...requestContext(req),
      sceneId: req.params.sceneId,
      error
    });
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
      logger.warn('GROUP_STATE_REJECTED', 'Group state update rejected due to invalid payload', {
        ...requestContext(req),
        groupId
      });
      return res.status(400).json({ success: false, error: 'No valid state properties provided' });
    }
    const result = await hueClient.setGroupState(groupId, filtered);
    const errors = (Array.isArray(result) ? result : []).filter(r => r.error);
    if (errors.length > 0) {
      logger.warn('GROUP_STATE_REJECTED', 'Group state update returned bridge errors', {
        ...requestContext(req),
        groupId,
        stateKeys: Object.keys(filtered),
        errorCount: errors.length
      });
      return res.status(400).json({ success: false, errors: errors.map(e => e.error) });
    }
    logger.info('GROUP_STATE_SET', 'Group state updated', {
      ...requestContext(req),
      groupId,
      stateKeys: Object.keys(filtered)
    });
    res.json({ success: true, result });
  } catch (error) {
    logger.error('GROUP_STATE_ERROR', 'Failed to set group state', {
      ...requestContext(req),
      groupId: req.params.groupId,
      error
    });
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
      logger.warn('LIGHT_STATE_REJECTED', 'Light state update rejected due to invalid payload', {
        ...requestContext(req),
        lightId: id
      });
      return res.status(400).json({ success: false, error: 'No valid state properties provided' });
    }

    const result = await hueClient.setLightState(id, filtered);

    const errors = (Array.isArray(result) ? result : []).filter(r => r.error);
    if (errors.length > 0) {
      logger.warn('LIGHT_STATE_REJECTED', 'Light state update returned bridge errors', {
        ...requestContext(req),
        lightId: id,
        stateKeys: Object.keys(filtered),
        errorCount: errors.length
      });
      return res.status(400).json({ success: false, errors: errors.map(e => e.error) });
    }

    logger.info('LIGHT_STATE_SET', 'Light state updated', {
      ...requestContext(req),
      lightId: id,
      stateKeys: Object.keys(filtered)
    });
    res.json({ success: true, result });
  } catch (error) {
    logger.error('LIGHT_STATE_ERROR', 'Failed to set light state', {
      ...requestContext(req),
      lightId: req.params.id,
      error
    });
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
    logger.warn('V2_RESOLVE_IDS_UNEXPECTED_ROOMS', 'v2GetRooms returned unexpected payload', {
      hasData: false
    });
  }
  if (!lightsResp.data) {
    logger.warn('V2_RESOLVE_IDS_UNEXPECTED_LIGHTS', 'v2GetLights returned unexpected payload', {
      hasData: false
    });
  }

  const rooms = roomsResp.data || [];
  const lights = lightsResp.data || [];

  const room = rooms.find(r => r.id_v1 === `/groups/${v1GroupId}`);
  if (!room) {
    logger.error('V2_ROOM_NOT_FOUND', 'No v2 room found for v1 group', {
      groupId: v1GroupId,
      availableRoomIds: rooms.map(r => r.id_v1)
    });
    throw new Error(`No v2 room found for group ${v1GroupId}`);
  }

  const glService = (room.services || []).find(s => s.rtype === 'grouped_light');
  if (!glService) throw new Error(`No grouped_light for room ${room.id}`);

  // Collect device RIDs that belong to this room
  const roomDeviceRids = new Set(
    (room.children || []).filter(c => c.rtype === 'device').map(c => c.rid)
  );

  // Build v1 lightId → v2 lightId map, plus per-light capability flags.
  // Only include lights whose owner device is in this room — the bridge
  // rejects scene actions that reference lights outside the group.
  const lightIdMap = {};
  const lightCapMap = {};  // v2LightId → { hasDimming, hasColor }
  for (const light of lights) {
    if (light.id_v1 && light.owner && roomDeviceRids.has(light.owner.rid)) {
      const v1Id = light.id_v1.replace('/lights/', '');
      lightIdMap[v1Id] = light.id;
      lightCapMap[light.id] = {
        hasDimming: 'dimming' in light,
        hasColor: 'color' in light
      };
    }
  }

  return { roomV2Id: room.id, groupedLightId: glService.rid, lightIdMap, lightCapMap };
}

// GET /api/v2/rooms/:groupId/info - v2 IDs for a room (used by frontend on page load)
router.get('/v2/rooms/:groupId/info', async (req, res) => {
  try {
    const { groupId } = req.params;
    const ids = await resolveV2Ids(groupId);
    res.json({ success: true, ...ids });
  } catch (error) {
    logger.error('V2_ROOM_INFO_ERROR', 'Failed to resolve v2 IDs for room', {
      ...requestContext(req),
      groupId: req.params.groupId,
      error
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v2/rooms/:groupId/effect - apply named effect to whole room
// Body: { effect: "candle" | "fire" | "sparkle" | "colorloop" | "cosmos" | "enchant" | "sunbeam" | "underwater" | "no_effect" }
router.put('/v2/rooms/:groupId/effect', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { effect } = req.body;
    if (!effect) {
      logger.warn('V2_EFFECT_REJECTED', 'Room effect update rejected due to missing effect', {
        ...requestContext(req),
        targetType: 'room',
        groupId
      });
      return res.status(400).json({ success: false, error: 'effect is required' });
    }

    const { groupedLightId } = await resolveV2Ids(groupId);
    const result = await hueClient.v2SetRoomEffect(groupedLightId, effect);
    const errors = (result.errors || []);
    if (errors.length > 0) {
      logger.warn('V2_EFFECT_REJECTED', 'Room effect update returned bridge errors', {
        ...requestContext(req),
        targetType: 'room',
        groupId,
        groupedLightId,
        effect,
        errorCount: errors.length
      });
      return res.status(400).json({ success: false, errors });
    }
    logger.info('V2_EFFECT_SET', 'Room effect updated', {
      ...requestContext(req),
      targetType: 'room',
      groupId,
      groupedLightId,
      effect
    });
    res.json({ success: true, result });
  } catch (error) {
    logger.error('V2_EFFECT_ERROR', 'Failed to set room effect', {
      ...requestContext(req),
      targetType: 'room',
      groupId: req.params.groupId,
      effect: req.body?.effect,
      error
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v2/lights/:v2LightId/effect - apply named effect to a single light
// Body: { effect: "candle" }
router.put('/v2/lights/:v2LightId/effect', async (req, res) => {
  try {
    const { v2LightId } = req.params;
    const { effect } = req.body;
    if (!effect) {
      logger.warn('V2_EFFECT_REJECTED', 'Light effect update rejected due to missing effect', {
        ...requestContext(req),
        targetType: 'light',
        lightId: v2LightId
      });
      return res.status(400).json({ success: false, error: 'effect is required' });
    }

    const result = await hueClient.v2SetLightEffect(v2LightId, effect);
    const errors = (result.errors || []);
    if (errors.length > 0) {
      logger.warn('V2_EFFECT_REJECTED', 'Light effect update returned bridge errors', {
        ...requestContext(req),
        targetType: 'light',
        lightId: v2LightId,
        effect,
        errorCount: errors.length
      });
      return res.status(400).json({ success: false, errors });
    }
    logger.info('V2_EFFECT_SET', 'Light effect updated', {
      ...requestContext(req),
      targetType: 'light',
      lightId: v2LightId,
      effect
    });
    res.json({ success: true, result });
  } catch (error) {
    logger.error('V2_EFFECT_ERROR', 'Failed to set light effect', {
      ...requestContext(req),
      targetType: 'light',
      lightId: req.params.v2LightId,
      effect: req.body?.effect,
      error
    });
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

    const { roomV2Id, lightIdMap, lightCapMap } = await resolveV2Ids(groupId);

    // Convert hex + brightness into v2 palette format
    const v2Palette = palette.map(({ hex, brightness = 80 }) => ({
      color: { xy: hexToXy(hex) },
      dimming: { brightness: Math.max(1, Math.min(100, brightness)) }
    }));

    // Build actions array — required by SceneServicePost schema.
    // Distribute palette colors round-robin. Only include dimming/color for
    // lights that support them (on/off-only plugs support neither).
    const lightV2Ids = Object.values(lightIdMap);
    const actions = lightV2Ids.map((lightId, i) => {
      const colorEntry = v2Palette[i % v2Palette.length];
      const caps = lightCapMap[lightId] || {};
      const action = { on: { on: true } };
      if (caps.hasDimming) action.dimming = { brightness: colorEntry.dimming.brightness };
      if (caps.hasColor) action.color = { xy: colorEntry.color.xy };
      return { target: { rid: lightId, rtype: 'light' }, action };
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
    const recallResult = await hueClient.v2RecallScene(sceneId, 'dynamic_palette', speed);
    const recallErrors = (recallResult.errors || []);
    if (recallErrors.length > 0) {
      const errMsg = recallErrors.map(e => e.description).join('; ');
      return res.status(400).json({ success: false, error: `Scene created but failed to start animation: ${errMsg}` });
    }

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
