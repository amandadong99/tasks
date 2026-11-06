/* 同步测试用的内存版 Firestore + 多设备模拟。
 * 只用测试数据，不连线上 Firebase。
 * 备注：不要动其他主程序内容，不要动登录系统。
 *
 * 载入的是真实的 firebase-config.js，以及 app.js 里真实的“持久化 + 同步”代码段，
 * 这样测试跑的就是线上会运行的代码。设 SYNC_TEST_ROOT 可以指向旧版本目录做对照。 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const ROOT = process.env.SYNC_TEST_ROOT || path.join(__dirname, '..', '..');

// Web Crypto 在线程池里执行，只转 setImmediate 等不到它，所以按真实时间等几轮。
const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await new Promise(resolve => setTimeout(resolve, 4));
};

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

/** 云端：所有设备共用。docs 的 key 是文档路径，value 是文档内容。 */
class FakeServer {
  constructor() {
    this.docs = new Map();
    this.writes = 0;
    this.clients = new Set();
    this.transactionFailures = 0;
  }
  write(ref, data) {
    this.writes++;
    this.docs.set(ref.path, { ...data });
    this.version = (this.version || 0) + 1;
  }
  remove(ref) {
    this.docs.delete(ref.path);
    this.version = (this.version || 0) + 1;
  }
  list(collectionPath) {
    const prefix = collectionPath + '/';
    return [...this.docs.entries()]
      .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .map(([key, data]) => ({ id: key.slice(prefix.length), path: key, data }));
  }
  notify() {
    for (const client of this.clients) client.deliver();
  }
}

/** 一台设备连接 Firestore 的客户端（对应 firebase 模块导出的函数）。 */
class FakeClient {
  constructor(server) {
    this.server = server;
    this.online = true;
    this.pending = [];
    this.listeners = new Set();
    server.clients.add(this);
    this.modules = this.buildModules();
  }
  setOnline(value) {
    this.online = value;
    if (value) {
      const queued = this.pending.splice(0);
      for (const run of queued) run();
      this.server.notify();
    }
  }
  disconnect() {
    this.server.clients.delete(this);
    this.listeners.clear();
  }
  deliver() {
    if (!this.online) return;
    for (const listener of this.listeners) {
      const current = new Map(this.server.list(listener.path).map(d => [d.id, d]));
      const changes = [];
      for (const [id, doc] of current) {
        const known = listener.known.get(id);
        if (known === undefined) changes.push({ type: 'added', doc: this.snapshot(doc) });
        else if (known !== JSON.stringify(doc.data)) changes.push({ type: 'modified', doc: this.snapshot(doc) });
      }
      for (const [id, json] of listener.known) {
        if (!current.has(id)) {
          changes.push({ type: 'removed', doc: this.snapshot({ id, data: JSON.parse(json) }) });
        }
      }
      if (!changes.length) continue;
      listener.known = new Map([...current].map(([id, doc]) => [id, JSON.stringify(doc.data)]));
      listener.callback({ docChanges: () => changes });
    }
  }
  snapshot(doc) {
    return {
      id: doc.id,
      exists: () => !!doc.data,
      data: () => doc.data ? JSON.parse(JSON.stringify(doc.data)) : undefined,
      metadata: { hasPendingWrites: false },
    };
  }
  whenOnline(run) {
    if (this.online) { run(); this.server.notify(); return Promise.resolve(); }
    return new Promise(resolve => this.pending.push(() => { run(); resolve(); }));
  }
  buildModules() {
    const client = this;
    const server = this.server;
    return {
      collection: (_db, ...parts) => ({ path: parts.join('/') }),
      doc: (_db, ...parts) => ({ path: parts.join('/') }),
      query: ref => ref,
      limit: () => null,
      async getDocs(ref) {
        const docs = client.online ? server.list(ref.path).map(d => client.snapshot(d)) : [];
        return { empty: docs.length === 0, docs };
      },
      setDoc: (ref, data) => client.whenOnline(() => server.write(ref, data)),
      deleteDoc: ref => client.whenOnline(() => server.remove(ref)),
      writeBatch() {
        const ops = [];
        return {
          set: (ref, data) => ops.push(() => server.write(ref, data)),
          delete: ref => ops.push(() => server.remove(ref)),
          commit: () => client.whenOnline(() => ops.forEach(run => run())),
        };
      },
      async runTransaction(_db, update) {
        if (!client.online) throw Object.assign(new Error('offline'), { code: 'unavailable' });
        if (server.transactionFailures > 0) {
          server.transactionFailures--;
          throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
        }
        for (let attempt = 0; attempt < 5; attempt++) {
          const versionAtStart = server.version;
          const ops = [];
          const result = await update({
            get: async ref => client.snapshot({ id: ref.path.split('/').pop(), data: server.docs.get(ref.path) }),
            set: (ref, data) => ops.push(() => server.write(ref, data)),
            delete: ref => ops.push(() => server.remove(ref)),
          });
          if (versionAtStart !== server.version) continue; // 读后被别人写过：重试
          ops.forEach(run => run());
          server.notify();
          return result;
        }
        throw Object.assign(new Error('aborted'), { code: 'aborted' });
      },
      onSnapshot(ref, callback) {
        const listener = { path: ref.path, known: new Map(), callback };
        client.listeners.add(listener);
        client.deliver();
        return () => client.listeners.delete(listener);
      },
      waitForPendingWrites: async () => {},
      enableIndexedDbPersistence: async () => {},
      initializeApp: () => ({}),
      getFirestore: () => ({}),
    };
  }
}

function extractPersistenceCode(appSource) {
  const start = appSource.indexOf('/* 持久化 + Firebase 同步 */');
  const end = appSource.indexOf(' * 4. 业务逻辑工具');
  if (start < 0 || end < 0) throw new Error('找不到 app.js 的同步代码段');
  return appSource.slice(start, appSource.lastIndexOf('/*', end));
}

const COLLECTIONS = ['tasks', 'persons', 'trips', 'templates', 'notes', 'fuzzyPlans',
  'exhibitions', 'salespeople', 'visas'];

/** 用同一个 storage 重建 Device = 手机杀掉 App 后重新打开。 */
class Device {
  constructor(server, { storage, clockOffsetMs = 0, name = 'device' } = {}) {
    this.server = server;
    this.name = name;
    this.storage = storage || createMemoryStorage();
    this.clockOffsetMs = clockOffsetMs;
    this.client = new FakeClient(server);
    this.renders = 0;
    this.reloads = 0;
    this.confirmAnswer = true;

    const context = vm.createContext({
      window: {}, localStorage: this.storage, crypto: webcrypto, TextEncoder, TextDecoder,
      btoa: v => Buffer.from(v, 'binary').toString('base64'),
      atob: v => Buffer.from(v, 'base64').toString('binary'),
      console: { info() {}, warn() {}, error() {}, log() {} },
      setTimeout, clearTimeout, setImmediate, Promise,
      __realNow: () => Date.now() + this.clockOffsetMs,
    });
    vm.runInContext('Date.now = () => __realNow();', context);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8'), context);
    context.State = {};
    context.KEY = {};
    for (const k of COLLECTIONS) {
      context.State[k] = JSON.parse(this.storage.getItem('amanda.' + k) || '[]');
      context.KEY[k] = 'amanda.' + k;
    }
    context.Store = {
      save: (k, v) => this.storage.setItem(k, JSON.stringify(v)),
      load: (k, fallback) => JSON.parse(this.storage.getItem(k) || 'null') ?? fallback,
    };
    const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    vm.runInContext(`${extractPersistenceCode(appSource)}
      window.__persistTasks = persistTasks;
      window.__persistSalespeople = persistSalespeople;
      window.AmandaTasks = {
        State, Store, KEY,
        renderAll() { window.__onRender && window.__onRender(); },
        captureSyncSnapshot,
        ...(typeof stampLocalChanges === 'function' ? { stampLocalChanges } : {}),
      };
      captureSyncSnapshot();`, context);
    this.context = context;
    this.fb = context.window.AmandaFirebase;
    this.A = context.window.AmandaTasks;
    context.window.__onRender = () => { this.renders++; };
    this.fb._updateSyncIndicator = () => {};
    this.fb._showStatus = () => {};
    this.fb._modules = this.client.modules;
  }

  /** 走与 init() 相同的连接流程，只是跳过 PBKDF2 和 SDK 下载。 */
  async connect(cryptoKey, { finish = true } = {}) {
    const fb = this.fb;
    fb.db = {};
    fb.userId = 'test-user';
    fb.cryptoKey = cryptoKey;
    fb.ready = true;
    const run = async () => {
      await fb.pullAndSubscribe();
      fb._firstSyncDone = true;
      await fb.flushPendingDeletes();
      await fb.flushOutbox?.();
      if (!fb.flushOutbox) this.A.captureSyncSnapshot();
    };
    if (!finish) return run;
    await run();
    await settle();
  }

  task(id) { return this.A.State.tasks.find(t => t.id === id); }
  edit(id, changes) {
    Object.assign(this.task(id), changes);
    this.context.window.__persistTasks();
  }
  complete(id) {
    const t = this.task(id);
    t.status = '已完成';
    t.completedAt = new Date(Date.now() + this.clockOffsetMs).toISOString();
    (t.progressHistory ||= []).push({ date: '2026-11-06', type: '推进', content: '标记完成' });
    this.context.window.__persistTasks();
  }
  /** 运行 app.js 里真实的 resetData；initData 用首次预填分支的最小等价写法。 */
  resetData() {
    const { context } = this;
    if (!context.window.__resetData) {
      const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
      const start = source.indexOf('function resetData(');
      const code = source.slice(start, source.indexOf('/** 查找重复', start));
      Object.assign(context, {
        confirm: message => { this.lastConfirm = message; return this.confirmAnswer; },
        closeModal() {}, toast() {}, renderAll() {},
        location: { reload: () => { this.reloads++; } },
      });
      context.Store.remove = k => this.storage.removeItem(k);
      vm.runInContext(`
        KEY.meta = 'amanda.meta'; KEY.docKey = 'amanda.docKey';
        function initData() {
          State.tasks = [{ id: 'seed-1', title: 'seed', status: '进行中',
            progressHistory: [{ date: '2026-11-06', type: '创建', content: '系统预填' }] }];
          State.trips = []; State.notes = []; State.visas = [];
          Store.save(KEY.tasks, State.tasks);
          Store.save(KEY.meta, { seeded: true });
        }
        ${code}
        window.__resetData = resetData;`, context);
    }
    context.window.__resetData();
  }
  /** App 被杀：内存和监听都消失，只有 storage 留下。 */
  kill() {
    this.fb.shutdown();
    this.client.disconnect();
  }
}

async function makeKey() {
  return webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** 按旧版 v5.11.7 的格式写一条云端文档（没有版本标记）。 */
async function seedLegacyDoc(server, device, cryptoKey, item, syncedAt) {
  const { iv, ct } = await device.fb.Crypto.encrypt(cryptoKey, JSON.stringify(item));
  server.docs.set(`users/test-user/tasks/${item.id}`, { iv, ct, _syncedAt: syncedAt });
}

async function readCloudTask(server, device, cryptoKey, id) {
  const data = server.docs.get(`users/test-user/tasks/${id}`);
  if (!data) return null;
  return JSON.parse(await device.fb.Crypto.decrypt(cryptoKey, data));
}

const openTask = (id, extra = {}) => ({
  id, title: 'task ' + id, status: '进行中', dueDate: '2026-11-01', progressHistory: [], ...extra,
});

module.exports = {
  FakeServer, Device, createMemoryStorage, makeKey, seedLegacyDoc, readCloudTask, openTask, settle,
  extractPersistenceCode, ROOT,
};
