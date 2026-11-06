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
