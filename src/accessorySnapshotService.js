import { hueClient } from './hueClient.js';
import { logger } from './logger.js';

function normalizeSnapshotErrorMessage(error) {
  const raw = String(error?.message || error || '').trim();
  if (!raw) return 'Accessory snapshot refresh failed.';
  if (raw.includes('Unexpected token') && raw.includes('<')) {
    return 'Hue bridge returned HTML instead of JSON during accessory refresh.';
  }
  return raw;
}

function sortDevices(devices) {
  return (devices || []).sort((a, b) => {
    const nameA = String(a.name || a.productName || '').toLowerCase();
    const nameB = String(b.name || b.productName || '').toLowerCase();
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return String(a.rid || '').localeCompare(String(b.rid || ''));
  });
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function resolveResourceDeviceRid(serviceRidToDeviceRid, resource) {
  const ownerRid = resource?.owner?.rid;
  if (!ownerRid) return null;
  return serviceRidToDeviceRid.get(ownerRid) || ownerRid;
}

async function fetchResources() {
  const [roomsResp, zonesResp, groupsData, lightsResp, tempResp, motionResp, lightLevelResp, deviceResp, powerResp, connectivityResp, buttonResp, sensorsData] = await Promise.all([
    hueClient.v2GetRooms(),
    hueClient.v2GetZones(),
    hueClient.getGroups(),
    hueClient.v2GetLights(),
    hueClient.v2GetTemperature(),
    hueClient.v2GetMotion(),
    hueClient.v2GetLightLevel(),
    hueClient.v2GetDevices(),
    hueClient.v2GetDevicePower(),
    hueClient.v2GetZigbeeConnectivity(),
    hueClient.v2GetButtons(),
    hueClient.getSensors()
  ]);

  const asList = (resp) => (resp && Array.isArray(resp.data) ? resp.data : []);
  const asObj = (resp) => (resp && typeof resp === 'object' && !Array.isArray(resp) ? resp : {});

  return {
    rooms: asList(roomsResp),
    zones: asList(zonesResp),
    groups: asObj(groupsData),
    lights: asList(lightsResp),
    temperatures: asList(tempResp),
    motions: asList(motionResp),
    lightLevels: asList(lightLevelResp),
    devices: asList(deviceResp),
    powers: asList(powerResp),
    connectivities: asList(connectivityResp),
    buttons: asList(buttonResp),
    sensors: asObj(sensorsData)
  };
}

function buildDevicesForGroup(groupId, resources) {
  const { rooms, zones, groups, lights, temperatures, motions, lightLevels, devices, powers, connectivities, buttons, sensors } = resources;
  const group = groups[groupId] || {};

  const sensorDeviceRids = new Set();
  const serviceRidToDeviceRid = new Map();
  for (const d of devices) {
    for (const svc of (d.services || [])) {
      if (svc?.rid) serviceRidToDeviceRid.set(svc.rid, d.id);
    }
  }

  const room = rooms.find((entry) => entry.id_v1 === `/groups/${groupId}`) || null;
  const zone = zones.find((entry) => entry.id_v1 === `/groups/${groupId}`) || null;
  const targetArea = room || zone || null;
  const roomV2Id = targetArea?.id || null;
  const roomDeviceRids = new Set(
    (targetArea?.children || [])
      .filter((child) => child.rtype === 'device')
      .map((child) => child.rid)
  );

  const groupLightV1Ids = new Set((group.lights || []).map((id) => `/lights/${id}`));
  const lightDeviceRids = new Set();
  for (const light of lights) {
    if (light.owner?.rid && groupLightV1Ids.has(light.id_v1)) lightDeviceRids.add(light.owner.rid);
  }

  for (const rid of roomDeviceRids) {
    if (!lightDeviceRids.has(rid)) sensorDeviceRids.add(rid);
  }

  const deviceToAreaV2Id = new Map();
  for (const area of [...rooms, ...zones]) {
    for (const child of (area.children || [])) {
      if (child.rtype === 'device') deviceToAreaV2Id.set(child.rid, area.id);
    }
  }

  const allServiceResources = [
    ...temperatures,
    ...motions,
    ...lightLevels,
    ...buttons,
    ...powers,
    ...connectivities
  ];
  const sensorServiceIdToDeviceRid = new Map();
  for (const svc of allServiceResources) {
    const rid = resolveResourceDeviceRid(serviceRidToDeviceRid, svc);
    const idv1 = String(svc?.id_v1 || '');
    if (rid && idv1.startsWith('/sensors/')) {
      const sensorId = idv1.split('/')[2];
      if (sensorId) sensorServiceIdToDeviceRid.set(sensorId, rid);
    }
  }

  if (roomV2Id) {
    for (const svc of allServiceResources) {
      const ownerRid = resolveResourceDeviceRid(serviceRidToDeviceRid, svc);
      if (ownerRid && deviceToAreaV2Id.get(ownerRid) === roomV2Id && !lightDeviceRids.has(ownerRid)) {
        sensorDeviceRids.add(ownerRid);
      }
    }
  }

  const v1SensorIds = new Set((group.sensors || []).map((id) => `/sensors/${id}`));
  const v1SensorIdPrefixes = [...v1SensorIds].map((base) => `${base}/`);
  for (const svc of allServiceResources) {
    const ownerRid = resolveResourceDeviceRid(serviceRidToDeviceRid, svc);
    const svcIdV1 = String(svc.id_v1 || '');
    const isGroupSensor = v1SensorIds.has(svcIdV1) || v1SensorIdPrefixes.some((prefix) => svcIdV1.startsWith(prefix));
    if (ownerRid && svcIdV1 && isGroupSensor && !lightDeviceRids.has(ownerRid)) {
      sensorDeviceRids.add(ownerRid);
    }
  }

  const deviceById = {};
  for (const d of devices) {
    if (sensorDeviceRids.has(d.id)) {
      const productName = String(d.product_data?.product_name || '').toLowerCase();
      const archetype = String(d.product_data?.product_archetype || '').toLowerCase();
      const isSwitch = productName.includes('dimmer') || archetype.includes('dimmer') || archetype.includes('switch');
      deviceById[d.id] = {
        name: d.metadata?.name,
        productName: d.product_data?.product_name,
        productArchetype: d.product_data?.product_archetype,
        deviceKind: isSwitch ? 'dimmer' : 'sensor'
      };
    }
  }

  const deviceMap = {};
  for (const rid of sensorDeviceRids) {
    deviceMap[rid] = {
      rid,
      ...(deviceById[rid] || {}),
      deviceKind: deviceById[rid]?.deviceKind || 'sensor',
      temperature: null,
      motion: null,
      lightLevel: null,
      battery: null,
      connectivity: null,
      buttons: []
    };
  }

  for (const t of temperatures) {
    const rid = resolveResourceDeviceRid(serviceRidToDeviceRid, t);
    if (deviceMap[rid]) {
      deviceMap[rid].temperature = {
        celsius: t.temperature?.temperature ?? null,
        valid: t.temperature?.temperature_valid ?? false
      };
    }
  }
  for (const m of motions) {
    const rid = resolveResourceDeviceRid(serviceRidToDeviceRid, m);
    if (deviceMap[rid]) {
      deviceMap[rid].motion = {
        detected: m.motion?.motion ?? false,
        valid: m.motion?.motion_valid ?? false,
        lastChanged: m.motion_report?.changed ?? null
      };
    }
  }
  for (const l of lightLevels) {
    const rid = resolveResourceDeviceRid(serviceRidToDeviceRid, l);
    if (deviceMap[rid]) {
      deviceMap[rid].lightLevel = {
        lux: l.light?.light_level_lux ?? null,
        valid: l.light?.light_level_valid ?? false
      };
    }
  }
  for (const p of powers) {
    const rid = resolveResourceDeviceRid(serviceRidToDeviceRid, p);
    if (deviceMap[rid]) {
      deviceMap[rid].battery = {
        level: p.power_state?.battery_level ?? null,
        state: p.power_state?.battery_state ?? null
      };
    }
  }
  for (const z of connectivities) {
    const rid = resolveResourceDeviceRid(serviceRidToDeviceRid, z);
    if (deviceMap[rid]) {
      deviceMap[rid].connectivity = { status: z.status ?? null };
    }
  }

  const buttonsByDevice = {};
  for (const b of buttons) {
    const rid = resolveResourceDeviceRid(serviceRidToDeviceRid, b);
    if (!deviceMap[rid]) continue;
    if (!buttonsByDevice[rid]) buttonsByDevice[rid] = [];
    const controlIdRaw = b.metadata?.control_id ?? null;
    const numericControlId = Number(controlIdRaw);
    const controlId = Number.isFinite(numericControlId)
      ? numericControlId
      : (typeof controlIdRaw === 'string' && /(\d+)$/.test(controlIdRaw) ? Number(controlIdRaw.match(/(\d+)$/)[1]) : null);
    const reportEvent = b.button?.button_report?.event ?? null;
    const reportUpdated = b.button?.button_report?.updated ?? null;
    buttonsByDevice[rid].push({
      controlId,
      lastEvent: reportEvent || b.button?.last_event || null,
      lastUpdated: reportUpdated || b.button?.last_updated || b.updated || null
    });
  }
  for (const [rid, btns] of Object.entries(buttonsByDevice)) {
    deviceMap[rid].buttons = btns.sort((a, b) => (a.controlId ?? 99) - (b.controlId ?? 99));
    deviceMap[rid].deviceKind = 'dimmer';
  }

  const groupSensorIds = (group.sensors || []).map((id) => String(id));
  const uniqueBaseForGroup = new Set();
  for (const sid of groupSensorIds) {
    const base = String(sensors[sid]?.uniqueid || '').split('-')[0];
    if (base) uniqueBaseForGroup.add(base);
  }
  const expandedRoomSensorIds = new Set(groupSensorIds);
  for (const [sid, sensor] of Object.entries(sensors || {})) {
    const base = String(sensor?.uniqueid || '').split('-')[0];
    if (base && uniqueBaseForGroup.has(base)) expandedRoomSensorIds.add(String(sid));
  }

  // Motion rescue: some bridges omit presence sensor IDs from group.sensors.
  // If this room has no presence sensor after normal expansion, infer by room name
  // and include all sibling sensors sharing the same uniqueid base.
  const hasPresenceInExpanded = [...expandedRoomSensorIds].some((sid) => String(sensors[sid]?.type || '').toLowerCase().includes('presence'));
  if (!hasPresenceInExpanded) {
    const roomNameNorm = normalizeName(group.name);
    if (roomNameNorm) {
      for (const [sid, sensor] of Object.entries(sensors || {})) {
        const type = String(sensor?.type || '').toLowerCase();
        const sensorNameNorm = normalizeName(sensor?.name);
        if (!type.includes('presence') || !sensorNameNorm) continue;
        if (!sensorNameNorm.includes(roomNameNorm) && !roomNameNorm.includes(sensorNameNorm)) continue;

        const base = String(sensor?.uniqueid || '').split('-')[0] || null;
        expandedRoomSensorIds.add(String(sid));
        if (base) {
          for (const [otherSid, otherSensor] of Object.entries(sensors || {})) {
            const otherBase = String(otherSensor?.uniqueid || '').split('-')[0] || null;
            if (otherBase && otherBase === base) expandedRoomSensorIds.add(String(otherSid));
          }
        }
      }
    }
  }

  const v1SensorIdToDeviceRid = new Map(sensorServiceIdToDeviceRid);
  for (const d of devices) {
    const idv1 = String(d.id_v1 || '');
    if (!idv1.startsWith('/sensors/')) continue;
    const sid = idv1.replace('/sensors/', '').split('/')[0];
    if (sid && !v1SensorIdToDeviceRid.has(sid)) v1SensorIdToDeviceRid.set(sid, d.id);
  }

  const v1UniqueBaseToDeviceRid = new Map();
  for (const sid of expandedRoomSensorIds) {
    const s = sensors[sid];
    const rid = v1SensorIdToDeviceRid.get(sid);
    const base = String(s?.uniqueid || '').split('-')[0] || null;
    if (rid && base) v1UniqueBaseToDeviceRid.set(base, rid);
  }

  const ensureDevice = (rid, name) => {
    if (!deviceMap[rid]) {
      deviceMap[rid] = {
        rid,
        name,
        productName: null,
        productArchetype: null,
        deviceKind: 'sensor',
        temperature: null,
        motion: null,
        lightLevel: null,
        battery: null,
        connectivity: null,
        buttons: []
      };
    } else if (!deviceMap[rid].name && name) {
      deviceMap[rid].name = name;
    }
  };
  const normalizeV1Ts = (ts) => (!ts || ts === 'none' ? null : (ts.endsWith('Z') ? ts : `${ts}Z`));
  const v1ButtonEventToV2 = (value) => {
    const code = Number(value);
    if (!Number.isFinite(code) || code <= 0) return { controlId: null, event: null };
    const controlId = Math.floor(code / 1000);
    const eventCode = code % 1000;
    const event = eventCode === 0 ? 'initial_press'
      : eventCode === 1 ? 'repeat'
      : eventCode === 2 ? 'short_release'
      : eventCode === 3 ? 'long_release'
      : null;
    return { controlId, event };
  };

  for (const sid of expandedRoomSensorIds) {
    const sensor = sensors[sid];
    if (!sensor) continue;
    const base = String(sensor.uniqueid || '').split('-')[0] || null;
    const rid = v1SensorIdToDeviceRid.get(sid) || (base ? v1UniqueBaseToDeviceRid.get(base) : null) || `v1:${sid}`;
    ensureDevice(rid, sensor.name || `Sensor ${sid}`);

    if (sensor?.config?.battery != null) deviceMap[rid].battery = { level: sensor.config.battery, state: null };
    if (sensor?.config?.reachable != null) deviceMap[rid].connectivity = { status: sensor.config.reachable ? 'connected' : 'disconnected' };

    const type = String(sensor.type || '').toLowerCase();
    if (type.includes('presence')) {
      deviceMap[rid].motion = {
        detected: !!sensor.state?.presence,
        valid: true,
        lastChanged: normalizeV1Ts(sensor.state?.lastupdated)
      };
    }
    if (type.includes('temperature') && sensor.state?.temperature != null) {
      deviceMap[rid].temperature = {
        celsius: Number(sensor.state.temperature) / 100,
        valid: true
      };
    }
    if (type.includes('lightlevel') && sensor.state?.lightlevel != null) {
      const raw = Number(sensor.state.lightlevel);
      const lux = Number.isFinite(raw) ? Math.round(Math.pow(10, (raw - 1) / 10000)) : null;
      deviceMap[rid].lightLevel = { lux, valid: lux != null };
    }
    if (sensor.state?.buttonevent != null) {
      deviceMap[rid].deviceKind = 'dimmer';
      const mapped = v1ButtonEventToV2(sensor.state.buttonevent);
      const row = { controlId: mapped.controlId, lastEvent: mapped.event, lastUpdated: normalizeV1Ts(sensor.state?.lastupdated) };
      const existing = deviceMap[rid].buttons.findIndex((b) => b.controlId === row.controlId);
      if (existing >= 0) deviceMap[rid].buttons[existing] = row;
      else deviceMap[rid].buttons.push(row);
    }
    if (type.includes('switch')) deviceMap[rid].deviceKind = 'dimmer';
  }

  for (const entry of Object.values(deviceMap)) {
    if (Array.isArray(entry.buttons) && entry.buttons.length > 1) {
      entry.buttons.sort((a, b) => (a.controlId ?? 99) - (b.controlId ?? 99));
    }
  }

  return sortDevices(Object.values(deviceMap));
}

class AccessorySnapshotService {
  constructor() {
    this.snapshots = new Map();
    this.intervalHandle = null;
    this.lastError = null;
    this.lastUpdated = null;
  }

  async refreshAll() {
    const startedAt = Date.now();
    try {
      const resources = await fetchResources();
      const groupIds = Object.keys(resources.groups || {}).filter((gid) => {
        const g = resources.groups[gid] || {};
        return g.type === 'Room' || (Array.isArray(g.sensors) && g.sensors.length > 0);
      });

      const nextSnapshots = new Map();
      for (const groupId of groupIds) {
        const devices = buildDevicesForGroup(groupId, resources);
        nextSnapshots.set(groupId, {
          devices,
          stale: false,
          lastUpdated: Date.now(),
          lastError: null
        });
      }

      this.snapshots = nextSnapshots;
      this.lastError = null;
      this.lastUpdated = Date.now();
      logger.info('ACCESSORY_SNAPSHOT_REFRESH_SUCCESS', 'Accessory snapshots refreshed', {
        durationMs: Date.now() - startedAt,
        roomCount: nextSnapshots.size
      });
    } catch (error) {
      this.lastError = normalizeSnapshotErrorMessage(error);
      for (const [groupId, snapshot] of this.snapshots.entries()) {
        this.snapshots.set(groupId, {
          ...snapshot,
          stale: true,
          lastError: this.lastError
        });
      }
      logger.warn('ACCESSORY_SNAPSHOT_REFRESH_FAILURE', 'Accessory snapshot refresh failed; keeping last good snapshot', {
        durationMs: Date.now() - startedAt,
        error: this.lastError
      });
    }
  }

  start(intervalMs = 10000) {
    if (this.intervalHandle) return;
    this.refreshAll();
    this.intervalHandle = setInterval(() => {
      this.refreshAll();
    }, intervalMs);
  }

  stop() {
    if (!this.intervalHandle) return;
    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  getRoomSnapshot(groupId) {
    const snapshot = this.snapshots.get(String(groupId));
    if (snapshot) return snapshot;
    return {
      devices: [],
      stale: true,
      lastUpdated: this.lastUpdated,
      lastError: this.lastError
    };
  }
}

export const accessorySnapshotService = new AccessorySnapshotService();
