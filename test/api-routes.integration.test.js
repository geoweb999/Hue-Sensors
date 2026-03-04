import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDatabase } from './helpers/fakeDatabase.js';
import { hueClient } from '../src/hueClient.js';
import { accessorySnapshotService } from '../src/accessorySnapshotService.js';
import { sceneLoopService } from '../src/sceneLoopService.js';
import apiRoutes from '../src/api/routes.js';

const MOCKED_METHODS = [
  'getLights',
  'getGroups',
  'getScenes',
  'getSchedules',
  'getRules',
  'getSensors',
  'activateScene',
  'v2RecallScene',
  'v2GetRooms',
  'v2GetZones',
  'v2GetLights',
  'v2GetTemperature',
  'v2GetMotion',
  'v2GetLightLevel',
  'v2GetButtons',
  'v2GetDevicePower',
  'v2GetZigbeeConnectivity',
  'v2GetDevices'
];

const originalHueMethods = Object.fromEntries(
  MOCKED_METHODS.map((name) => [name, hueClient[name]])
);

function getRouteHandler(method, path) {
  const layer = apiRoutes.stack.find((entry) => (
    entry?.route
    && entry.route.path === path
    && entry.route.methods?.[method.toLowerCase()]
  ));
  if (!layer) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function invokeRoute(method, path, { params = {}, body = {} } = {}) {
  const handler = getRouteHandler(method, path);
  const req = {
    method: method.toUpperCase(),
    originalUrl: `/api/${path}`,
    params,
    body,
    requestId: 'test-request-id'
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  await handler(req, res);
  return { status: res.statusCode, body: res.body };
}

function restoreHueClient() {
  for (const [name, fn] of Object.entries(originalHueMethods)) {
    hueClient[name] = fn;
  }
}

function resetSnapshotService() {
  accessorySnapshotService.stop();
  accessorySnapshotService.snapshots = new Map();
  accessorySnapshotService.refreshInFlight = null;
  accessorySnapshotService.lastError = null;
  accessorySnapshotService.lastUpdated = null;
}

test.afterEach(() => {
  restoreHueClient();
  resetSnapshotService();
  sceneLoopService.stop();
  sceneLoopService.runtime.clear();
});

test('room detail degrades gracefully when scenes/schedules/rules fail', async () => {
  hueClient.getGroups = async () => ({
    1: {
      type: 'Room',
      name: 'Living Room',
      lights: ['10'],
      state: { all_on: true, any_on: true },
      action: { bri: 120 }
    }
  });
  hueClient.getLights = async () => ({
    10: {
      name: 'Ceiling',
      type: 'Extended color light',
      modelid: 'LCT010',
      state: {
        on: true,
        reachable: true,
        bri: 200,
        colormode: 'hs',
        hue: 10000,
        sat: 120,
        xy: [0.31, 0.33],
        ct: 300
      }
    }
  });
  hueClient.getScenes = async () => { throw new Error('Hue bridge returned HTML instead of JSON'); };
  hueClient.getSchedules = async () => { throw new Error('Hue bridge returned HTML instead of JSON'); };
  hueClient.getRules = async () => { throw new Error('Hue bridge returned HTML instead of JSON'); };

  const { body } = await invokeRoute('get', '/rooms/:groupId/detail', {
    params: { groupId: '1' }
  });
  assert.equal(body.success, true);
  assert.equal(body.room.name, 'Living Room');
  assert.equal(Array.isArray(body.room.scenes), true);
  assert.equal(body.room.scenes.length, 0);
  assert.equal(Array.isArray(body.warnings), true);
  assert.ok(body.warnings.some((warning) => warning.startsWith('scenes:')));
});

test('loop routes support configure/start/status/stop with mocked bridge', async () => {
  const fakeDb = new FakeDatabase();
  sceneLoopService.setDatabase(fakeDb);
  sceneLoopService.stop();
  hueClient.activateScene = async () => [];

  const payload = {
    playlist: [{ sceneId: 'abc123', sceneType: 'v1', name: 'Test Scene' }],
    dwellMs: 3000,
    mode: 'sequential'
  };
  const started = await invokeRoute('post', '/rooms/:groupId/loops/start', {
    params: { groupId: '1' },
    body: payload
  });
  assert.equal(started.body.success, true);
  assert.equal(started.body.loop.isRunning, true);

  const status = await invokeRoute('get', '/rooms/:groupId/loops/status', {
    params: { groupId: '1' }
  });
  assert.equal(status.body.success, true);
  assert.equal(status.body.loop.isConfigured, true);

  const stopped = await invokeRoute('post', '/rooms/:groupId/loops/stop', {
    params: { groupId: '1' }
  });
  assert.equal(stopped.body.success, true);
  assert.equal(stopped.body.loop.isRunning, false);
});

test('devices route serves stale last-good snapshot after critical HTML/non-JSON failures', async () => {
  hueClient.v2GetRooms = async () => ({
    data: [{ id: 'room-v2-1', id_v1: '/groups/1', children: [{ rtype: 'device', rid: 'device-1' }], services: [] }]
  });
  hueClient.v2GetZones = async () => ({ data: [] });
  hueClient.getGroups = async () => ({ 1: { type: 'Room', name: 'Room 1', lights: [], sensors: [] } });
  hueClient.v2GetLights = async () => ({ data: [] });
  hueClient.v2GetTemperature = async () => ({
    data: [{ id: 'temp-1', id_v1: '/sensors/10', owner: { rid: 'temp-svc' }, temperature: { temperature: 21.4, temperature_valid: true } }]
  });
  hueClient.v2GetMotion = async () => ({
    data: [{ id: 'motion-1', id_v1: '/sensors/11', owner: { rid: 'motion-svc' }, motion: { motion: false, motion_valid: true }, motion_report: { changed: '2026-03-01T00:00:00Z' } }]
  });
  hueClient.v2GetLightLevel = async () => ({ data: [] });
  hueClient.v2GetButtons = async () => ({ data: [] });
  hueClient.v2GetDevicePower = async () => ({
    data: [{ id: 'power-1', owner: { rid: 'power-svc' }, power_state: { battery_level: 78, battery_state: 'normal' } }]
  });
  hueClient.v2GetZigbeeConnectivity = async () => ({
    data: [{ id: 'conn-1', owner: { rid: 'conn-svc' }, status: 'connected' }]
  });
  hueClient.v2GetDevices = async () => ({
    data: [{
      id: 'device-1',
      id_v1: '/sensors/10',
      metadata: { name: 'Hall Sensor' },
      product_data: { product_name: 'Hue motion sensor', product_archetype: 'hue_motion_sensor' },
      services: [{ rid: 'temp-svc' }, { rid: 'motion-svc' }, { rid: 'power-svc' }, { rid: 'conn-svc' }]
    }]
  });
  hueClient.getSensors = async () => ({});

  await accessorySnapshotService.refreshAll();
  const initial = await invokeRoute('get', '/rooms/:groupId/devices', {
    params: { groupId: '1' }
  });
  assert.equal(initial.body.success, true);
  assert.equal(initial.body.stale, false);
  assert.ok(initial.body.devices.length > 0);

  const htmlError = new Error('Hue bridge returned HTML instead of JSON. Check bridge IP, API token, and bridge availability.');
  hueClient.v2GetLights = async () => { throw htmlError; };
  hueClient.v2GetDevices = async () => { throw htmlError; };

  await accessorySnapshotService.refreshAll();
  const afterFailure = await invokeRoute('get', '/rooms/:groupId/devices', {
    params: { groupId: '1' }
  });
  assert.equal(afterFailure.body.success, true);
  assert.equal(afterFailure.body.stale, true);
  assert.ok(afterFailure.body.devices.length > 0);
  assert.match(String(afterFailure.body.lastError || ''), /Partial snapshot data/i);
});
