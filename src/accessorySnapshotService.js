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

function compareIds(a, b) {
  const aNum = Number(a);
  const bNum = Number(b);
  const aIsNum = Number.isFinite(aNum);
  const bIsNum = Number.isFinite(bNum);
  if (aIsNum && bIsNum && aNum !== bNum) return aNum - bNum;
  return String(a).localeCompare(String(b));
}

function resolveResourceDeviceRid(serviceRidToDeviceRid, resource) {
  const ownerRid = resource?.owner?.rid;
  if (!ownerRid) return null;
  return serviceRidToDeviceRid.get(ownerRid) || ownerRid;
}

function addDeviceAreaMembership(deviceToAreaMap, deviceRid, areaId) {
  if (!deviceRid || !areaId) return;
  if (!deviceToAreaMap.has(deviceRid)) deviceToAreaMap.set(deviceRid, new Set());
  deviceToAreaMap.get(deviceRid).add(areaId);
}

function isDeviceInArea(deviceToAreaMap, deviceRid, areaId) {
  if (!deviceRid || !areaId) return false;
  return deviceToAreaMap.get(deviceRid)?.has(areaId) || false;
}

function hasCriticalSnapshotFailures(failedKeys) {
  const failed = new Set(failedKeys || []);
  if (failed.has('devices')) return true;
  if (failed.has('lights')) return true;
  if (failed.has('rooms') && failed.has('zones')) return true;
  if (failed.has('groups') && failed.has('sensors')) return true;
  return false;
}

function extractHueErrorDescriptions(response) {
  const errors = Array.isArray(response?.errors) ? response.errors : [];
  return errors
    .map((entry) => entry?.description || entry?.error?.description || null)
    .filter(Boolean);
}

function validateExpectedResponseShape(key, response, expectedShape) {
  if (expectedShape === 'list') {
    if (Array.isArray(response?.data)) return null;
    const hueErrors = extractHueErrorDescriptions(response);
    if (hueErrors.length > 0) return `${key}: ${hueErrors.join('; ')}`;
    return `${key}: invalid response shape (expected data array)`;
  }

  if (expectedShape === 'object') {
    if (response && typeof response === 'object' && !Array.isArray(response)) return null;
    if (Array.isArray(response)) {
      const hueErrors = response
        .map((entry) => entry?.error?.description || null)
        .filter(Boolean);
      if (hueErrors.length > 0) return `${key}: ${hueErrors.join('; ')}`;
    }
    return `${key}: invalid response shape (expected object map)`;
  }

  return null;
}

function deviceSignalScore(device) {
  if (!device || typeof device !== 'object') return 0;
  let score = 0;
  if (device.temperature?.valid) score += 1;
  if (device.motion?.valid) score += 1;
  if (device.lightLevel?.valid) score += 1;
  if (Array.isArray(device.buttons) && device.buttons.length > 0) score += 1;
  if (device.battery && (device.battery.level != null || device.battery.state != null)) score += 1;
  if (device.connectivity && device.connectivity.status != null) score += 1;
  return score;
}

function snapshotSignalScore(devices) {
  return (devices || []).reduce((sum, device) => sum + deviceSignalScore(device), 0);
}

async function fetchResources() {
  const requests = [
    { key: 'rooms', shape: 'list', fn: () => hueClient.v2GetRooms() },
    { key: 'zones', shape: 'list', fn: () => hueClient.v2GetZones() },
    { key: 'groups', shape: 'object', fn: () => hueClient.getGroups() },
    { key: 'lights', shape: 'list', fn: () => hueClient.v2GetLights() },
    { key: 'temperatures', shape: 'list', fn: () => hueClient.v2GetTemperature() },
    { key: 'motions', shape: 'list', fn: () => hueClient.v2GetMotion() },
    { key: 'lightLevels', shape: 'list', fn: () => hueClient.v2GetLightLevel() },
    { key: 'devices', shape: 'list', fn: () => hueClient.v2GetDevices() },
    { key: 'powers', shape: 'list', fn: () => hueClient.v2GetDevicePower() },
    { key: 'connectivities', shape: 'list', fn: () => hueClient.v2GetZigbeeConnectivity() },
    { key: 'buttons', shape: 'list', fn: () => hueClient.v2GetButtons() },
    { key: 'sensors', shape: 'object', fn: () => hueClient.getSensors() }
  ];
  const settled = await Promise.allSettled(requests.map((request) => request.fn()));

  const asList = (resp) => (resp && Array.isArray(resp.data) ? resp.data : []);
  const asObj = (resp) => (resp && typeof resp === 'object' && !Array.isArray(resp) ? resp : {});
  const fetchErrors = [];
  const failedKeys = [];
  const byKey = {};
  settled.forEach((result, index) => {
    const { key, shape } = requests[index];
    if (result.status === 'fulfilled') {
      const shapeError = validateExpectedResponseShape(key, result.value, shape);
      if (shapeError) {
        byKey[key] = null;
        failedKeys.push(key);
        fetchErrors.push(shapeError);
        return;
      }
      byKey[key] = result.value;
      return;
    }
    byKey[key] = null;
    failedKeys.push(key);
    fetchErrors.push(`${key}: ${normalizeSnapshotErrorMessage(result.reason)}`);
  });

  return {
    rooms: asList(byKey.rooms),
    zones: asList(byKey.zones),
    groups: asObj(byKey.groups),
    lights: asList(byKey.lights),
    temperatures: asList(byKey.temperatures),
    motions: asList(byKey.motions),
    lightLevels: asList(byKey.lightLevels),
    devices: asList(byKey.devices),
    powers: asList(byKey.powers),
    connectivities: asList(byKey.connectivities),
    buttons: asList(byKey.buttons),
    sensors: asObj(byKey.sensors),
    fetchErrors,
    failedKeys
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

  const deviceToAreaV2Ids = new Map();
  for (const area of [...rooms, ...zones]) {
    for (const child of (area.children || [])) {
      if (child.rtype === 'device') addDeviceAreaMembership(deviceToAreaV2Ids, child.rid, area.id);
    }
  }

  const groupLightV1Ids = new Set((group.lights || []).map((id) => `/lights/${id}`));
  const lightDeviceRids = new Set();
  for (const light of lights) {
    if (!light.owner?.rid) continue;
    if (groupLightV1Ids.has(light.id_v1)) {
      lightDeviceRids.add(light.owner.rid);
      continue;
    }
    // v1 groups can be unavailable; fall back to room/zone area mapping.
    if (roomV2Id && isDeviceInArea(deviceToAreaV2Ids, light.owner.rid, roomV2Id)) {
      lightDeviceRids.add(light.owner.rid);
    }
  }

  for (const rid of roomDeviceRids) {
    if (!lightDeviceRids.has(rid)) sensorDeviceRids.add(rid);
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
      if (ownerRid && isDeviceInArea(deviceToAreaV2Ids, ownerRid, roomV2Id) && !lightDeviceRids.has(ownerRid)) {
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

  const sortedSensorEntries = Object.entries(sensors || {}).sort((a, b) => compareIds(a[0], b[0]));
  const groupSensorIds = [...new Set((group.sensors || []).map((id) => String(id)))].sort(compareIds);
  const uniqueBaseForGroup = new Set();
  for (const sid of groupSensorIds) {
    const base = String(sensors[sid]?.uniqueid || '').split('-')[0];
    if (base) uniqueBaseForGroup.add(base);
  }
  const expandedRoomSensorIds = new Set(groupSensorIds);
  for (const [sid, sensor] of sortedSensorEntries) {
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
      const matchedPresenceCandidates = [];
      for (const [sid, sensor] of sortedSensorEntries) {
        const type = String(sensor?.type || '').toLowerCase();
        const sensorNameNorm = normalizeName(sensor?.name);
        if (!type.includes('presence') || !sensorNameNorm) continue;
        if (!sensorNameNorm.includes(roomNameNorm) && !roomNameNorm.includes(sensorNameNorm)) continue;
        matchedPresenceCandidates.push({
          sid: String(sid),
          base: String(sensor?.uniqueid || '').split('-')[0] || null
        });
      }

      // Avoid ambiguous cross-room matches when multiple presence sensors
      // loosely match the room name.
      if (matchedPresenceCandidates.length === 1) {
        const candidate = matchedPresenceCandidates[0];
        expandedRoomSensorIds.add(candidate.sid);
        if (candidate.base) {
          for (const [otherSid, otherSensor] of sortedSensorEntries) {
            const otherBase = String(otherSensor?.uniqueid || '').split('-')[0] || null;
            if (otherBase && otherBase === candidate.base) expandedRoomSensorIds.add(String(otherSid));
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

  const expandedRoomSensorIdsOrdered = [...expandedRoomSensorIds].sort(compareIds);
  const v1UniqueBaseRidCandidates = new Map();
  for (const sid of expandedRoomSensorIdsOrdered) {
    const s = sensors[sid];
    const rid = v1SensorIdToDeviceRid.get(sid);
    const base = String(s?.uniqueid || '').split('-')[0] || null;
    if (!rid || !base) continue;
    if (!v1UniqueBaseRidCandidates.has(base)) v1UniqueBaseRidCandidates.set(base, new Set());
    v1UniqueBaseRidCandidates.get(base).add(rid);
  }
  const v1UniqueBaseToDeviceRid = new Map();
  for (const [base, ridSet] of v1UniqueBaseRidCandidates.entries()) {
    const stableRid = [...ridSet].sort((a, b) => String(a).localeCompare(String(b)))[0];
    if (stableRid) v1UniqueBaseToDeviceRid.set(base, stableRid);
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

  for (const sid of expandedRoomSensorIdsOrdered) {
    const sensor = sensors[sid];
    if (!sensor) continue;
    const base = String(sensor.uniqueid || '').split('-')[0] || null;
    const rid = v1SensorIdToDeviceRid.get(sid) || (base ? v1UniqueBaseToDeviceRid.get(base) : null) || (base ? `v1base:${base}` : `v1sensor:${sid}`);
    ensureDevice(rid, sensor.name || `Sensor ${sid}`);

    if (sensor?.config?.battery != null && !deviceMap[rid].battery) {
      deviceMap[rid].battery = { level: sensor.config.battery, state: null };
    }
    if (sensor?.config?.reachable != null && !deviceMap[rid].connectivity) {
      deviceMap[rid].connectivity = { status: sensor.config.reachable ? 'connected' : 'disconnected' };
    }

    const type = String(sensor.type || '').toLowerCase();
    if (type.includes('presence') && !deviceMap[rid].motion?.valid) {
      deviceMap[rid].motion = {
        detected: !!sensor.state?.presence,
        valid: true,
        lastChanged: normalizeV1Ts(sensor.state?.lastupdated)
      };
    }
    if (type.includes('temperature') && sensor.state?.temperature != null && !deviceMap[rid].temperature?.valid) {
      deviceMap[rid].temperature = {
        celsius: Number(sensor.state.temperature) / 100,
        valid: true
      };
    }
    if (type.includes('lightlevel') && sensor.state?.lightlevel != null && !deviceMap[rid].lightLevel?.valid) {
      const raw = Number(sensor.state.lightlevel);
      const lux = Number.isFinite(raw) ? Math.round(Math.pow(10, (raw - 1) / 10000)) : null;
      deviceMap[rid].lightLevel = { lux, valid: lux != null };
    }
    if (sensor.state?.buttonevent != null) {
      deviceMap[rid].deviceKind = 'dimmer';
      if ((deviceMap[rid].buttons || []).length === 0) {
        const mapped = v1ButtonEventToV2(sensor.state.buttonevent);
        const row = { controlId: mapped.controlId, lastEvent: mapped.event, lastUpdated: normalizeV1Ts(sensor.state?.lastupdated) };
        const existing = deviceMap[rid].buttons.findIndex((b) => b.controlId === row.controlId);
        if (existing >= 0) deviceMap[rid].buttons[existing] = row;
        else deviceMap[rid].buttons.push(row);
      }
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
    this.refreshInFlight = null;
    this.signalDropGraceMs = 120000;
    this.lastError = null;
    this.lastUpdated = null;
  }

  async _refreshAllInternal() {
    const startedAt = Date.now();
    try {
      const resources = await fetchResources();
      const refreshedAt = Date.now();
      const groupIdsFromV1 = Object.keys(resources.groups || {}).filter((gid) => {
        const g = resources.groups[gid] || {};
        return g.type === 'Room' || (Array.isArray(g.sensors) && g.sensors.length > 0);
      });
      const groupIdsFromV2 = [...resources.rooms, ...resources.zones]
        .map((entry) => String(entry?.id_v1 || ''))
        .filter((idv1) => idv1.startsWith('/groups/'))
        .map((idv1) => idv1.replace('/groups/', '').split('/')[0])
        .filter(Boolean);
      const groupIds = Array.from(new Set([...groupIdsFromV1, ...groupIdsFromV2]));

      const partialError = (resources.fetchErrors || []).length > 0
        ? `Partial snapshot data: ${(resources.fetchErrors || []).join(' | ')}`
        : null;
      const criticalFailure = hasCriticalSnapshotFailures(resources.failedKeys);

      if (criticalFailure && this.snapshots.size > 0) {
        this.lastError = partialError || 'Accessory snapshot refresh skipped due to critical partial failure.';
        for (const [groupId, snapshot] of this.snapshots.entries()) {
          this.snapshots.set(groupId, {
            ...snapshot,
            stale: true,
            lastError: this.lastError
          });
        }
        logger.warn('ACCESSORY_SNAPSHOT_REFRESH_PARTIAL_RETAINED', 'Accessory snapshots retained due to critical partial failure', {
          durationMs: Date.now() - startedAt,
          roomCount: this.snapshots.size,
          failedKeys: resources.failedKeys || []
        });
        return;
      }

      const nextSnapshots = new Map();
      for (const groupId of groupIds) {
        const devices = buildDevicesForGroup(groupId, resources);
        nextSnapshots.set(groupId, {
          devices,
          stale: !!criticalFailure,
          lastUpdated: refreshedAt,
          lastError: partialError
        });
      }

      if (this.snapshots.size > 0) {
        for (const [groupId, previousSnapshot] of this.snapshots.entries()) {
          if (!nextSnapshots.has(groupId)) {
            if (partialError) {
              nextSnapshots.set(groupId, {
                ...previousSnapshot,
                stale: true,
                lastError: partialError
              });
            }
            continue;
          }
          const nextSnapshot = nextSnapshots.get(groupId);
          const nextDevices = Array.isArray(nextSnapshot?.devices) ? nextSnapshot.devices : [];
          const prevDevices = Array.isArray(previousSnapshot?.devices) ? previousSnapshot.devices : [];

          const prevSignal = snapshotSignalScore(prevDevices);
          const nextSignal = snapshotSignalScore(nextDevices);
          const prevIsRecent = Number.isFinite(previousSnapshot?.lastUpdated)
            && (refreshedAt - Number(previousSnapshot.lastUpdated)) <= this.signalDropGraceMs;
          const suspiciousSignalDrop = prevSignal > 0 && nextSignal === 0 && prevIsRecent;
          if (suspiciousSignalDrop) {
            nextSnapshots.set(groupId, {
              ...previousSnapshot,
              stale: true,
              lastError: partialError || 'Accessory snapshot degraded unexpectedly; retained last known good data.'
            });
            continue;
          }

          if (nextDevices.length === 0 && prevDevices.length > 0) {
            nextSnapshots.set(groupId, {
              ...previousSnapshot,
              stale: true,
              lastError: partialError || 'Accessory snapshot temporarily empty; retained last known good data.'
            });
          }
        }
      }

      this.snapshots = nextSnapshots;
      this.lastError = partialError;
      this.lastUpdated = refreshedAt;
      logger.info('ACCESSORY_SNAPSHOT_REFRESH_SUCCESS', 'Accessory snapshots refreshed', {
        durationMs: Date.now() - startedAt,
        roomCount: nextSnapshots.size,
        partialFailures: (resources.fetchErrors || []).length
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

  async refreshAll() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this._refreshAllInternal();
    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
    return null;
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
    this.refreshInFlight = null;
  }

  getRoomSnapshot(groupId) {
    const snapshot = this.snapshots.get(String(groupId));
    if (snapshot) return snapshot;
    return {
      devices: [],
      stale: !this.lastUpdated,
      lastUpdated: this.lastUpdated,
      lastError: this.lastError
    };
  }
}

export const accessorySnapshotService = new AccessorySnapshotService();
