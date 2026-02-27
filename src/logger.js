import { config } from './config.js';

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const REDACT_KEYS = [
  'token',
  'api_token',
  'authorization',
  'hue-application-key',
  'password',
  'secret'
];

function levelValue(level) {
  return LEVELS[level] ?? LEVELS.info;
}

function shouldRedactKey(key) {
  const lowered = String(key).toLowerCase();
  return REDACT_KEYS.some((needle) => lowered.includes(needle));
}

function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return '[Truncated]';

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: config.NODE_ENV === 'production' ? undefined : value.stack
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, depth + 1));
  }

  if (typeof value === 'object') {
    const output = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = shouldRedactKey(key) ? '[REDACTED]' : sanitize(nestedValue, depth + 1);
    }
    return output;
  }

  return value;
}

class Logger {
  constructor() {
    this.minLevel = levelValue(config.LOG_LEVEL);
    this.pretty = config.LOG_PRETTY;
  }

  log(level, event, message, fields = {}) {
    if (levelValue(level) < this.minLevel) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      msg: message,
      service: config.SERVICE_NAME,
      env: config.NODE_ENV,
      ...sanitize(fields)
    };

    const line = this.pretty ? JSON.stringify(entry, null, 2) : JSON.stringify(entry);
    if (level === 'error') {
      console.error(line);
      return;
    }
    if (level === 'warn') {
      console.warn(line);
      return;
    }
    console.log(line);
  }

  debug(event, message, fields = {}) {
    this.log('debug', event, message, fields);
  }

  info(event, message, fields = {}) {
    this.log('info', event, message, fields);
  }

  warn(event, message, fields = {}) {
    this.log('warn', event, message, fields);
  }

  error(event, message, fields = {}) {
    this.log('error', event, message, fields);
  }
}

export const logger = new Logger();
