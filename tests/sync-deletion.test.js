const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function loadFirebaseSync() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
  const context = {
    window: {},
    localStorage: createMemoryStorage(),
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context, { filename: 'firebase-config.js' });
  return { fb: context.window.AmandaFirebase, storage: context.localStorage };
}

test('offline deletion is persisted and hides a stale local task', async () => {
  const { fb, storage } = loadFirebaseSync();
  fb.userId = 'user-1';

  const result = await fb.queueDelete('tasks', 'task-1');

  assert.equal(result.queued, true);
  assert.equal(fb._isDeleted('tasks', 'task-1'), true);
  assert.deepEqual(fb._filterDeleted('tasks', [
    { id: 'task-1', title: 'stale' },
    { id: 'task-2', title: 'keep' },
  ]).map(item => item.id), ['task-2']);
  const queued = JSON.parse(storage.getItem(fb.DELETE_QUEUE_KEY));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].id, 'task-1');
});

test('flushing a deletion atomically writes a tombstone and deletes the old document', async () => {
  const { fb, storage } = loadFirebaseSync();
  const operations = [];
  fb.userId = 'user-1';
  fb.db = {};
  fb.ready = true;
  fb._firstSyncDone = true;
  fb.cryptoKey = {};
  fb._updateSyncIndicator = () => {};
  fb.Crypto.encrypt = async () => ({ iv: 'iv', ct: 'ct' });
  fb._modules = {
    doc: (_db, ...parts) => parts.join('/'),
    writeBatch: () => ({
      set: (ref, value) => operations.push(['set', ref, value]),
      delete: ref => operations.push(['delete', ref]),
      commit: async () => operations.push(['commit']),
    }),
  };

  await fb.queueDelete('tasks', 'task-1');

  assert.equal(operations[0][0], 'set');
  assert.match(operations[0][1], /_deletions/);
  assert.deepEqual(operations[1], ['delete', 'users/user-1/tasks/task-1']);
  assert.deepEqual(operations[2], ['commit']);
  assert.deepEqual(JSON.parse(storage.getItem(fb.DELETE_QUEUE_KEY)), []);
});

test('flushing one account preserves another account pending deletion', async () => {
  const { fb, storage } = loadFirebaseSync();
  storage.setItem(fb.DELETE_QUEUE_KEY, JSON.stringify([
    { stateKey: 'tasks', id: 'mine', deletedAt: 1, userId: 'user-1' },
    { stateKey: 'tasks', id: 'theirs', deletedAt: 2, userId: 'user-2' },
  ]));
  fb.userId = 'user-1';
  fb.db = {};
  fb.ready = true;
  fb._firstSyncDone = true;
  fb.cryptoKey = {};
  fb._updateSyncIndicator = () => {};
  fb.Crypto.encrypt = async () => ({ iv: 'iv', ct: 'ct' });
  fb._modules = {
    doc: (_db, ...parts) => parts.join('/'),
    writeBatch: () => ({ set: () => {}, delete: () => {}, commit: async () => {} }),
  };

  await fb.flushPendingDeletes();

  assert.deepEqual(JSON.parse(storage.getItem(fb.DELETE_QUEUE_KEY)), [
    { stateKey: 'tasks', id: 'theirs', deletedAt: 2, userId: 'user-2' },
  ]);
});
