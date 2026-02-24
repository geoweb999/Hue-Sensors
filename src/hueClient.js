import https from 'https';
import { config } from './config.js';

class HueClient {
  constructor() {
    this.bridgeIp = config.HUE_BRIDGE_IP;
    this.apiToken = config.HUE_API_TOKEN;
  }

  _request(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.bridgeIp,
        port: 443,
        path,
        method,
        rejectUnauthorized: false // Hue Bridge uses self-signed cert
      };

      if (body) {
        options.headers = { 'Content-Type': 'application/json' };
      }

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (error) {
            reject(new Error(`Failed to parse Hue API response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Failed to connect to Hue Bridge: ${error.message}`));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  // Hue CLIP API v2 — uses hue-application-key header, /clip/v2/resource/ base path
  _v2Request(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
      const headers = { 'hue-application-key': this.apiToken };
      if (body) headers['Content-Type'] = 'application/json';

      const options = {
        hostname: this.bridgeIp,
        port: 443,
        path: `/clip/v2/resource${path}`,
        method,
        rejectUnauthorized: false,
        headers
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse Hue v2 API response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Failed to connect to Hue Bridge (v2): ${error.message}`));
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async getSensors() {
    return this._request(`/api/${this.apiToken}/sensors`);
  }

  async getLights() {
    return this._request(`/api/${this.apiToken}/lights`);
  }

  async getGroups() {
    return this._request(`/api/${this.apiToken}/groups`);
  }

  async setLightState(lightId, stateObj) {
    return this._request(
      `/api/${this.apiToken}/lights/${lightId}/state`,
      'PUT',
      stateObj
    );
  }

  async setGroupState(groupId, stateObj) {
    return this._request(
      `/api/${this.apiToken}/groups/${groupId}/action`,
      'PUT',
      stateObj
    );
  }

  async getScenes() {
    return this._request(`/api/${this.apiToken}/scenes`);
  }

  async getSchedules() {
    return this._request(`/api/${this.apiToken}/schedules`);
  }

  async getRules() {
    return this._request(`/api/${this.apiToken}/rules`);
  }

  async createScene(name, groupId, lightIds) {
    const result = await this._request(
      `/api/${this.apiToken}/scenes`,
      'POST',
      { name, lights: lightIds, type: 'GroupScene', group: groupId, recycle: false }
    );
    const idEntry = (Array.isArray(result) ? result : []).find(r => r.success?.id);
    if (!idEntry) throw new Error('Failed to create scene');
    const sceneId = idEntry.success.id;
    await this._request(
      `/api/${this.apiToken}/scenes/${sceneId}`,
      'PUT',
      { storelightstate: true }
    );
    return sceneId;
  }

  async activateScene(groupId, sceneId) {
    return this._request(
      `/api/${this.apiToken}/groups/${groupId}/action`,
      'PUT',
      { scene: sceneId }
    );
  }

  async deleteScene(sceneId) {
    return this._request(
      `/api/${this.apiToken}/scenes/${sceneId}`,
      'DELETE'
    );
  }

  // ── Hue CLIP API v2 methods ────────────────────────────────────────────────

  // Get all v2 rooms (includes id_v1 and services[] with grouped_light rid)
  async v2GetRooms() {
    return this._v2Request('/room');
  }

  // Get all v2 lights (includes id_v1 linking to v1 light ID)
  async v2GetLights() {
    return this._v2Request('/light');
  }

  // Apply a named effect to a single light (candle, fire, sparkle, colorloop, no_effect, etc.)
  async v2SetLightEffect(v2LightId, effect) {
    return this._v2Request(`/light/${v2LightId}`, 'PUT', {
      effects: { effect }
    });
  }

  // Apply a named effect to all lights in a room via its grouped_light resource
  async v2SetRoomEffect(groupedLightId, effect) {
    return this._v2Request(`/grouped_light/${groupedLightId}`, 'PUT', {
      effects: { effect }
    });
  }

  // Create a dynamic palette scene on the bridge
  // palette = [{color:{xy:{x,y}}, dimming:{brightness}}]  (brightness 0-100)
  async v2CreateDynamicScene(name, roomV2Id, palette) {
    return this._v2Request('/scene', 'POST', {
      metadata: { name },
      group: { rid: roomV2Id, rtype: 'room' },
      palette: { color: palette, dimming: [], color_temperature: [] }
    });
  }

  // Recall a v2 scene — action: "dynamic_palette" (animated) | "active" (static)
  async v2RecallScene(sceneId, action, speed = 0.5) {
    const body = { recall: { action } };
    if (action === 'dynamic_palette') body.recall.speed = speed;
    return this._v2Request(`/scene/${sceneId}`, 'PUT', body);
  }

  // Delete a v2 scene
  async v2DeleteScene(sceneId) {
    return this._v2Request(`/scene/${sceneId}`, 'DELETE');
  }

  async getRoomData() {
    try {
      const sensors = await this.getSensors();
      const roomData = [];

      // First, collect motion sensors with their names and motion data
      const motionSensors = {};
      for (const [sensorId, sensor] of Object.entries(sensors)) {
        if (sensor.type && sensor.type.toLowerCase().includes('presence')) {
          // Extract device ID from uniqueid (the MAC address part)
          // Format: "00:17:88:01:02:03:04:05-02-0406"
          const deviceId = sensor.uniqueid ? sensor.uniqueid.split('-')[0] : null;
          if (deviceId) {
            // Hue API returns UTC timestamps without Z suffix, add it for proper parsing
            let lastUpdated = sensor.state?.lastupdated || null;
            if (lastUpdated && !lastUpdated.endsWith('Z')) {
              lastUpdated = lastUpdated + 'Z';
            }

            motionSensors[deviceId] = {
              name: sensor.name || `Sensor ${sensorId}`,
              presence: sensor.state?.presence || false,
              lastUpdated: lastUpdated
            };
          }
        }
      }

      // Collect light sensors (lux values)
      const lightSensors = {};
      for (const [sensorId, sensor] of Object.entries(sensors)) {
        if (sensor.type && sensor.type.toLowerCase().includes('lightlevel')) {
          const deviceId = sensor.uniqueid ? sensor.uniqueid.split('-')[0] : null;
          if (deviceId && sensor.state?.lightlevel !== undefined) {
            // Convert lightlevel to lux: lux = 10^((lightlevel - 1) / 10000)
            const lightlevel = sensor.state.lightlevel;
            const lux = Math.round(Math.pow(10, (lightlevel - 1) / 10000));
            lightSensors[deviceId] = {
              lux: lux,
              dark: sensor.state.dark,
              daylight: sensor.state.daylight
            };
          }
        }
      }

      // Parse sensor data for temperature sensors
      for (const [sensorId, sensor] of Object.entries(sensors)) {
        // Look for temperature sensors (ZLLTemperature or CLIPTemperature)
        if (sensor.type && sensor.type.toLowerCase().includes('temperature')) {
          if (sensor.state && sensor.state.temperature !== undefined) {
            // Hue returns temperature in centi-degrees (e.g., 2156 = 21.56°C)
            const temperature = sensor.state.temperature / 100.0;

            // Try to find matching motion sensor name and data
            let roomName = sensor.name || `Sensor ${sensorId}`;
            let motionDetected = false;
            let lastMotion = null;
            let lux = null;

            if (sensor.uniqueid) {
              const deviceId = sensor.uniqueid.split('-')[0];

              if (motionSensors[deviceId]) {
                roomName = motionSensors[deviceId].name;
                motionDetected = motionSensors[deviceId].presence;
                lastMotion = motionSensors[deviceId].lastUpdated;
              }

              if (lightSensors[deviceId]) {
                lux = lightSensors[deviceId].lux;
              }
            }

            // Hue API returns UTC timestamps without Z suffix, add it for proper parsing
            let lastUpdate = sensor.state.lastupdated;
            if (lastUpdate && !lastUpdate.endsWith('Z')) {
              lastUpdate = lastUpdate + 'Z';
            }

            roomData.push({
              id: sensorId,
              name: roomName,
              temperature: temperature,
              lux: lux,
              motionDetected: motionDetected,
              lastMotion: lastMotion,
              lastUpdate: lastUpdate
            });
          }
        }
      }

      return roomData;
    } catch (error) {
      throw new Error(`Failed to get room data: ${error.message}`);
    }
  }
}

export const hueClient = new HueClient();
