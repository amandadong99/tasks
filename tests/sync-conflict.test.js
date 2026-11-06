/* 端到端场景：多台设备 + 内存版 Firestore，全部使用测试数据。
 * 备注：不要动其他主程序内容，不要动登录系统。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FakeServer, Device, makeKey, seedLegacyDoc, readCloudTask, openTask, settle,
} = require('./helpers/sync-harness');

const NOW = Date.now();
const COMPLETED = '已完成';
const OPEN = '进行中';

async function setup(tasks = [openTask('t1')], syncedAt = NOW - 60_000) {
  const server = new FakeServer();
  const key = await makeKey();
  const seeder = new Device(server, { name: 'seeder' });
  for (const task of tasks) await seedLegacyDoc(server, seeder, key, task, syncedAt);
  seeder.kill();
  return { server, key };
}

async function connected(server, key, options) {
  const device = new Device(server, options);
  await device.connect(key);
  return device;
}

test('completing a task while the app is still connecting survives the first pull', async () => {
  const { server, key } = await setup();
  const first = await connected(server, key, { name: 'phone' });
  const storage = first.storage;
  first.kill();

  const phone = new Device(server, { storage, name: 'phone' });
  phone.complete('t1');              // 打开 App 时看到的是本地缓存，马上点了完成
  await phone.connect(key);          // 这时才连上云端

  assert.equal(phone.task('t1').status, COMPLETED);
  assert.equal((await readCloudTask(server, phone, key, 't1')).status, COMPLETED);
});

test('completing a task while a remote change is being applied is not dropped', async () => {
  const { server, key } = await setup([openTask('t1'), openTask('t2')]);
  const phone = await connected(server, key, { name: 'phone' });
  const desk = await connected(server, key, { name: 'desk' });

  // 解密远端变更是异步的，用户的点击可能正好落在这段时间里
  const decrypt = phone.fb.Crypto.decrypt.bind(phone.fb.Crypto);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  phone.fb.Crypto.decrypt = async (...args) => { await gate; return decrypt(...args); };

  desk.edit('t2', { note: 'from desk' });
  await settle();
  phone.complete('t1');
  phone.fb.Crypto.decrypt = decrypt;
  release();
  await settle();

  assert.equal(phone.task('t1').status, COMPLETED);
  assert.equal((await readCloudTask(server, phone, key, 't1')).status, COMPLETED);
  assert.equal(desk.task('t1').status, COMPLETED);
  assert.equal(phone.task('t2').note, 'from desk');
});

test('a stale device editing an old copy cannot pull a completed task back', async () => {
  const { server, key } = await setup();
  const phone = await connected(server, key, { name: 'phone' });
  const laptop = await connected(server, key, { name: 'laptop' });

  laptop.client.setOnline(false);    // 电脑离线，手里是旧数据
  phone.complete('t1');
  await settle();
  laptop.edit('t1', { note: 'edited on old copy' });
  await settle();
  laptop.client.setOnline(true);     // 重新上线，把旧副本写回去
  await settle();

  for (const device of [phone, laptop]) {
    assert.equal(device.task('t1').status, COMPLETED, device.name);
    assert.equal(device.task('t1').note, 'edited on old copy', device.name);
  }
  const cloud = await readCloudTask(server, phone, key, 't1');
  assert.equal(cloud.status, COMPLETED);
  assert.equal(cloud.note, 'edited on old copy');
});

test('an offline completion survives killing the app and uploads after reconnecting', async () => {
  const { server, key } = await setup();
  const phone = await connected(server, key, { name: 'phone' });
  phone.client.setOnline(false);
  phone.complete('t1');
  await settle();
  const storage = phone.storage;
  phone.kill();

  const reopened = new Device(server, { storage, name: 'phone' });
  reopened.client.setOnline(false);
  assert.equal(reopened.task('t1').status, COMPLETED);
  await reopened.connect(key);
  assert.equal(reopened.task('t1').status, COMPLETED);

  reopened.client.setOnline(true);
  await reopened.fb.refresh();
  await settle();
  assert.equal(reopened.task('t1').status, COMPLETED);
  assert.equal((await readCloudTask(server, reopened, key, 't1')).status, COMPLETED);
});

test('a lagging cloud update never reverts a local change still waiting to upload', async () => {
  const { server, key } = await setup();
  const phone = await connected(server, key, { name: 'phone' });
  const desk = await connected(server, key, { name: 'desk' });

  server.transactionFailures = 1;    // 第一次上传失败：云端还是旧状态
  phone.complete('t1');
  await settle();
  desk.edit('t1', { note: 'cloud moved on' });
  await settle();

  assert.equal(phone.task('t1').status, COMPLETED);
  assert.equal(phone.task('t1').note, 'cloud moved on');
  await phone.fb.refresh();
  await settle();
  assert.equal((await readCloudTask(server, phone, key, 't1')).status, COMPLETED);
  assert.equal(desk.task('t1').status, COMPLETED);
});

test('un-completing syncs everywhere and an older completion cannot return', async () => {
  const { server, key } = await setup();
  const phone = await connected(server, key, { name: 'phone' });
  const laptop = await connected(server, key, { name: 'laptop' });

  phone.complete('t1');
  await settle();
  assert.equal(laptop.task('t1').status, COMPLETED);

  laptop.client.setOnline(false);
  laptop.edit('t1', { note: 'old copy still says completed' });
  phone.edit('t1', { status: OPEN });
  await settle();
  laptop.client.setOnline(true);
  await settle();

  for (const device of [phone, laptop]) {
    assert.equal(device.task('t1').status, OPEN, device.name);
    assert.equal(device.task('t1').note, 'old copy still says completed', device.name);
  }
  assert.equal((await readCloudTask(server, phone, key, 't1')).status, OPEN);
});

test('a phone whose clock runs slow still wins over a change it has already seen', async () => {
  const { server, key } = await setup();
  const desk = await connected(server, key, { name: 'desk' });
  const phone = await connected(server, key, { name: 'phone', clockOffsetMs: -3_600_000 });

  desk.edit('t1', { status: COMPLETED });
  await settle();
  assert.equal(phone.task('t1').status, COMPLETED);

  phone.edit('t1', { status: OPEN });  // 手机时钟慢 1 小时，但它是看过电脑的修改后才改的
  await settle();
  assert.equal(desk.task('t1').status, OPEN);
  assert.equal((await readCloudTask(server, phone, key, 't1')).status, OPEN);
});

test('a phone whose clock runs fast does not make later changes on other devices lose', async () => {
  const { server, key } = await setup();
  const phone = await connected(server, key, { name: 'phone', clockOffsetMs: 3_600_000 });
  const desk = await connected(server, key, { name: 'desk' });

  phone.edit('t1', { status: COMPLETED });
  await settle();
  desk.edit('t1', { status: OPEN });
  await settle();

  assert.equal(phone.task('t1').status, OPEN);
  assert.equal((await readCloudTask(server, phone, key, 't1')).status, OPEN);
});

test('upgrading rewrites nothing: legacy documents stay untouched and the cloud wins', async () => {
  const { server, key } = await setup([openTask('t1'), openTask('t2', { note: 'cloud' })]);
  const before = JSON.stringify([...server.docs.entries()]);
  const writes = server.writes;

  const first = new Device(server, { name: 'upgraded' });
  first.A.State.tasks = [openTask('t2', { note: 'stale local copy' })];
  first.A.Store.save('amanda.tasks', first.A.State.tasks);
  first.A.captureSyncSnapshot();
  await first.connect(key);

  assert.equal(server.writes, writes);
  assert.equal(JSON.stringify([...server.docs.entries()]), before);
  assert.equal(first.task('t2').note, 'cloud');
  assert.equal(first.A.State.tasks.length, 2);
});

test('a write from a not-yet-upgraded device is judged by its own write time', async () => {
  const { server, key } = await setup();
  const phone = await connected(server, key, { name: 'phone' });
  phone.complete('t1');
  await settle();

  // 未升级的设备把几小时前离线排队的写入发了上来
  await seedLegacyDoc(server, phone, key, openTask('t1'), NOW - 3_600_000);
  server.notify();
  await settle();
  assert.equal(phone.task('t1').status, COMPLETED);
  assert.equal((await readCloudTask(server, phone, key, 't1')).status, COMPLETED);

  // 未升级的设备刚刚真实地取消了完成
  await seedLegacyDoc(server, phone, key, openTask('t1', { note: 'old app' }), Date.now() + 1000);
  server.notify();
  await settle();
  assert.equal(phone.task('t1').status, OPEN);
  assert.equal(phone.task('t1').note, 'old app');
});

test('an upload that keeps failing stays queued and is never dropped', async () => {
  const { server, key } = await setup();
  const phone = await connected(server, key, { name: 'phone' });
  server.transactionFailures = 3;
  phone.complete('t1');
  await settle();
  assert.equal((await readCloudTask(server, phone, key, 't1')).status, OPEN);
  assert.equal(JSON.parse(phone.storage.getItem(phone.fb.OUTBOX_KEY)).length, 1);

  for (let i = 0; i < 3; i++) { await phone.fb.flushOutbox(); await settle(); }
  assert.equal((await readCloudTask(server, phone, key, 't1')).status, COMPLETED);
  assert.deepEqual(JSON.parse(phone.storage.getItem(phone.fb.OUTBOX_KEY)), []);
});

test('a change made during an upload is uploaded too', async () => {
  const { server, key } = await setup();
  const phone = await connected(server, key, { name: 'phone' });
  const encrypt = phone.fb.Crypto.encrypt.bind(phone.fb.Crypto);
  let edited = false;
  phone.fb.Crypto.encrypt = async (...args) => {
    if (!edited) { edited = true; phone.edit('t1', { note: 'second change' }); }
    return encrypt(...args);
  };
  phone.complete('t1');
  await settle();
  const cloud = await readCloudTask(server, phone, key, 't1');
  assert.equal(cloud.status, COMPLETED);
  assert.equal(cloud.note, 'second change');
  assert.deepEqual(JSON.parse(phone.storage.getItem(phone.fb.OUTBOX_KEY)), []);
});

test('a queued edit cannot bring a task deleted elsewhere back to life', async () => {
  const { server, key } = await setup();
  const phone = await connected(server, key, { name: 'phone' });
  const laptop = await connected(server, key, { name: 'laptop' });

  laptop.client.setOnline(false);
  laptop.edit('t1', { note: 'edited while offline' });
  phone.A.State.tasks = [];
  phone.context.window.__persistTasks();
  await settle();
  laptop.client.setOnline(true);
  await laptop.fb.refresh();
  await settle();

  assert.equal(await readCloudTask(server, phone, key, 't1'), null);
  assert.equal(phone.task('t1'), undefined);
  assert.equal(laptop.task('t1'), undefined);
});

test('history entries written on two devices at once are both kept', async () => {
  const { server, key } = await setup();
  const phone = await connected(server, key, { name: 'phone' });
  const laptop = await connected(server, key, { name: 'laptop' });

  const add = (device, content) => {
    device.task('t1').progressHistory.push({ date: '2026-11-06', type: '推进', content });
    device.context.window.__persistTasks();
  };
  add(phone, 'seed');
  await settle();
  laptop.client.setOnline(false);
  add(laptop, 'from laptop');
  add(phone, 'from phone');
  await settle();
  laptop.client.setOnline(true);
  await settle();

  for (const device of [phone, laptop]) {
    const contents = Array.from(device.task('t1').progressHistory, h => h.content).sort();
    assert.deepEqual(contents, ['from laptop', 'from phone', 'seed'], device.name);
  }
});
