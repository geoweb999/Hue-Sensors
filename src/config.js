import dotenv from 'dotenv';

dotenv.config();

export const config = {
  HUE_BRIDGE_IP: process.env.HUE_BRIDGE_IP,
  HUE_API_TOKEN: process.env.HUE_API_TOKEN,
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL) || 60000,
  PORT: parseInt(process.env.SERVER_PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DB_PATH: process.env.DB_PATH || './data/hue-sensors.db',
  LOG_LEVEL: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  LOG_PRETTY: process.env.LOG_PRETTY === 'true',
  SERVICE_NAME: process.env.SERVICE_NAME || 'hue-temperature-tracker',
  EVENT_STREAM_ENABLED: process.env.EVENT_STREAM_ENABLED !== 'false'
};

// Validate required configuration
if (!config.HUE_BRIDGE_IP || !config.HUE_API_TOKEN) {
  console.error('ERROR: Missing required environment variables');
  console.error('Please set HUE_BRIDGE_IP and HUE_API_TOKEN in your .env file');
  process.exit(1);
}

if (config.HUE_API_TOKEN === 'YOUR_API_TOKEN_HERE') {
  console.error('ERROR: Please update HUE_API_TOKEN in your .env file');
  console.error('You need to create a Hue API user on your bridge first');
  process.exit(1);
}
