import https from 'https';
import { config } from './config.js';

class HueClient {
  constructor() {
    this.bridgeIp = config.HUE_BRIDGE_IP;
    this.apiToken = config.HUE_API_TOKEN;
  }

  _request(path) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.bridgeIp,
        port: 443,
        path,
        method: 'GET',
        rejectUnauthorized: false // Hue Bridge uses self-signed cert
      };

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
