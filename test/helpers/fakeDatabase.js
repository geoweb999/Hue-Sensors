function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class FakeDatabase {
  constructor() {
    this.sceneLoops = new Map();
    this.dynamicScenes = new Map();
  }

  getSceneLoopByGroup(groupId) {
    const row = this.sceneLoops.get(String(groupId));
    return row ? deepClone(row) : null;
  }

  upsertSceneLoop(loop) {
    const key = String(loop.groupId);
    const now = Date.now();
    const existing = this.sceneLoops.get(key);
    const next = {
      groupId: key,
      isRunning: !!loop.isRunning,
      dwellMs: Number(loop.dwellMs) || 8000,
      mode: String(loop.mode || 'sequential'),
      currentIndex: Number(loop.currentIndex) || 0,
      playlist: Array.isArray(loop.playlist) ? deepClone(loop.playlist) : [],
      lastError: loop.lastError || null,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    this.sceneLoops.set(key, next);
    return deepClone(next);
  }

  getRunningSceneLoops() {
    return [...this.sceneLoops.values()]
      .filter((loop) => loop.isRunning)
      .map((loop) => deepClone(loop));
  }

  deleteSceneLoopByGroup(groupId) {
    return this.sceneLoops.delete(String(groupId)) ? 1 : 0;
  }

  upsertDynamicScene(scene) {
    const key = String(scene.sceneId);
    const now = Date.now();
    const existing = this.dynamicScenes.get(key);
    const next = {
      sceneId: key,
      groupId: String(scene.groupId),
      name: String(scene.name || ''),
      palette: Array.isArray(scene.palette) ? deepClone(scene.palette) : [],
      speed: Number(scene.speed) || 0.5,
      choreography: scene.choreography && typeof scene.choreography === 'object'
        ? deepClone(scene.choreography)
        : null,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    this.dynamicScenes.set(key, next);
    return deepClone(next);
  }

  getDynamicScenesByGroup(groupId) {
    return [...this.dynamicScenes.values()]
      .filter((scene) => scene.groupId === String(groupId))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((scene) => deepClone(scene));
  }

  deleteDynamicSceneById(sceneId) {
    return this.dynamicScenes.delete(String(sceneId)) ? 1 : 0;
  }
}
