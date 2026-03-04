import { hueClient } from './hueClient.js';
import { logger } from './logger.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLoopError(error) {
  return error?.message || String(error || 'Unknown loop error');
}

function normalizePlaylistItem(rawItem) {
  const sceneId = String(rawItem?.sceneId || '').trim();
  if (!sceneId) return null;

  const sceneType = String(rawItem?.sceneType || 'v1').toLowerCase() === 'v2' ? 'v2' : 'v1';
  const actionRaw = String(rawItem?.action || '').toLowerCase();
  const action = actionRaw === 'active' ? 'active' : 'dynamic_palette';
  const speedParsed = Number.parseFloat(rawItem?.speed);
  const speed = clamp(Number.isFinite(speedParsed) ? speedParsed : 0.5, 0.1, 1);

  return {
    sceneId,
    sceneType,
    name: String(rawItem?.name || '').trim() || null,
    action,
    speed
  };
}

function normalizeLoopMode(mode) {
  const normalized = String(mode || 'sequential').toLowerCase();
  if (normalized === 'shuffle') return 'shuffle';
  return 'sequential';
}

function normalizeDwellMs(value) {
  const parsed = Number.parseInt(value, 10);
  return clamp(Number.isFinite(parsed) ? parsed : 8000, 1000, 60 * 60 * 1000);
}

const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_FAILURE_BACKOFF_MS = 5 * 60 * 1000;

function nextLoopIndex(loop, currentIndex) {
  const length = Array.isArray(loop.playlist) ? loop.playlist.length : 0;
  if (length <= 1) return 0;

  if (loop.mode === 'shuffle') {
    let next = currentIndex;
    let guard = 0;
    while (next === currentIndex && guard < 10) {
      next = Math.floor(Math.random() * length);
      guard += 1;
    }
    return next;
  }

  return (currentIndex + 1) % length;
}

class SceneLoopService {
  constructor() {
    this.db = null;
    this.runtime = new Map();
    this.started = false;
  }

  setDatabase(db) {
    this.db = db;
  }

  start() {
    if (this.started) return;
    this.started = true;
    if (!this.db) return;

    const runningLoops = this.db.getRunningSceneLoops();
    for (const loop of runningLoops) {
      this.scheduleLoopTick(loop.groupId, true);
    }

    logger.info('SCENE_LOOP_SERVICE_START', 'Scene loop service started', {
      runningLoopCount: runningLoops.length
    });
  }

  stop() {
    for (const runtime of this.runtime.values()) {
      if (runtime.timer) clearTimeout(runtime.timer);
    }
    this.runtime.clear();
    this.started = false;
    logger.info('SCENE_LOOP_SERVICE_STOP', 'Scene loop service stopped');
  }

  requireDb() {
    if (!this.db) {
      throw new Error('Scene loop service database is not initialized');
    }
  }

  normalizeLoopPayload(groupId, payload, baseLoop = null) {
    const existing = baseLoop || this.db.getSceneLoopByGroup(groupId) || {
      groupId: String(groupId),
      isRunning: false,
      dwellMs: 8000,
      mode: 'sequential',
      currentIndex: 0,
      playlist: [],
      lastError: null
    };

    const incomingPlaylist = Array.isArray(payload?.playlist)
      ? payload.playlist.map(normalizePlaylistItem).filter(Boolean)
      : existing.playlist;

    if (!Array.isArray(incomingPlaylist) || incomingPlaylist.length === 0) {
      throw new Error('playlist must include at least one scene');
    }

    const dwellMs = payload?.dwellMs != null ? normalizeDwellMs(payload.dwellMs) : normalizeDwellMs(existing.dwellMs);
    const mode = payload?.mode != null ? normalizeLoopMode(payload.mode) : normalizeLoopMode(existing.mode);

    let currentIndex = payload?.currentIndex != null
      ? Number.parseInt(payload.currentIndex, 10)
      : Number.parseInt(existing.currentIndex, 10);
    if (!Number.isFinite(currentIndex)) currentIndex = 0;
    currentIndex = clamp(currentIndex, 0, Math.max(0, incomingPlaylist.length - 1));

    const isRunning = payload?.isRunning != null ? !!payload.isRunning : !!existing.isRunning;

    return {
      groupId: String(groupId),
      isRunning,
      dwellMs,
      mode,
      currentIndex,
      playlist: incomingPlaylist,
      lastError: payload?.lastError != null ? String(payload.lastError || '') || null : (existing.lastError || null)
    };
  }

  setLoop(groupId, payload = {}) {
    this.requireDb();
    const nextLoop = this.normalizeLoopPayload(groupId, payload);
    const saved = this.db.upsertSceneLoop(nextLoop);
    if (saved.isRunning) {
      this.scheduleLoopTick(groupId, { immediate: false });
    }
    return saved;
  }

  getLoopStatus(groupId) {
    this.requireDb();
    const loop = this.db.getSceneLoopByGroup(groupId);
    if (!loop) {
      return {
        groupId: String(groupId),
        isConfigured: false,
        isRunning: false,
        dwellMs: 8000,
        mode: 'sequential',
        currentIndex: 0,
        playlist: [],
        lastError: null,
        updatedAt: null
      };
    }
    return {
      ...loop,
      isConfigured: true
    };
  }

  startLoop(groupId, payload = null) {
    this.requireDb();
    const existing = this.db.getSceneLoopByGroup(groupId);
    const loop = payload
      ? this.normalizeLoopPayload(groupId, { ...payload, isRunning: true }, existing)
      : this.normalizeLoopPayload(groupId, { isRunning: true }, existing);

    const saved = this.db.upsertSceneLoop({ ...loop, lastError: null });
    this.scheduleLoopTick(groupId, { immediate: true });
    return saved;
  }

  stopLoop(groupId) {
    this.requireDb();
    const existing = this.db.getSceneLoopByGroup(groupId);
    if (!existing) return this.getLoopStatus(groupId);

    const runtime = this.runtime.get(String(groupId));
    if (runtime?.timer) clearTimeout(runtime.timer);
    this.runtime.delete(String(groupId));

    return this.db.upsertSceneLoop({
      ...existing,
      isRunning: false,
      lastError: null
    });
  }

  clearLoop(groupId) {
    this.requireDb();
    const runtime = this.runtime.get(String(groupId));
    if (runtime?.timer) clearTimeout(runtime.timer);
    this.runtime.delete(String(groupId));
    this.db.deleteSceneLoopByGroup(groupId);
  }

  scheduleLoopTick(groupId, options = {}) {
    const key = String(groupId);
    const immediate = typeof options === 'boolean' ? options : !!options?.immediate;
    const delayOverride = typeof options === 'object' && options
      ? Number.parseInt(options.delayMs, 10)
      : null;
    const loop = this.db.getSceneLoopByGroup(key);
    if (!loop || !loop.isRunning || !Array.isArray(loop.playlist) || loop.playlist.length === 0) {
      const runtime = this.runtime.get(key);
      if (runtime?.timer) clearTimeout(runtime.timer);
      this.runtime.delete(key);
      return;
    }

    const prevRuntime = this.runtime.get(key);
    if (prevRuntime?.timer) clearTimeout(prevRuntime.timer);

    const waitMs = Number.isFinite(delayOverride) && delayOverride >= 0
      ? delayOverride
      : (immediate ? 0 : loop.dwellMs);
    const generation = (prevRuntime?.generation || 0) + 1;
    const runtime = {
      generation,
      busy: false,
      consecutiveFailures: prevRuntime?.consecutiveFailures || 0,
      timer: setTimeout(() => {
        this.runTick(key, generation).catch((error) => {
          logger.error('SCENE_LOOP_TICK_ERROR', 'Scene loop tick failed', {
            groupId: key,
            error
          });
        });
      }, waitMs)
    };

    this.runtime.set(key, runtime);
  }

  async runTick(groupId, generation) {
    const key = String(groupId);
    const runtime = this.runtime.get(key);
    if (!runtime || runtime.generation !== generation) return;
    if (runtime.busy) return;

    runtime.busy = true;
    let loop = this.db.getSceneLoopByGroup(key);
    if (!loop || !loop.isRunning || !Array.isArray(loop.playlist) || loop.playlist.length === 0) {
      runtime.busy = false;
      return;
    }

    const index = clamp(Number(loop.currentIndex) || 0, 0, loop.playlist.length - 1);
    const item = loop.playlist[index];
    let nextDelayMs = null;

    try {
      await this.executeLoopItem(key, item);
      const nextIndex = nextLoopIndex(loop, index);
      runtime.consecutiveFailures = 0;
      const latestLoop = this.db.getSceneLoopByGroup(key);
      loop = latestLoop ? this.db.upsertSceneLoop({
        ...latestLoop,
        currentIndex: nextIndex,
        lastError: null
      }) : null;

      logger.info('SCENE_LOOP_STEP', 'Scene loop step executed', {
        groupId: key,
        sceneId: item?.sceneId,
        sceneType: item?.sceneType,
        index,
        nextIndex,
        mode: loop.mode
      });
    } catch (error) {
      const message = normalizeLoopError(error);
      runtime.consecutiveFailures = (runtime.consecutiveFailures || 0) + 1;
      const shouldStop = runtime.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
      const latestLoop = this.db.getSceneLoopByGroup(key);
      const nextError = shouldStop
        ? `${message} (auto-stopped after ${runtime.consecutiveFailures} consecutive failures)`
        : message;
      loop = latestLoop ? this.db.upsertSceneLoop({
        ...latestLoop,
        isRunning: shouldStop ? false : !!latestLoop.isRunning,
        lastError: nextError
      }) : null;
      if (!shouldStop) {
        const exponent = Math.min(runtime.consecutiveFailures - 1, 6);
        nextDelayMs = Math.min((Number(loop?.dwellMs) || 8000) * (2 ** exponent), MAX_FAILURE_BACKOFF_MS);
      } else {
        logger.warn('SCENE_LOOP_AUTO_STOP', 'Scene loop auto-stopped after repeated failures', {
          groupId: key,
          sceneId: item?.sceneId,
          sceneType: item?.sceneType,
          failureCount: runtime.consecutiveFailures
        });
      }
      logger.warn('SCENE_LOOP_STEP_FAILED', 'Scene loop step failed', {
        groupId: key,
        sceneId: item?.sceneId,
        sceneType: item?.sceneType,
        error: message
      });
    } finally {
      runtime.busy = false;
    }

    if (loop?.isRunning) {
      this.scheduleLoopTick(key, { immediate: false, delayMs: nextDelayMs });
      return;
    }
    this.runtime.delete(key);
  }

  async executeLoopItem(groupId, item) {
    if (!item || !item.sceneId) {
      throw new Error('Invalid loop item (missing sceneId)');
    }

    if (item.sceneType === 'v2') {
      const action = item.action === 'active' ? 'active' : 'dynamic_palette';
      const speed = clamp(Number.parseFloat(item.speed) || 0.5, 0.1, 1);
      const result = await hueClient.v2RecallScene(item.sceneId, action, speed);
      const errors = (result?.errors || []);
      if (errors.length > 0) {
        throw new Error(errors.map((entry) => entry.description).filter(Boolean).join('; ') || 'Bridge rejected v2 scene recall');
      }
      return;
    }

    const result = await hueClient.activateScene(groupId, item.sceneId);
    const errors = (Array.isArray(result) ? result : []).filter((entry) => entry?.error);
    if (errors.length > 0) {
      throw new Error(errors.map((entry) => entry.error?.description).filter(Boolean).join('; ') || 'Bridge rejected scene activation');
    }
  }
}

export const sceneLoopService = new SceneLoopService();
