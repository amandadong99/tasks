/* 合并规则的单元测试 + 编辑行程不重置子任务。全部使用测试数据。
 * 备注：不要动其他主程序内容，不要动登录系统。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { FakeServer, Device, ROOT } = require('./helpers/sync-harness');

const device = new Device(new FakeServer());
const fb = device.fb;
const plain = value => JSON.parse(JSON.stringify(value));
const clock = (ms, name = 'a') => fb._formatClock(ms, 0, name);
const stamped = (values, clocks) => ({
  id: 't', ...values,
  _sync: { clock: Object.values(clocks).sort().pop() || '', fields: clocks },
});
const merge = (...args) => plain(fb.mergeItems(...args).item);

test('each field keeps its own newest change', () => {
  const phone = stamped({ status: 'done', note: 'old' }, { status: clock(200) });
  const laptop = stamped({ status: 'open', note: 'new' }, { note: clock(300, 'b') });
  const result = fb.mergeItems(phone, laptop);
  assert.equal(result.item.status, 'done');
  assert.equal(result.item.note, 'new');
  assert.equal(result.localChanged, true);
  assert.equal(result.remoteBehind, true);
});

test('a deleted field stays deleted when the deletion is newer', () => {
  const local = stamped({}, { dueTime: clock(300) });
  const remote = stamped({ dueTime: '10:00' }, { dueTime: clock(200) });
  assert.equal('dueTime' in merge(local, remote), false);
});

test('identical versions need no work in either direction', () => {
  const item = stamped({ status: 'done' }, { status: clock(200) });
  const result = fb.mergeItems(item, plain(item));
  assert.equal(result.localChanged, false);
  assert.equal(result.remoteBehind, false);
});

test('field order alone never counts as a change', () => {
  const a = stamped({ meta: { x: 1, y: 2 } }, { meta: clock(1) });
  const b = stamped({ meta: { y: 2, x: 1 } }, { meta: clock(1) });
  const result = fb.mergeItems(a, b);
  assert.equal(result.localChanged, false);
  assert.equal(result.remoteBehind, false);
});

test('a clock counter orders two changes in the same millisecond', () => {
  const earlier = stamped({ status: 'open' }, { status: fb._formatClock(5, 1, 'z') });
  const later = stamped({ status: 'done' }, { status: fb._formatClock(5, 2, 'a') });
  assert.equal(merge(earlier, later).status, 'done');
  assert.equal(merge(later, earlier).status, 'done');
});

test('every merge order converges to the same result', () => {
  let seed = 42;
  const random = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const version = name => {
    const values = {};
    const clocks = {};
    for (const field of ['status', 'note', 'dueDate']) {
      if (random(3) === 0) continue;
      values[field] = `${name}-${field}-${random(3)}`;
      clocks[field] = clock(100 + random(5), name);
    }
    return stamped(values, clocks);
  };
  const strip = item => {
    const { _sync, ...values } = item;
    return JSON.stringify(Object.keys(values).sort().map(k => [k, values[k]]));
  };
  for (let i = 0; i < 500; i++) {
    const [a, b, c] = [version('a'), version('b'), version('c')];
    assert.equal(strip(merge(a, b)), strip(merge(b, a)));
    assert.equal(strip(merge(merge(a, b), c)), strip(merge(a, merge(b, c))));
    assert.equal(strip(merge(merge(a, b), b)), strip(merge(a, b)));
  }
});

test('the clock survives a restart and never runs backwards', () => {
  const first = new Device(new FakeServer(), { clockOffsetMs: 3_600_000 });
  const stampedBefore = first.fb._nextClock();
  const restarted = new Device(new FakeServer(), { storage: first.storage });
  assert.ok(restarted.fb._nextClock() > stampedBefore);
});

test('editing a trip keeps completed subtasks instead of resetting them', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const start = source.indexOf('function deriveTripTasks(');
  const end = source.indexOf('function openTripDetail(');
  const context = vm.createContext({
    State: {
      tasks: [],
      templates: [{ id: 'tpl', name: 'T', tasks: [
        { title: 'book', stage: 'prep', daysBeforeDeparture: 3, alertLevel: 'x' },
        { title: 'pack', stage: 'prep', daysBeforeDeparture: 1, alertLevel: 'x' },
        { title: 'added', stage: 'prep', daysBeforeDeparture: 1, alertLevel: 'x' },
      ] }],
    },
    todayISO: () => '2026-11-06',
    addDays: (date, days) => `${date}${days}`,
    uuid: () => 'new-id',
  });
  vm.runInContext(source.slice(start, end), context);
  const previous = [
    { id: 'kept', title: 'book', _tripStage: 'prep', status: '已完成', dueDate: 'old', postponeCount: 0 },
    { id: 'moved', title: 'pack', _tripStage: 'prep', status: '进行中', dueDate: 'manual', postponeCount: 1 },
  ];
  const trip = { id: 'trip', templateId: 'tpl', departureDate: 'D', returnDate: 'R' };

  context.deriveTripTasks(trip, previous);

  const [book, pack, added] = plain(context.State.tasks);
  assert.deepEqual([book.id, book.status, book.dueDate], ['kept', '已完成', 'D-3']);
  assert.deepEqual([pack.id, pack.dueDate], ['moved', 'manual']);
  assert.deepEqual([added.id, added.status], ['new-id', '进行中']);
  assert.deepEqual(plain(trip.relatedTaskIds), ['kept', 'moved', 'new-id']);
});

test('the real app exposes stampLocalChanges to the sync layer', () => {
  // 测试夹具自己拼 AmandaTasks，所以要单独核对线上代码真的把它暴露出去
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const exposed = source.match(/window\.AmandaTasks = \{([^}]*)\}/)[1];
  assert.match(exposed, /\bstampLocalChanges\b/);
});

function loadVisaCode(tasks) {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const start = source.indexOf('const VISA_NODES');
  const end = source.indexOf('function openVisaModal(');
  let nextId = 0;
  const context = vm.createContext({
    State: { tasks, visas: [] },
    todayISO: () => '2026-11-06',
    addDays: (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10),
    daysBetween: (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000),
    uuid: () => `new-${++nextId}`,
  });
  vm.runInContext(source.slice(start, end), context);
  return context;
}

const visa = (extra = {}) => ({
  id: 'v1', docType: '签证', country: '美国', visaType: 'B1', expiryDate: '2027-12-31', ...extra,
});

test('editing a visa without changing its expiry keeps its tasks and their completion', () => {
  const context = loadVisaCode([]);
  const before = visa();
  context.deriveVisaTasks(before);
  const [first, second] = context.State.tasks;
  first.status = '已完成';
  second.postponeCount = 1;
  second.dueDate = '2027-11-20';
  const ids = plain(context.State.tasks).map(t => t.id);

  const created = context.applyVisaEdit(before, visa({ country: '加拿大', notes: 'x' }));

  const after = plain(context.State.tasks);
  assert.equal(created, 0);
  assert.deepEqual(after.map(t => t.id), ids);
  assert.equal(after[0].status, '已完成');
  assert.equal(after[1].dueDate, '2027-11-20');
  assert.ok(after.every(t => t.title.includes('加拿大') && !t.title.includes('美国')));
});

test('a visa task whose date has passed is not silently dropped by a later edit', () => {
  const context = loadVisaCode([]);
  const before = visa({ expiryDate: '2026-12-20' });
  context.State.tasks.push(
    { id: 'old', title: '重新办理签证:美国 B1(2026-12-20 到期)· 提前90天',
      linkedVisaId: 'v1', status: '已完成', dueDate: '2026-09-21' },
    { id: 'open', title: '重新办理签证:美国 B1(2026-12-20 到期)· 提前60天',
      linkedVisaId: 'v1', status: '进行中', dueDate: '2026-10-21' },
  );
  context.applyVisaEdit(before, visa({ expiryDate: '2026-12-20', notes: 'x' }));
  assert.deepEqual(plain(context.State.tasks).map(t => t.id), ['old', 'open']);
});

test('changing the expiry starts a new cycle but keeps completed tasks as records', () => {
  const context = loadVisaCode([{ id: 'other', title: 'unrelated', status: '进行中' }]);
  const before = visa();
  context.deriveVisaTasks(before);
  context.State.tasks[1].status = '已完成';
  const doneId = context.State.tasks[1].id;

  const created = context.applyVisaEdit(before, visa({ expiryDate: '2030-01-01' }));

  const tasks = plain(context.State.tasks);
  assert.equal(created, 3);
  assert.ok(tasks.some(t => t.id === 'other'));
  assert.equal(tasks.find(t => t.id === doneId).status, '已完成');
  const open = tasks.filter(t => t.linkedVisaId === 'v1' && t.status !== '已完成');
  assert.equal(open.length, 3);
  assert.ok(open.every(t => t.title.includes('2030-01-01')));
});

test('a replacement pattern in a visa label is copied literally', () => {
  const context = loadVisaCode([]);
  const before = visa();
  context.deriveVisaTasks(before);
  context.applyVisaEdit(before, visa({ visaType: "$&$'" }));
  assert.ok(plain(context.State.tasks).every(t => t.title.includes("$&$'")));
});
