import https from 'https';
import { config } from './config.js';
import { logger } from './logger.js';

const BASE_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

function findFrameDelimiter(buffer) {
  const unixIndex = buffer.indexOf('\n\n');
  const windowsIndex = buffer.indexOf('\r\n\r\n');

  if (unixIndex === -1 && windowsIndex === -1) {
    return { index: -1, length: 0 };
  }

  if (windowsIndex !== -1 && (unixIndex === -1 || windowsIndex < unixIndex)) {
    return { index: windowsIndex, length: 4 };
  }

  return { index: unixIndex, length: 2 };
}

function parseSseDataFrame(frame) {
  const lines = frame.split(/\r?\n/);
  let eventName = null;
  const dataLines = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  return { eventName, data: dataLines.join('\n') };
}

export function startHueEventStream() {
  let stopped = false;
  let retryMs = BASE_RETRY_MS;
  let reconnectTimer = null;
  let currentRequest = null;
  let currentResponse = null;

  const scheduleReconnect = (reason, fields = {}) => {
    if (stopped) return;
    if (reconnectTimer) return;
    const waitMs = retryMs;
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);

    logger.warn('BRIDGE_EVENT_STREAM_RECONNECT', 'Hue event stream reconnect scheduled', {
      reason,
      retryInMs: waitMs,
      ...fields
    });

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, waitMs);
  };

  const handleEventPayload = (payloadText, eventName) => {
    let containers;
    try {
      containers = JSON.parse(payloadText);
    } catch (error) {
      logger.warn('BRIDGE_EVENT_PARSE_ERROR', 'Failed to parse Hue bridge event payload', {
        eventName,
        payloadPreview: payloadText.slice(0, 300),
        error
      });
      return;
    }

    const containerList = Array.isArray(containers) ? containers : [containers];
    for (const container of containerList) {
      const eventType = container?.type || eventName || 'unknown';
      const creationTime = container?.creationtime;
      const eventData = Array.isArray(container?.data) ? container.data : [];

      for (const resource of eventData) {
        const resourceType = resource?.type || 'unknown';
        const resourceId = resource?.id || resource?.id_v1 || 'unknown';

        logger.info('BRIDGE_EVENT', 'Hue bridge event received', {
          eventType,
          resourceType,
          resourceId,
          creationTime
        });

        logger.debug('BRIDGE_EVENT_DETAIL', 'Hue bridge event detail', {
          eventType,
          resourceType,
          resourceId,
          payload: resource
        });
      }
    }
  };

  const connect = () => {
    if (stopped) return;

    logger.info('BRIDGE_EVENT_STREAM_CONNECTING', 'Connecting to Hue bridge event stream', {
      bridgeIp: config.HUE_BRIDGE_IP,
      path: '/eventstream/clip/v2'
    });

    const req = https.request({
      hostname: config.HUE_BRIDGE_IP,
      port: 443,
      path: '/eventstream/clip/v2',
      method: 'GET',
      rejectUnauthorized: false,
      headers: {
        'hue-application-key': config.HUE_API_TOKEN,
        Accept: 'text/event-stream'
      }
    }, (res) => {
      currentResponse = res;

      if (res.statusCode !== 200) {
        let body = '';
        let handled = false;
        const retryNon200 = () => {
          if (handled) return;
          handled = true;
          scheduleReconnect('non_200_status', {
            status: res.statusCode,
            responsePreview: body.slice(0, 300)
          });
        };
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', retryNon200);
        res.on('close', retryNon200);
        res.on('error', retryNon200);
        return;
      }

      retryMs = BASE_RETRY_MS;
      logger.info('BRIDGE_EVENT_STREAM_CONNECTED', 'Hue bridge event stream connected');

      let buffer = '';
      let disconnected = false;

      const handleDisconnect = (reason, fields = {}) => {
        if (disconnected || stopped) return;
        disconnected = true;
        scheduleReconnect(reason, fields);
      };

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        if (buffer.length > 1_000_000) {
          logger.warn('BRIDGE_EVENT_BUFFER_RESET', 'Resetting oversized Hue event stream buffer', {
            bufferLength: buffer.length
          });
          buffer = '';
        }

        while (true) {
          const delimiter = findFrameDelimiter(buffer);
          if (delimiter.index === -1) break;

          const frame = buffer.slice(0, delimiter.index);
          buffer = buffer.slice(delimiter.index + delimiter.length);

          if (!frame.trim()) continue;
          const parsed = parseSseDataFrame(frame);
          if (!parsed) continue;
          handleEventPayload(parsed.data, parsed.eventName);
        }
      });

      res.on('end', () => handleDisconnect('stream_end'));
      res.on('close', () => handleDisconnect('stream_close'));
      res.on('error', (error) => handleDisconnect('stream_error', { error }));
    });

    currentRequest = req;

    req.on('error', (error) => {
      if (stopped) return;
      scheduleReconnect('request_error', { error });
    });

    req.end();
  };

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (currentResponse) {
      currentResponse.destroy();
      currentResponse = null;
    }
    if (currentRequest) {
      currentRequest.destroy();
      currentRequest = null;
    }
    logger.info('BRIDGE_EVENT_STREAM_STOPPED', 'Hue bridge event stream stopped');
  };
}
