import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneLoopService } from '../src/sceneLoopService.js';
import { hueClient } from '../src/hueClient.js';
import { FakeDatabase } from './helpers/fakeDatabase.js';

const originalActivateScene = hueClient.activateScene;
const originalRecallScene = hueClient.v2RecallScene;

function makeLoop(overrides = {}) {
  return {
    groupId: '1',
    isRunning: true,
    dwellMs: 8000,
    mode: 'sequential',
    currentIndex: 0,
    playlist: [{ sceneId: 'scene-1', sceneType: 'v1' }],
    lastError: null,
    ...overrides
  };
}

test.afterEach(() => {
  hueClient.activateScene = originalActivateScene;
  hueClient.v2RecallScene = originalRecallScene;
  sceneLoopService.stop();
  sceneLoopService.runtime.clear();
});

test('runTick does not re-enable loop after stopLoop during in-flight execution', async () => {
  const db = new FakeDatabase();
  db.upsertSceneLoop(makeLoop());
  sceneLoopService.setDatabase(db);

  let releaseActivation = null;
  hueClient.activateScene = async () => new Promise((resolve) => {
    releaseActivation = () => resolve([]);
  });

  sceneLoopService.runtime.set('1', {
    generation: 1,
    busy: false,
    consecutiveFailures: 0,
    timer: null
  });

  const tickPromise = sceneLoopService.runTick('1', 1);
  for (let i = 0; i < 50 && !releaseActivation; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(typeof releaseActivation, 'function');

  const stopped = sceneLoopService.stopLoop('1');
  assert.equal(stopped.isRunning, false);
  releaseActivation();
  await tickPromise;

  const latest = db.getSceneLoopByGroup('1');
  assert.ok(latest);
  assert.equal(latest.isRunning, false);
});

test('runTick auto-stops loop after max consecutive failures', async () => {
  const db = new FakeDatabase();
  db.upsertSceneLoop(makeLoop());
  sceneLoopService.setDatabase(db);

  hueClient.activateScene = async () => [{ error: { description: 'bridge failure' } }];
  sceneLoopService.runtime.set('1', {
    generation: 1,
    busy: false,
    consecutiveFailures: 4,
    timer: null
  });

  await sceneLoopService.runTick('1', 1);
  const latest = db.getSceneLoopByGroup('1');
  assert.ok(latest);
  assert.equal(latest.isRunning, false);
  assert.match(String(latest.lastError || ''), /auto-stopped/i);
});
