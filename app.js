/* =====================================================================
 * Amanda 个人任务指挥台 v1.0
 * 单文件主逻辑:数据层 + 视图渲染 + 交互
 * 数据存储:localStorage(默认) 或 Firebase Firestore(配置后)
 * ===================================================================== */

(function () {
'use strict';

/* ---------------------------------------------------------------------
 * 0. 工具函数
 * ------------------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uuid = () => 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const todayISO = () => new Date().toISOString().slice(0, 10);
const dateOf = (d) => (d ? new Date(d) : new Date());
const fmtDate = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return `${x.getMonth() + 1}月${x.getDate()}日`;
};
const daysBetween = (a, b) => {
  const da = new Date(a); const db = new Date(b);
  da.setHours(0, 0, 0, 0); db.setHours(0, 0, 0, 0);
  return Math.round((db - da) / 86400000);
};
const addDays = (dateStr, n) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const toast = (msg, ms = 1800) => {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
};

/* ---------------------------------------------------------------------
 * 1. 数据存储层(localStorage,可切换 Firestore)
 * ------------------------------------------------------------------ */
const KEY = {
  tasks: 'amanda.tasks',
  persons: 'amanda.persons',
  trips: 'amanda.trips',
  templates: 'amanda.tripTemplates',
  meta: 'amanda.meta',
  docKey: 'amanda.docKey',
};

const Store = {
  load(k, fallback) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  save(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  remove(k) { localStorage.removeItem(k); },
};

/* ---------------------------------------------------------------------
 * 2. 种子数据(附录 A 真实任务 + 人物)
 * ------------------------------------------------------------------ */
function seedPersons() {
  return [
    { id: 'p-anil',   name: 'Anil',   type: '客户', country: '印度',     importance: '重要客户' },
    { id: 'p-chauki', name: 'Chauki', type: '客户', country: '',         importance: '重要客户' },
    { id: 'p-islam',  name: 'Islam',  type: '客户', company: 'PDA',      importance: '重要客户' },
    { id: 'p-yasser', name: 'Yasser', type: '客户', country: '',         importance: '普通客户' },
    { id: 'p-luis',   name: 'Luis',   type: '客户', country: '哥伦比亚', importance: '普通客户' },
    { id: 'p-anoop',  name: 'Anoop',  type: '客户', country: '印度',     importance: '普通客户' },
    { id: 'p-oscar',  name: 'Oscar',  type: '客户', country: '墨西哥',   importance: '普通客户' },
    { id: 'p-kmpb',   name: 'KMPB',   type: '客户', importance: '普通客户' },
    { id: 'p-judy',   name: 'Judy',   type: '团队', note: '销售' },
    { id: 'p-mia',    name: 'Mia',    type: '团队' },
    { id: 'p-eric',   name: 'Eric',   type: '团队', note: '技术研发' },
    { id: 'p-zoey',   name: 'Zoey',   type: '团队', note: '询盘负责' },
    { id: 'p-comma',  name: 'Comma',  type: '团队' },
    { id: 'p-susan',  name: 'Susan',  type: '团队' },
  ];
}

function seedTasks() {
  const t = todayISO();
  const tomorrow = addDays(t, 1);
  const may6 = '2026-05-06';
  const now = new Date().toISOString();
  const mk = (o) => Object.assign({
    id: uuid(),
    priority: 'P1',
    status: '进行中',
    relatedPerson: [],
    createdAt: now,
    postponeCount: 0,
    postponeHistory: [],
    progressHistory: [{ date: t, type: '创建', content: '系统预填' }],
  }, o);

  return [
    // === 今日任务 ===
    mk({ title: '给前两天来的沙特客户建立档案', domain: '客户与销售', type: '单点', dueDate: t }),
    mk({ title: '给 Judy 问户外板螺钉按照什么收费', domain: '内部与系统', type: '单点', relatedPerson: ['p-judy'], dueDate: t }),
    mk({ title: '给 Yasser 发不同配置价格差别', domain: '客户与销售', type: '单点', relatedPerson: ['p-yasser'], dueDate: t }),
    mk({ title: '设置 GHL 自动化流程', domain: '内部与系统', type: '长期跟进', dueDate: t }),
    mk({ title: '发 Luis 6×8 尺自动线 B 款图纸', domain: '客户与销售', type: '单点', relatedPerson: ['p-luis'], dueDate: t }),
    mk({ title: '给印度 Anoop 打电话谈价格', domain: '客户与销售', type: '单点', relatedPerson: ['p-anoop'], dueDate: t }),

    // === 明日任务 ===
    mk({ title: '安排返程机票', domain: '客户与销售', type: '出差子任务', dueDate: tomorrow }),
    mk({ title: '跟进 Chauki 来访无锡日期', domain: '客户与销售', type: '长期跟进', relatedPerson: ['p-chauki'], dueDate: tomorrow }),
    mk({ title: '给 Islam PDA 打电话', domain: '客户与销售', type: '长期跟进', relatedPerson: ['p-islam'], dueDate: tomorrow }),

    // === 5月6日 ===
    mk({ title: '宁波银行理财经理过来', domain: '家庭与个人', type: '单点', dueDate: may6 }),
    mk({ title: '关注语宝上学报名', domain: '家庭与个人', type: '长期跟进', dueDate: may6 }),

    // === 已逾期任务(关键测试用例)===
    mk({ title: '问 4尺2+3尺二手浸胶线预算50万', domain: '内部与系统', type: '长期跟进', dueDate: '2026-04-25', priority: 'P1' }),
    mk({ title: '跟踪 FX 定金,PDA 银行保函进展', domain: '客户与销售', type: '长期跟进', relatedPerson: ['p-islam'], dueDate: '2026-04-29', priority: 'P0' }),
    mk({ title: '哥伦比亚 Luis 报价单', domain: '客户与销售', type: '长期跟进', relatedPerson: ['p-luis'], dueDate: '2026-04-29' }),
    mk({ title: '定南美返程机票', domain: '客户与销售', type: '出差子任务', dueDate: '2026-04-29', priority: 'P0' }),
    mk({ title: '安排 V-ZDB 图纸 6×8 尺', domain: '客户与销售', type: '单点', dueDate: '2026-04-30' }),
    mk({ title: '下午 3点 Yasser 开会', domain: '客户与销售', type: '单点', relatedPerson: ['p-yasser'], dueDate: '2026-04-30' }),
    mk({ title: '约墨西哥 Oscar 拜访,整理所有拜访客户', domain: '客户与销售', type: '长期跟进', relatedPerson: ['p-oscar'], dueDate: '2026-05-01' }),

    // === 节奏-频率型(预置)===
    mk({
      title: '招聘 · 找人才', domain: '内部与系统', type: '节奏-频率型',
      frequencyPeriod: '每周', overdueMultiplier: 1.5,
      lastDoneAt: addDays(t, -5),
    }),
    mk({
      title: '外贸通压机客户开发(轮换发不同压机+浸胶线广告)',
      domain: '客户与销售', type: '节奏-频率型',
      frequencyPeriod: '每周', overdueMultiplier: 1.5,
      lastDoneAt: addDays(t, -8),
    }),

    // === 节奏-日期型(预置)===
    mk({
      title: '材料组周会复盘上周+本周计划', domain: '内部与系统', type: '节奏-日期型',
      datePattern: '每周某日', weekday: 1, timeOfDay: '10:00', autoVideoOnTrip: true,
    }),
    mk({
      title: '设备组销售会议', domain: '内部与系统', type: '节奏-日期型',
      datePattern: '每周某日', weekday: 6, timeOfDay: '10:00', autoVideoOnTrip: true,
    }),
    mk({
      title: '检查员工月度考核表', domain: '内部与系统', type: '节奏-日期型',
      datePattern: '每月某日', monthDay: 5,
    }),
    mk({
      title: '检查财务报表', domain: '内部与系统', type: '节奏-日期型',
      datePattern: '每月某日', monthDay: 28,
    }),
    mk({
      title: '销售业绩复盘会', domain: '内部与系统', type: '节奏-日期型',
      datePattern: '每季末',
    }),
  ];
}

function seedTemplates() {
  return [
    {
      id: 'tpl-intl-standard', name: '国际客户拜访 · 标准', isBuiltIn: true,
      tasks: [
        { title: '申请签证', stage: '出行准备', daysBeforeDeparture: 60, alertLevel: '普通' },
        { title: '定机票【便宜价窗口】', stage: '出行准备', daysBeforeDeparture: 30, alertLevel: '琥珀提醒' },
        { title: '定机票【最后窗口】', stage: '出行准备', daysBeforeDeparture: 20, alertLevel: '红色警告' },
        { title: '定酒店', stage: '出行准备', daysBeforeDeparture: 14, alertLevel: '普通' },
        { title: '准备宣传册 + 压机样板', stage: '出行准备', daysBeforeDeparture: 10, alertLevel: '普通' },
        { title: '客户礼物', stage: '出行准备', daysBeforeDeparture: 7, alertLevel: '普通' },
        { title: '备份电脑本地盘数据到移动硬盘(防出差中电脑丢失)', stage: '出行准备', daysBeforeDeparture: 1, alertLevel: '琥珀提醒' },
        { title: '打印行程单、确认接机', stage: '出行准备', daysBeforeDeparture: 2, alertLevel: '普通' },
        { title: '整理拜访客户清单', stage: '客户排期', daysBeforeDeparture: 14, alertLevel: '普通' },
        { title: '联系并确认每位客户拜访时间', stage: '客户排期', daysBeforeDeparture: 10, alertLevel: '普通' },
        { title: '准备每位客户的针对性资料', stage: '客户排期', daysBeforeDeparture: 7, alertLevel: '普通' },
        { title: '客户档案录入 + 名片扫描入库', stage: '行程后跟进', daysBeforeDeparture: -3, alertLevel: '普通' },
        { title: '报价跟进表更新', stage: '行程后跟进', daysBeforeDeparture: -7, alertLevel: '普通' },
      ],
    },
    {
      id: 'tpl-expo', name: '展会出差(含布展)', isBuiltIn: true,
      tasks: [
        { title: '申请签证', stage: '出行准备', daysBeforeDeparture: 60, alertLevel: '普通' },
        { title: '定酒店【展馆附近窗口】', stage: '出行准备', daysBeforeDeparture: 45, alertLevel: '琥珀提醒' },
        { title: '定酒店【最后窗口】', stage: '出行准备', daysBeforeDeparture: 30, alertLevel: '红色警告' },
        { title: '定机票【便宜价窗口】', stage: '出行准备', daysBeforeDeparture: 30, alertLevel: '琥珀提醒' },
        { title: '确认参展资料(展位号、布展物料)', stage: '出行准备', daysBeforeDeparture: 30, alertLevel: '普通' },
        { title: '定机票【最后窗口】', stage: '出行准备', daysBeforeDeparture: 20, alertLevel: '红色警告' },
        { title: '寄送展品/样板', stage: '出行准备', daysBeforeDeparture: 21, alertLevel: '普通' },
        { title: '准备宣传册 + 样品', stage: '出行准备', daysBeforeDeparture: 10, alertLevel: '普通' },
        { title: '备份电脑本地盘数据到移动硬盘(防出差中电脑丢失)', stage: '出行准备', daysBeforeDeparture: 1, alertLevel: '琥珀提醒' },
        { title: '提前布展', stage: '出行准备', daysBeforeDeparture: 1, alertLevel: '普通' },
        { title: '展会名片扫描入库', stage: '行程后跟进', daysBeforeDeparture: -3, alertLevel: '普通' },
        { title: '整理展会潜在客户清单 + 分配跟进', stage: '行程后跟进', daysBeforeDeparture: -7, alertLevel: '普通' },
      ],
    },
    {
      id: 'tpl-domestic', name: '国内出差(简化)', isBuiltIn: true,
      tasks: [
        { title: '定机票/高铁票', stage: '出行准备', daysBeforeDeparture: 14, alertLevel: '普通' },
        { title: '定酒店', stage: '出行准备', daysBeforeDeparture: 7, alertLevel: '普通' },
        { title: '准备资料', stage: '出行准备', daysBeforeDeparture: 3, alertLevel: '普通' },
        { title: '备份电脑本地盘数据到移动硬盘(防出差中电脑丢失)', stage: '出行准备', daysBeforeDeparture: 1, alertLevel: '琥珀提醒' },
        { title: '确认拜访清单', stage: '客户排期', daysBeforeDeparture: 7, alertLevel: '普通' },
        { title: '客户档案更新', stage: '行程后跟进', daysBeforeDeparture: -3, alertLevel: '普通' },
      ],
    },
  ];
}

/* ---------------------------------------------------------------------
 * 3. 数据状态管理
 * ------------------------------------------------------------------ */
const State = {
  tasks: [],
  persons: [],
  trips: [],
  templates: [],
  ui: { tab: 'today', peopleFilter: 'all', rhythmTab: 'frequency' },
};

function initData() {
  const meta = Store.load(KEY.meta, null);
  if (!meta || !meta.seeded) {
    State.persons = seedPersons();
    State.tasks = seedTasks();
    State.templates = seedTemplates();
    State.trips = [];
    Store.save(KEY.persons, State.persons);
    Store.save(KEY.tasks, State.tasks);
    Store.save(KEY.templates, State.templates);
    Store.save(KEY.trips, State.trips);
    Store.save(KEY.meta, { seeded: true, seededAt: new Date().toISOString(), version: '1.0' });
  } else {
    State.persons = Store.load(KEY.persons, []);
    State.tasks = Store.load(KEY.tasks, []);
    State.templates = Store.load(KEY.templates, seedTemplates());
    State.trips = Store.load(KEY.trips, []);
  }
  // 自动生成日期型任务的当日实例
  generateDateBasedInstances();
  // 软迁移:为老用户的出差模板自动补上"备份数据"任务
  migrateTripTemplates();
}

/**
 * 软迁移:把"备份电脑本地盘数据到移动硬盘"任务自动加进所有出差模板
 * 旧用户的模板没有这条 → 检测后自动追加 → 持久化(同步到云端)
 */
function migrateTripTemplates() {
  let changed = false;
  const backupTaskPattern = /备份电脑本地盘/;
  for (const tpl of State.templates) {
    if (!tpl.tasks.some(t => backupTaskPattern.test(t.title))) {
      tpl.tasks.push({
        title: '备份电脑本地盘数据到移动硬盘(防出差中电脑丢失)',
        stage: '出行准备',
        daysBeforeDeparture: 1,
        alertLevel: '琥珀提醒',
      });
      changed = true;
    }
  }
  if (changed) {
    persistTemplates();
    console.info('[Migrate] 已为现有出差模板补上"备份数据"任务');
  }
}

/* 持久化 + Firebase 同步 */
const _syncSnapshot = { tasks: null, persons: null, trips: null, templates: null };

function captureSyncSnapshot() {
  for (const k of ['tasks', 'persons', 'trips', 'templates']) {
    _syncSnapshot[k] = JSON.stringify(State[k]);
  }
}

function _syncToFirebase(stateKey) {
  const fb = window.AmandaFirebase;
  if (!fb || !fb.ready || fb.applyingRemote || !fb._firstSyncDone) return;

  const newItems = State[stateKey];
  const newStr = JSON.stringify(newItems);
  if (_syncSnapshot[stateKey] === newStr) return;

  const oldItems = _syncSnapshot[stateKey] ? JSON.parse(_syncSnapshot[stateKey]) : [];
  const newIds = new Set(newItems.map(i => i.id));

  // 新增/修改
  for (const item of newItems) {
    const old = oldItems.find(o => o.id === item.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(item)) {
      fb.pushItem(stateKey, item);
    }
  }
  // 删除
  for (const old of oldItems) {
    if (!newIds.has(old.id)) fb.deleteItem(stateKey, old.id);
  }

  _syncSnapshot[stateKey] = newStr;
}

function persistTasks() { Store.save(KEY.tasks, State.tasks); _syncToFirebase('tasks'); }
function persistPersons() { Store.save(KEY.persons, State.persons); _syncToFirebase('persons'); }
function persistTrips() { Store.save(KEY.trips, State.trips); _syncToFirebase('trips'); }
function persistTemplates() { Store.save(KEY.templates, State.templates); _syncToFirebase('templates'); }

/* ---------------------------------------------------------------------
 * 4. 业务逻辑工具
 * ------------------------------------------------------------------ */
function isOverdue(task) {
  return task.dueDate && task.status !== '已完成' && new Date(task.dueDate) < new Date(todayISO());
}
function isToday(task) {
  return task.dueDate === todayISO() && task.status !== '已完成';
}
function isTodayOrOverdue(task) {
  return task.status !== '已完成' && task.dueDate && new Date(task.dueDate) <= new Date(todayISO());
}
function getOverdueDays(task) {
  if (!isOverdue(task)) return 0;
  return Math.abs(daysBetween(task.dueDate, todayISO()));
}
function getPersonById(id) { return State.persons.find(p => p.id === id); }
function getPersonName(id) { const p = getPersonById(id); return p ? p.name : '?'; }

const DOMAIN_COLOR = {
  '客户与销售': '#7C3AED',  // 紫色
  '内部与系统': '#0891B2',  // 青色
  '家庭与个人': '#1D9E75',  // 绿色
};
const DOMAIN_BG = {
  '客户与销售': '#F3EBFF',  // 浅紫
  '内部与系统': '#E0F7FA',  // 浅青
  '家庭与个人': '#E1F5EE',  // 浅绿
};
const DOMAINS = ['客户与销售', '内部与系统', '家庭与个人'];

function periodToDays(period, custom) {
  return ({ '每周': 7, '每月': 30, '每季': 90 })[period] || custom || 7;
}
function rhythmDaysSinceLast(task) {
  if (!task.lastDoneAt) return periodToDays(task.frequencyPeriod, task.frequencyCustomDays) * 2;
  return daysBetween(task.lastDoneAt, todayISO());
}
function rhythmStatus(task) {
  const period = periodToDays(task.frequencyPeriod, task.frequencyCustomDays);
  const mult = task.overdueMultiplier || 1.5;
  const days = rhythmDaysSinceLast(task);
  if (days >= period * mult) return { level: 'red', label: '立刻安排', days };
  if (days >= period) return { level: 'amber', label: '本周内', days };
  return { level: 'green', label: '节奏正常', days };
}

/* 判断节奏-日期型任务今天是否应触发 */
function dateBasedTriggersToday(task) {
  const today = new Date(todayISO());
  if (task.datePattern === '每周某日') return today.getDay() === task.weekday;
  if (task.datePattern === '每月某日') return today.getDate() === task.monthDay;
  if (task.datePattern === '每季末') {
    const m = today.getMonth(); // 0-11
    if (![2, 5, 8, 11].includes(m)) return false;
    const next = new Date(today.getFullYear(), m + 1, 0);
    return today.getDate() === next.getDate();
  }
  return false;
}

/* 为日期型任务生成今日实例(临时写入 today 字段标记) */
function generateDateBasedInstances() {
  // 这里不创建新任务,而是在渲染时根据 datePattern 判断;
  // 若需要历史完成记录,可扩展 progressHistory。简化处理:
  // 给今日触发的日期型任务一个 dueDate=今天 的临时标记,不持久化。
  State.tasks.forEach(t => {
    if (t.type === '节奏-日期型' && dateBasedTriggersToday(t)) {
      // 仅当任务未完成或上次完成不是今天
      if (!t.lastDoneAt || daysBetween(t.lastDoneAt, todayISO()) !== 0) {
        t._instanceDueToday = true;
      }
    }
  });
}

/* 出差期间会议自动改视频 */
function isDuringActiveTrip(dateStr) {
  return State.trips.find(trip => {
    if (trip.status === '已完成') return false;
    if (!trip.autoVideoMeeting) return false;
    return new Date(dateStr) >= new Date(trip.departureDate) &&
           new Date(dateStr) <= new Date(trip.returnDate);
  });
}
function decorateForVideo(task) {
  if (task.type === '节奏-日期型' && task.autoVideoOnTrip) {
    if (isDuringActiveTrip(todayISO())) {
      return { ...task, _videoBadge: true, _decoratedTitle: '📹 视频会议:' + task.title };
    }
  }
  return task;
}

/* ---------------------------------------------------------------------
 * 5. 视图:今日
 * ------------------------------------------------------------------ */
function renderToday() {
  const stats = $('#stats-row');
  const root = $('#today-content');

  const overdue = State.tasks.filter(isOverdue);
  const todayTasks = State.tasks.filter(t =>
    !isOverdue(t) && (isToday(t) || (t.type === '节奏-日期型' && t._instanceDueToday))
  );
  const waiting = State.tasks.filter(t => t.status === '等他人');
  const done = State.tasks.filter(t => t.status === '已完成' &&
    t.completedAt && t.completedAt.slice(0, 10) === todayISO());

  // 顶部数字卡
  stats.innerHTML = `
    <div class="stat stat-overdue ${overdue.length ? 'on' : ''}">
      <div class="stat-num">${overdue.length}</div><div class="stat-label">超期</div>
    </div>
    <div class="stat stat-today">
      <div class="stat-num">${todayTasks.length}</div><div class="stat-label">今日</div>
    </div>
    <div class="stat stat-waiting ${waiting.length ? 'on' : ''}">
      <div class="stat-num">${waiting.length}</div><div class="stat-label">等他人</div>
    </div>
    <div class="stat stat-done">
      <div class="stat-num">${done.length}</div><div class="stat-label">已完成</div>
    </div>`;

  let html = '';

  // 超期区(红色置顶,永不消失)
  if (overdue.length) {
    html += `<div class="section section-overdue">
      <div class="section-bar bar-red"></div>
      <div class="section-head">
        <span class="section-title">超期 · 不会自动消失</span>
        <span class="section-count">${overdue.length}</span>
      </div>
      <div class="section-body">
        ${overdue.sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate))
          .map(t => taskCard(t, { overdue: true })).join('')}
      </div>
    </div>`;
  }

  // 三个领域分组(浅色背景"面板" + 深色分割线)
  for (const d of DOMAINS) {
    const items = todayTasks.filter(t => t.domain === d);
    if (!items.length) continue;
    html += `<div class="section section-domain" style="background:${DOMAIN_BG[d]}">
      <div class="section-bar" style="background:${DOMAIN_COLOR[d]}"></div>
      <div class="section-head">
        <span class="section-title">${d}</span>
        <span class="section-count">${items.length}</span>
      </div>
      <div class="section-body">
        ${items.map(x => taskCard(decorateForVideo(x))).join('')}
      </div>
    </div>`;
  }

  // 空状态
  if (!overdue.length && !todayTasks.length) {
    html = `<div class="empty">
      <div class="empty-emoji">☀</div>
      <div class="empty-title">今天没有待办</div>
      <div class="empty-sub">点击右下角 + 新建任务</div>
    </div>`;
  }

  root.innerHTML = html;
  bindTaskCardEvents(root);
  updateBadges();
}
function decorateDomain(d) { return d; }

/* ---------------------------------------------------------------------
 * 6. 视图:本周
 * ------------------------------------------------------------------ */
function renderWeek() {
  const root = $('#week-content');
  const today = new Date(todayISO());
  const dow = today.getDay(); // 0=周日
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dow + 6) % 7));

  let html = `<div class="week-list">`;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const items = State.tasks.filter(t => t.dueDate === iso && t.status !== '已完成');
    const isPast = iso < todayISO();
    const isToday = iso === todayISO();
    const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    html += `<div class="week-day ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''}">
      <div class="week-day-head">
        <span class="wd-label">${labels[i]}</span>
        <span class="wd-date">${d.getMonth()+1}/${d.getDate()}</span>
        <span class="wd-count">${items.length} 项</span>
      </div>
      <div class="week-day-body">
        ${items.map(t => taskCard(t, { compact: true })).join('') ||
          '<div class="muted small">无任务</div>'}
      </div>
    </div>`;
  }
  html += `</div>`;
  root.innerHTML = html;
  bindTaskCardEvents(root);
}

/* ---------------------------------------------------------------------
 * 7. 视图:按人
 * ------------------------------------------------------------------ */
function renderPeople() {
  const root = $('#people-content');
  const filter = State.ui.peopleFilter;

  // 给每个人聚合任务(仅保留 overdueCount 用于"有逾期"筛选,不再用作排序/视觉强调)
  const cards = State.persons.map(p => {
    const tasks = State.tasks.filter(t =>
      t.relatedPerson?.includes(p.id) && t.status !== '已完成');
    const overdueCount = tasks.filter(isOverdue).length;
    const lastProgress = tasks
      .flatMap(t => (t.progressHistory || []).map(h => h.date))
      .sort().pop();
    const daysSince = lastProgress ? daysBetween(lastProgress, todayISO()) : 9999;
    return { person: p, tasks, overdueCount, daysSince };
  });

  // 过滤
  let filtered = cards;
  if (filter === 'customer') filtered = cards.filter(c => c.person.type === '客户');
  if (filter === 'team') filtered = cards.filter(c => c.person.type === '团队');
  if (filter === 'overdue') filtered = cards.filter(c => c.overdueCount > 0);

  // 排序:重要客户 → 久没动(不再因有逾期而置顶,逾期专属今日视图)
  filtered.sort((a, b) => {
    const ia = a.person.importance === '重要客户' ? 1 : 0;
    const ib = b.person.importance === '重要客户' ? 1 : 0;
    if (ia !== ib) return ib - ia;
    return b.daysSince - a.daysSince;
  });

  // 至少展示有任务的人;无任务的折叠在下方
  const hasTasks = filtered.filter(c => c.tasks.length > 0);
  const noTasks = filtered.filter(c => c.tasks.length === 0);

  // 未关联人任务
  const unlinked = State.tasks.filter(t =>
    (!t.relatedPerson || t.relatedPerson.length === 0) && t.status !== '已完成');

  let html = '';
  for (const c of hasTasks) html += personCard(c);

  if (filter === 'all' || filter === 'overdue') {
    if (unlinked.length) {
      html += `<div class="unlinked-divider"></div>
        <div class="section">
          <div class="section-head">
            <span class="section-title">未关联人 / 系统任务</span>
            <span class="section-count">${unlinked.length}</span>
          </div>
          <div class="section-body">
            ${unlinked.map(t => taskCard(t, { compact: true })).join('')}
          </div>
        </div>`;
    }
  }

  if (noTasks.length && filter === 'all') {
    html += `<details class="people-empty">
      <summary>暂无任务的相关人 (${noTasks.length})</summary>
      <div class="people-empty-list">
        ${noTasks.map(c => `<span class="person-pill">${escapeHtml(c.person.name)}</span>`).join('')}
      </div>
    </details>`;
  }

  if (!html) html = `<div class="empty">该筛选下没有任务</div>`;
  root.innerHTML = html;
  bindTaskCardEvents(root);
}

function personCard({ person, tasks, overdueCount, daysSince }) {
  const tagText = [person.country, person.importance, person.note]
    .filter(Boolean).join(' · ');
  // 不再因有逾期而加红边/红徽章 — 逾期视觉只保留在今日视图
  return `<div class="person-card" data-pid="${person.id}">
    <div class="person-head">
      <div class="person-avatar">${escapeHtml(person.name.slice(0,1))}</div>
      <div class="person-info">
        <div class="person-name">${escapeHtml(person.name)}${person.company ? ` <span class="muted small">(${escapeHtml(person.company)})</span>` : ''}</div>
        <div class="person-tag muted small">${escapeHtml(tagText) || '—'}</div>
      </div>
      <div class="person-badge">${tasks.length} 项</div>
    </div>
    <div class="person-tasks">
      ${tasks.map(t => taskCard(t, { compact: true })).join('')}
    </div>
  </div>`;
}

/* ---------------------------------------------------------------------
 * 8. 视图:节奏
 * ------------------------------------------------------------------ */
function renderRhythm() {
  const root = $('#rhythm-content');
  const sub = State.ui.rhythmTab;
  if (sub === 'frequency') {
    const items = State.tasks
      .filter(t => t.type === '节奏-频率型')
      .map(t => ({ ...t, _rhythm: rhythmStatus(t) }))
      .sort((a, b) => b._rhythm.days - a._rhythm.days);

    let html = `<div class="rhythm-toolbar">
      <button class="btn btn-primary btn-small" data-act="new-rhythm-freq">+ 新增频率任务</button>
    </div>`;
    if (!items.length) html += `<div class="empty">暂无频率型节奏任务</div>`;
    else html += items.map(rhythmFreqCard).join('');
    root.innerHTML = html;
  } else {
    const items = State.tasks
      .filter(t => t.type === '节奏-日期型');
    const groups = {
      '每周固定': items.filter(t => t.datePattern === '每周某日'),
      '每月固定': items.filter(t => t.datePattern === '每月某日'),
      '每季固定': items.filter(t => t.datePattern === '每季末'),
    };
    let html = `<div class="rhythm-toolbar">
      <button class="btn btn-primary btn-small" data-act="new-rhythm-date">+ 新增日期任务</button>
    </div>`;
    for (const [g, list] of Object.entries(groups)) {
      if (!list.length) continue;
      html += `<div class="section">
        <div class="section-head">
          <span class="section-title">${g}</span>
          <span class="section-count">${list.length}</span>
        </div>
        <div class="section-body">${list.map(rhythmDateCard).join('')}</div>
      </div>`;
    }
    if (!Object.values(groups).some(l => l.length)) html += `<div class="empty">暂无日期型节奏任务</div>`;
    root.innerHTML = html;
  }
  bindTaskCardEvents(root);
  $$('[data-act="new-rhythm-freq"]', root).forEach(b => b.onclick = () => openTaskModal(null, { type: '节奏-频率型' }));
  $$('[data-act="new-rhythm-date"]', root).forEach(b => b.onclick = () => openTaskModal(null, { type: '节奏-日期型' }));
}

function rhythmFreqCard(t) {
  const cls = t._rhythm.level;
  return `<div class="card task-card rhythm-card rhythm-${cls}" data-tid="${t.id}">
    <div class="task-row">
      <span class="task-title">${escapeHtml(t.title)}</span>
      <span class="task-period">${escapeHtml(t.frequencyPeriod || '自定义')}</span>
    </div>
    <div class="task-row">
      <span class="rhythm-label">已 ${t._rhythm.days} 天没做 · ${t._rhythm.label}</span>
      <button class="btn btn-mini" data-act="rhythm-done">完成一次</button>
    </div>
  </div>`;
}
function rhythmDateCard(t) {
  let next = '—';
  if (t.datePattern === '每周某日') {
    const wd = ['周日','周一','周二','周三','周四','周五','周六'][t.weekday];
    next = `每${wd} ${t.timeOfDay || ''}`;
  } else if (t.datePattern === '每月某日') {
    next = `每月 ${t.monthDay} 号`;
  } else if (t.datePattern === '每季末') {
    next = '每季最后一天';
  }
  return `<div class="card task-card" data-tid="${t.id}">
    <div class="task-row">
      <span class="task-title">${escapeHtml(t.title)}</span>
      ${t.autoVideoOnTrip ? '<span class="badge-video">📹 出差视频</span>' : ''}
    </div>
    <div class="task-row muted small">${next}</div>
  </div>`;
}

/* ---------------------------------------------------------------------
 * 9. 视图:出差
 * ------------------------------------------------------------------ */
function renderTrip() {
  const root = $('#trip-content');
  const trips = [...State.trips].sort((a, b) => {
    const order = { '进行中': 0, '待启动': 1, '已完成': 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return new Date(b.departureDate) - new Date(a.departureDate);
  });

  let html = `<div class="trip-toolbar">
    <button class="btn btn-primary" data-act="new-trip">+ 新建出差</button>
    <button class="btn btn-ghost btn-small" data-act="manage-templates">管理模板</button>
  </div>`;

  if (!trips.length) {
    html += `<div class="empty">
      <div class="empty-emoji">✈</div>
      <div class="empty-title">还没有出差行程</div>
      <div class="empty-sub">点击 + 新建出差,系统按出发日期自动倒推所有提醒</div>
    </div>`;
  } else {
    html += trips.map(tripCard).join('');
  }
  root.innerHTML = html;

  $('[data-act="new-trip"]')?.addEventListener('click', () => openTripModal());
  $('[data-act="manage-templates"]')?.addEventListener('click', () => openTemplateManager());
  $$('.trip-card', root).forEach(el => {
    el.addEventListener('click', () => openTripDetail(el.dataset.tripId));
  });
}

function tripCard(trip) {
  const tasks = State.tasks.filter(t => t.linkedTripId === trip.id);
  const done = tasks.filter(t => t.status === '已完成').length;
  const total = tasks.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const stages = ['出行准备', '客户排期', '行程后跟进'];
  const byStage = stages.map(s => ({
    stage: s,
    items: tasks.filter(t => t._tripStage === s),
  }));

  return `<div class="card trip-card" data-trip-id="${trip.id}">
    <div class="trip-card-head">
      <div>
        <div class="trip-name">${escapeHtml(trip.name)}</div>
        <div class="muted small">${fmtDate(trip.departureDate)} – ${fmtDate(trip.returnDate)} · ${escapeHtml(trip.destination)}</div>
      </div>
      <span class="trip-status status-${trip.status === '进行中' ? 'on' : trip.status === '已完成' ? 'done' : 'pending'}">${trip.status}</span>
    </div>
    <div class="trip-progress">
      <div class="trip-progress-bar"><div style="width:${pct}%"></div></div>
      <span class="muted small">${done} / ${total}</span>
    </div>
    ${byStage.filter(s => s.items.length).map(s => `
      <div class="trip-stage">
        <div class="trip-stage-name">${s.stage}</div>
        ${s.items.slice(0, 4).map(it => `
          <div class="trip-task-line ${it.status==='已完成'?'done':''}">
            <span class="check">${it.status==='已完成'?'✓':'○'}</span>
            <span class="text">${escapeHtml(it.title)}</span>
          </div>`).join('')}
        ${s.items.length > 4 ? `<div class="muted small">还有 ${s.items.length - 4} 条…</div>` : ''}
      </div>`).join('')}
  </div>`;
}

function openTripModal(existing) {
  const t = existing || {
    name: '', destination: '', departureDate: '', returnDate: '',
    templateId: 'tpl-intl-standard', autoVideoMeeting: true,
  };
  const tplOptions = State.templates.map(tp =>
    `<option value="${tp.id}" ${tp.id === t.templateId ? 'selected' : ''}>${escapeHtml(tp.name)}</option>`).join('');

  openModal({
    title: existing ? '编辑出差' : '新建出差',
    body: `
      <label>行程名<input id="trip-name" value="${escapeHtml(t.name)}" placeholder="如:南美客户拜访行"></label>
      <label>目的地<input id="trip-dest" value="${escapeHtml(t.destination)}" placeholder="国家/城市"></label>
      <div class="row">
        <label class="flex1">出发日期<input id="trip-dep" type="date" value="${t.departureDate}"></label>
        <label class="flex1">返程日期<input id="trip-ret" type="date" value="${t.returnDate}"></label>
      </div>
      <label>套用模板<select id="trip-tpl">${tplOptions}</select></label>
      <label class="check-row">
        <input type="checkbox" id="trip-video" ${t.autoVideoMeeting ? 'checked' : ''}>
        出差期间会议自动改视频
      </label>
      <div class="muted small">保存后系统按出发日期自动倒推派生任务。</div>`,
    actions: [
      { label: '取消', onClick: closeModal },
      { label: '保存并派生任务', primary: true, onClick: () => {
        const trip = existing ? { ...existing } : { id: uuid(), status: '待启动', relatedTaskIds: [] };
        trip.name = $('#trip-name').value.trim();
        trip.destination = $('#trip-dest').value.trim();
        trip.departureDate = $('#trip-dep').value;
        trip.returnDate = $('#trip-ret').value;
        trip.templateId = $('#trip-tpl').value;
        trip.autoVideoMeeting = $('#trip-video').checked;
        if (!trip.name || !trip.departureDate || !trip.returnDate) {
          toast('请填写名称与日期'); return;
        }
        if (existing) {
          // 简化:删除旧的派生任务,重新派生
          State.tasks = State.tasks.filter(x => x.linkedTripId !== trip.id);
          const idx = State.trips.findIndex(x => x.id === trip.id);
          if (idx >= 0) State.trips[idx] = trip;
        } else {
          State.trips.push(trip);
        }
        deriveTripTasks(trip);
        persistTrips(); persistTasks();
        closeModal();
        renderAll();
        toast('行程已保存,任务已派生');
      }},
    ],
  });
}

function deriveTripTasks(trip) {
  const tpl = State.templates.find(x => x.id === trip.templateId);
  if (!tpl) return;
  const today = todayISO();
  const newTasks = tpl.tasks.map(item => {
    let dueDate;
    if (item.daysBeforeDeparture >= 0) dueDate = addDays(trip.departureDate, -item.daysBeforeDeparture);
    else dueDate = addDays(trip.returnDate, -item.daysBeforeDeparture);
    return {
      id: uuid(),
      title: item.title,
      domain: '客户与销售',
      type: '出差子任务',
      priority: item.alertLevel === '红色警告' ? 'P0'
              : item.alertLevel === '琥珀提醒' ? 'P1' : 'P2',
      status: '进行中',
      relatedPerson: [],
      dueDate,
      createdAt: new Date().toISOString(),
      postponeCount: 0,
      postponeHistory: [],
      progressHistory: [{ date: today, type: '创建', content: `从模板「${tpl.name}」派生` }],
      linkedTripId: trip.id,
      _tripStage: item.stage,
      _alertLevel: item.alertLevel,
    };
  });
  State.tasks.push(...newTasks);
  trip.relatedTaskIds = newTasks.map(t => t.id);
}

function openTripDetail(tripId) {
  const trip = State.trips.find(x => x.id === tripId);
  if (!trip) return;
  const tasks = State.tasks.filter(t => t.linkedTripId === trip.id);
  openModal({
    title: trip.name,
    body: `
      <div class="muted small">${fmtDate(trip.departureDate)} – ${fmtDate(trip.returnDate)} · ${escapeHtml(trip.destination)}</div>
      <div class="trip-actions">
        <button class="btn btn-small" id="trip-edit">编辑</button>
        <button class="btn btn-small btn-danger" id="trip-delete">删除行程</button>
      </div>
      <div class="trip-detail-stages">
        ${['出行准备','客户排期','行程后跟进'].map(stage => {
          const items = tasks.filter(t => t._tripStage === stage);
          if (!items.length) return '';
          return `<div class="trip-stage">
            <div class="trip-stage-name">${stage}</div>
            ${items.map(it => `
              <div class="trip-task-line ${it.status==='已完成'?'done':''}" data-tid="${it.id}">
                <span class="check">${it.status==='已完成'?'✓':'○'}</span>
                <span class="text">${escapeHtml(it.title)}</span>
                <span class="muted small">${fmtDate(it.dueDate)}</span>
              </div>`).join('')}
          </div>`;
        }).join('')}
      </div>`,
    actions: [{ label: '关闭', onClick: closeModal }],
  });
  $('#trip-edit').onclick = () => { closeModal(); openTripModal(trip); };
  $('#trip-delete').onclick = () => {
    if (!confirm(`确定删除行程「${trip.name}」及其所有派生任务?`)) return;
    State.tasks = State.tasks.filter(t => t.linkedTripId !== trip.id);
    State.trips = State.trips.filter(t => t.id !== trip.id);
    persistTasks(); persistTrips();
    closeModal(); renderAll(); toast('已删除');
  };
  $$('.trip-task-line', $('#modal-root')).forEach(line => {
    line.onclick = () => {
      const tid = line.dataset.tid; if (!tid) return;
      closeModal(); openTaskDetail(tid);
    };
  });
}

function openTemplateManager() {
  openModal({
    title: '出差模板',
    body: `<div class="tpl-list">
      ${State.templates.map(tp => `
        <div class="card tpl-card">
          <div class="tpl-name">${escapeHtml(tp.name)}${tp.isBuiltIn?' <span class="muted small">(预置)</span>':''}</div>
          <div class="muted small">${tp.tasks.length} 条任务</div>
        </div>`).join('')}
    </div>
    <div class="muted small">第一版预置 3 个模板,自定义模板编辑功能可在第二版扩展。</div>`,
    actions: [{ label: '关闭', onClick: closeModal }],
  });
}

/* ---------------------------------------------------------------------
 * 10. 任务卡片(共用组件)
 * ------------------------------------------------------------------ */
function taskCard(t, opt = {}) {
  // 超期红色样式只在显式开启时应用(目前仅"今日"视图的超期区会传入 overdue:true)
  const overdue = opt.overdue === true;
  const overdueDays = overdue ? getOverdueDays(t) : 0;
  const personLabels = (t.relatedPerson || []).map(getPersonName).slice(0, 3).join(', ');
  const typeBadge = t.type && t.type !== '单点' ? `<span class="task-type">${escapeHtml(t.type)}</span>` : '';
  const priBadge = t.priority === 'P0' ? '<span class="pri pri-p0">P0</span>' :
                   t.priority === 'P1' ? '' : '<span class="pri pri-p2">P2</span>';
  const titleShown = t._decoratedTitle || t.title;
  const klass = ['task-card', overdue && 'is-overdue', opt.compact && 'compact'].filter(Boolean).join(' ');
  const domainBar = !overdue && !opt.compact && t.domain ?
    `<span class="task-domain-dot" style="background:${DOMAIN_COLOR[t.domain]||'#ccc'}"></span>` : '';

  return `<div class="card ${klass}" data-tid="${t.id}">
    <button class="task-check" data-act="complete" aria-label="完成">
      ${t.status === '已完成' ? '✓' : ''}
    </button>
    <div class="task-body">
      <div class="task-row">
        ${domainBar}
        <span class="task-title">${escapeHtml(titleShown)}</span>
        ${priBadge}
      </div>
      <div class="task-meta">
        ${typeBadge}
        ${personLabels ? `<span class="task-person">${escapeHtml(personLabels)}</span>` : ''}
        ${t.dueDate ? `<span class="task-due">${fmtDate(t.dueDate)}</span>` : ''}
        ${overdue ? `<span class="task-overdue">逾期 ${overdueDays} 天</span>` : ''}
        ${t._videoBadge ? '<span class="badge-video">📹</span>' : ''}
      </div>
    </div>
    ${overdue ? `<button class="btn-postpone" data-act="postpone">延期</button>` : ''}
  </div>`;
}

function bindTaskCardEvents(root) {
  $$('.task-card', root).forEach(card => {
    const tid = card.dataset.tid;
    if (!tid) return;
    card.querySelector('[data-act="complete"]')?.addEventListener('click', e => {
      e.stopPropagation();
      completeTask(tid);
    });
    card.querySelector('[data-act="postpone"]')?.addEventListener('click', e => {
      e.stopPropagation();
      openPostponeMenu(tid);
    });
    card.querySelector('[data-act="rhythm-done"]')?.addEventListener('click', e => {
      e.stopPropagation();
      markRhythmDone(tid);
    });
    card.addEventListener('click', () => openTaskDetail(tid));
  });
}

/* ---------------------------------------------------------------------
 * 11. 任务操作
 * ------------------------------------------------------------------ */
function completeTask(tid) {
  const t = State.tasks.find(x => x.id === tid);
  if (!t) return;
  if (t.type === '节奏-频率型') return markRhythmDone(tid);
  t.status = '已完成';
  t.completedAt = new Date().toISOString();
  (t.progressHistory ||= []).push({ date: todayISO(), type: '推进', content: '标记完成' });
  persistTasks();
  renderAll();
  toast('已完成 ✓');
}

function markRhythmDone(tid) {
  const t = State.tasks.find(x => x.id === tid);
  if (!t) return;
  t.lastDoneAt = todayISO();
  (t.progressHistory ||= []).push({ date: todayISO(), type: '推进', content: '完成一次,周期重置' });
  persistTasks();
  renderAll();
  toast('已记录,周期重置');
}

function openPostponeMenu(tid) {
  const t = State.tasks.find(x => x.id === tid);
  if (!t) return;
  const today = todayISO();
  const choices = [
    { label: '明天', date: addDays(today, 1) },
    { label: '3 天后', date: addDays(today, 3) },
    { label: '下周一', date: nextMonday() },
    { label: '自定义…', date: '__custom' },
  ];
  openModal({
    title: '延期到…',
    body: `<div class="postpone-list">
      ${choices.map((c, i) => `<button class="btn btn-block" data-i="${i}">${c.label}${c.date && c.date !== '__custom' ? ` <span class="muted small">${fmtDate(c.date)}</span>` : ''}</button>`).join('')}
    </div>
    <div class="muted small">已延期 ${t.postponeCount || 0} 次${(t.postponeCount||0)>=3?' · 多次延期建议拆分':''}</div>`,
    actions: [{ label: '取消', onClick: closeModal }],
  });
  $$('[data-i]', $('#modal-root')).forEach(b => {
    b.onclick = () => {
      const choice = choices[+b.dataset.i];
      let newDate = choice.date;
      if (newDate === '__custom') {
        newDate = prompt('输入新日期 YYYY-MM-DD', addDays(today, 7));
        if (!newDate) return;
      }
      postponeTask(tid, newDate);
      closeModal();
    };
  });
}

function nextMonday() {
  const d = new Date(todayISO());
  const days = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function postponeTask(tid, newDate) {
  const t = State.tasks.find(x => x.id === tid);
  if (!t) return;
  const old = t.dueDate;
  t.dueDate = newDate;
  t.postponeCount = (t.postponeCount || 0) + 1;
  (t.postponeHistory ||= []).push({ date: todayISO(), fromDate: old, toDate: newDate });
  (t.progressHistory ||= []).push({ date: todayISO(), type: '延期', content: `${old} → ${newDate}` });
  persistTasks();
  renderAll();
  toast(`已延期到 ${fmtDate(newDate)}`);
}

function deleteTask(tid) {
  if (!confirm('确定删除此任务?')) return;
  State.tasks = State.tasks.filter(x => x.id !== tid);
  persistTasks(); renderAll(); toast('已删除');
}

/* ---------------------------------------------------------------------
 * 12. 任务详情页 + 推进历史
 * ------------------------------------------------------------------ */
function openTaskDetail(tid) {
  const t = State.tasks.find(x => x.id === tid);
  if (!t) return;
  const personNames = (t.relatedPerson || []).map(getPersonName).join(', ');
  const overdue = isOverdue(t);
  const history = (t.progressHistory || []).slice().reverse();

  openModal({
    title: t.title,
    body: `
      <div class="task-detail">
        <div class="task-tags">
          ${overdue ? `<span class="tag tag-red">逾期 ${getOverdueDays(t)} 天</span>` : ''}
          <span class="tag" style="background:${DOMAIN_COLOR[t.domain]||'#999'};color:#fff">${t.domain}</span>
          <span class="tag tag-gray">${t.type}</span>
          <span class="tag tag-gray">${t.status}</span>
          <span class="tag tag-gray">${t.priority}</span>
        </div>
        <div class="info-card">
          ${personNames ? `<div><b>关联人</b> · ${escapeHtml(personNames)}</div>` : ''}
          ${t.dueDate ? `<div><b>下次行动</b> · ${fmtDate(t.dueDate)}${overdue?` <span class="text-red">(已逾期 ${getOverdueDays(t)} 天)</span>`:''}</div>` : ''}
          ${(t.postponeCount||0) > 0 ? `<div class="text-amber"><b>已延期</b> ${t.postponeCount} 次${t.postponeCount>=3?' · 建议拆分或重新评估':''}</div>` : ''}
          <div class="muted small">创建于 ${(t.createdAt||'').slice(0,10)}</div>
          ${t.note ? `<div class="task-note">${escapeHtml(t.note)}</div>` : ''}
        </div>

        <div class="history-head">推进历史 · ${history.length} 条</div>
        <div class="history">
          ${history.length ? history.map(h => `
            <div class="history-item">
              <span class="dot dot-${h.type==='推进'?'green':h.type==='延期'?'amber':'gray'}"></span>
              <div class="history-body">
                <div class="history-meta"><b>${escapeHtml(h.type)}</b> · ${escapeHtml(h.date)}</div>
                <div class="history-content">${escapeHtml(h.content||'')}</div>
              </div>
            </div>`).join('') : '<div class="muted">暂无记录</div>'}
        </div>
      </div>`,
    actions: [
      { label: '编辑', onClick: () => { closeModal(); openTaskModal(t); } },
      { label: '删除', danger: true, onClick: () => { closeModal(); deleteTask(tid); } },
      { label: '+ 推进一步', primary: true, onClick: () => promptProgress(tid) },
    ],
    extraButtons: t.status === '已完成' ? [] : [
      { label: '改下次日期', onClick: () => { closeModal(); openPostponeMenu(tid); } },
      ...(overdue ? [{ label: '延期 →', amber: true, onClick: () => { closeModal(); openPostponeMenu(tid); } }] : []),
      { label: '标记完成', green: true, onClick: () => { closeModal(); completeTask(tid); } },
    ],
  });
}

function promptProgress(tid) {
  const t = State.tasks.find(x => x.id === tid);
  if (!t) return;
  const text = prompt('记录本次推进内容(简短描述):');
  if (!text) return;
  (t.progressHistory ||= []).push({ date: todayISO(), type: '推进', content: text });
  persistTasks();
  closeModal();
  toast('已记录推进');
  setTimeout(() => openTaskDetail(tid), 200);
}

/* ---------------------------------------------------------------------
 * 13. 新建/编辑任务弹窗
 * ------------------------------------------------------------------ */
function openTaskModal(existing, defaults = {}) {
  const t = existing || Object.assign({
    title: '', domain: '客户与销售', type: '单点', priority: 'P1',
    status: '进行中', relatedPerson: [], dueDate: todayISO(), note: '',
  }, defaults);

  const isFreq = t.type === '节奏-频率型';
  const isDate = t.type === '节奏-日期型';
  const personOpts = State.persons.map(p =>
    `<label class="person-opt"><input type="checkbox" value="${p.id}" ${t.relatedPerson?.includes(p.id)?'checked':''}> ${escapeHtml(p.name)}<span class="muted small"> ${p.type}</span></label>`).join('');

  openModal({
    title: existing ? '编辑任务' : '新建任务',
    body: `
      <label>任务名 <input id="ti-title" value="${escapeHtml(t.title)}" placeholder="如:给 Yasser 发不同配置价格"></label>
      <div class="row">
        <label class="flex1">领域
          <select id="ti-domain">
            ${DOMAINS.map(d => `<option ${t.domain===d?'selected':''}>${d}</option>`).join('')}
          </select>
        </label>
        <label class="flex1">类型
          <select id="ti-type">
            ${['单点','长期跟进','节奏-频率型','节奏-日期型','出差子任务'].map(x =>
              `<option ${t.type===x?'selected':''}>${x}</option>`).join('')}
          </select>
        </label>
      </div>

      <div id="ti-single-wrap" ${isFreq||isDate?'hidden':''}>
        <label>下次行动日期 <input id="ti-due" type="date" value="${t.dueDate||''}"></label>
      </div>

      <div id="ti-freq-wrap" ${isFreq?'':'hidden'}>
        <label>周期
          <select id="ti-period">
            ${['每周','每月','每季','自定义天数'].map(x =>
              `<option ${t.frequencyPeriod===x?'selected':''}>${x}</option>`).join('')}
          </select>
        </label>
        <label>超期倍数 <input id="ti-mult" type="number" step="0.1" value="${t.overdueMultiplier||1.5}"></label>
      </div>

      <div id="ti-date-wrap" ${isDate?'':'hidden'}>
        <label>日期模式
          <select id="ti-pattern">
            ${['每周某日','每月某日','每季末'].map(x =>
              `<option ${t.datePattern===x?'selected':''}>${x}</option>`).join('')}
          </select>
        </label>
        <label>每周某日 <select id="ti-weekday">
          ${['周日','周一','周二','周三','周四','周五','周六'].map((w,i)=>
            `<option value="${i}" ${t.weekday===i?'selected':''}>${w}</option>`).join('')}
        </select></label>
        <label>每月某日 <input id="ti-monthday" type="number" min="1" max="31" value="${t.monthDay||1}"></label>
        <label>时间 <input id="ti-time" type="time" value="${t.timeOfDay||'10:00'}"></label>
        <label class="check-row">
          <input type="checkbox" id="ti-video" ${t.autoVideoOnTrip?'checked':''}>
          出差期间自动改视频
        </label>
      </div>

      <div class="row">
        <label class="flex1">优先级
          <select id="ti-pri">
            ${['P0','P1','P2'].map(x => `<option ${t.priority===x?'selected':''}>${x}</option>`).join('')}
          </select>
        </label>
        <label class="flex1">状态
          <select id="ti-status">
            ${['进行中','等他人','已搁置','已完成'].map(x => `<option ${t.status===x?'selected':''}>${x}</option>`).join('')}
          </select>
        </label>
      </div>

      <details><summary>关联人(可多选)</summary>
        <div class="person-grid">${personOpts}</div>
      </details>

      <label>备注 <textarea id="ti-note" rows="2">${escapeHtml(t.note||'')}</textarea></label>
    `,
    actions: [
      { label: '取消', onClick: closeModal },
      ...(existing ? [{ label: '删除', danger: true, onClick: () => { closeModal(); deleteTask(t.id); } }] : []),
      { label: '保存', primary: true, onClick: () => saveTaskFromModal(t, !!existing) },
    ],
  });

  // 类型切换显示
  $('#ti-type').addEventListener('change', e => {
    const v = e.target.value;
    $('#ti-single-wrap').hidden = v === '节奏-频率型' || v === '节奏-日期型';
    $('#ti-freq-wrap').hidden = v !== '节奏-频率型';
    $('#ti-date-wrap').hidden = v !== '节奏-日期型';
  });
}

function saveTaskFromModal(orig, isEdit) {
  const t = isEdit ? orig : {
    id: uuid(), createdAt: new Date().toISOString(),
    postponeCount: 0, postponeHistory: [], progressHistory: [],
  };
  t.title = $('#ti-title').value.trim();
  t.domain = $('#ti-domain').value;
  t.type = $('#ti-type').value;
  t.priority = $('#ti-pri').value;
  t.status = $('#ti-status').value;
  t.note = $('#ti-note').value.trim();
  t.relatedPerson = $$('.person-opt input:checked').map(i => i.value);

  if (t.type === '节奏-频率型') {
    t.frequencyPeriod = $('#ti-period').value;
    t.overdueMultiplier = +$('#ti-mult').value || 1.5;
    if (!t.lastDoneAt) t.lastDoneAt = todayISO();
    delete t.dueDate;
  } else if (t.type === '节奏-日期型') {
    t.datePattern = $('#ti-pattern').value;
    t.weekday = +$('#ti-weekday').value;
    t.monthDay = +$('#ti-monthday').value;
    t.timeOfDay = $('#ti-time').value;
    t.autoVideoOnTrip = $('#ti-video').checked;
    delete t.dueDate;
  } else {
    t.dueDate = $('#ti-due').value || null;
  }

  if (!t.title) { toast('请填写任务名'); return; }

  if (!isEdit) {
    (t.progressHistory ||= []).push({ date: todayISO(), type: '创建', content: '手动创建' });
    State.tasks.push(t);
  } else {
    (t.progressHistory ||= []).push({ date: todayISO(), type: '推进', content: '编辑了任务' });
  }
  persistTasks();
  closeModal();
  renderAll();
  toast(isEdit ? '已保存' : '已新建');
}

/* ---------------------------------------------------------------------
 * 14. 模态层(通用)
 * ------------------------------------------------------------------ */
let _modalCloseTimer = null;
function openModal({ title, body, actions = [], extraButtons = [] }) {
  // 取消之前 closeModal 排的延迟清空,防止覆盖刚渲染的内容(链式关→开 bug)
  if (_modalCloseTimer) { clearTimeout(_modalCloseTimer); _modalCloseTimer = null; }
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div class="modal-title">${escapeHtml(title)}</div>
        <button class="modal-close" aria-label="关闭">×</button>
      </div>
      <div class="modal-body">${body}</div>
      ${extraButtons.length ? `<div class="modal-extra">${extraButtons.map((b,i)=>btnHtml(b,'ex'+i)).join('')}</div>` : ''}
      <div class="modal-actions">${actions.map((b,i)=>btnHtml(b,'ac'+i)).join('')}</div>
    </div>`;
  root.classList.add('open');

  $('.modal-close', root).onclick = closeModal;
  $('.modal-backdrop', root).onclick = closeModal;
  actions.forEach((b, i) => $(`#btn-ac${i}`, root).onclick = b.onClick);
  extraButtons.forEach((b, i) => $(`#btn-ex${i}`, root).onclick = b.onClick);
}
function btnHtml(b, id) {
  const cls = ['btn',
    b.primary && 'btn-primary',
    b.danger && 'btn-danger',
    b.amber && 'btn-amber',
    b.green && 'btn-green',
  ].filter(Boolean).join(' ');
  return `<button id="btn-${id}" class="${cls}">${escapeHtml(b.label)}</button>`;
}
function closeModal() {
  const root = $('#modal-root');
  root.classList.remove('open');
  if (_modalCloseTimer) clearTimeout(_modalCloseTimer);
  _modalCloseTimer = setTimeout(() => {
    root.innerHTML = '';
    _modalCloseTimer = null;
  }, 250);
}

/* ---------------------------------------------------------------------
 * 15. 标签页切换 + 顶部问候
 * ------------------------------------------------------------------ */
function switchTab(tab) {
  State.ui.tab = tab;
  $$('.view').forEach(v => v.hidden = v.dataset.view !== tab);
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderCurrentView();
  window.scrollTo(0, 0);
}

function renderCurrentView() {
  const tab = State.ui.tab;
  if (tab === 'today') renderToday();
  else if (tab === 'week') renderWeek();
  else if (tab === 'people') renderPeople();
  else if (tab === 'rhythm') renderRhythm();
  else if (tab === 'trip') renderTrip();
}

function renderAll() {
  generateDateBasedInstances();
  renderCurrentView();
  updateBadges();
}

function updateBadges() {
  const overdue = State.tasks.filter(isOverdue).length;
  const todayN = State.tasks.filter(t => isTodayOrOverdue(t)).length;

  // App内 Tab 徽章
  const badge = $('#badge-today');
  if (todayN > 0) { badge.hidden = false; badge.textContent = todayN; }
  else { badge.hidden = true; }

  // iPhone 主屏图标徽章(iOS 16.4+ PWA Badging API)
  // 需要用户先授权通知;已加到主屏后才会显示
  if ('setAppBadge' in navigator) {
    if (todayN > 0) {
      navigator.setAppBadge(todayN).catch(() => {});
    } else {
      navigator.clearAppBadge().catch(() => {});
    }
  }
}

function renderGreeting() {
  const d = new Date();
  const wd = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
  const h = d.getHours();
  const greet = h < 6 ? '深夜了,早些休息' :
                h < 11 ? '早上好,Amanda' :
                h < 14 ? '中午好,Amanda' :
                h < 18 ? '下午好,Amanda' :
                '晚上好,Amanda';
  $('.date-line').textContent = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${wd}`;
  $('.greet-line').textContent = greet;
}

/* ---------------------------------------------------------------------
 * 16. 设置页(密钥、推送、数据导入/导出)
 * ------------------------------------------------------------------ */
function openSettings() {
  const fbEnabled = window.AmandaFirebase?.ENABLED;
  const fbReady = window.AmandaFirebase?.ready;
  const hasKey = !!Lock.getKey();
  const fbState = !fbEnabled ? '未启用(本地模式)' :
                  fbReady ? '✓ 已连接,数据加密同步中' :
                  hasKey ? '已设密钥但未连接(网络/配置)' : '请输入工作密钥登录';
  const pushState = ('Notification' in window) ?
    (Notification.permission === 'granted' ? '已授权' :
     Notification.permission === 'denied' ? '已拒绝(需在系统设置开启)' : '未授权') : '不支持';

  openModal({
    title: '设置',
    body: `
      <h3>云端同步与加密</h3>
      <div class="muted small">状态:${fbState}</div>
      ${fbEnabled ? `
        <div class="row" style="margin-top:8px">
          ${hasKey
            ? `<button class="btn flex1 btn-danger" id="set-relock">退出登录(清除本机密钥)</button>`
            : `<button class="btn flex1 btn-primary" id="set-login">输入密钥登录</button>`}
        </div>
        ${fbReady ? `<button class="btn btn-block" id="set-refresh" style="margin-top:8px">↻ 立即从云端刷新</button>` : ''}
        <div class="muted small">密钥用 AES-GCM 256位 加密所有数据,Firebase 也看不到内容。换浏览器需要重新输入。</div>
      ` : `
        <div class="muted small">在 firebase-config.js 填入 Firebase 配置并设 ENABLED:true 后,启用云端加密同步。</div>
      `}

      <h3 style="margin-top:18px">通知 & 主屏徽章</h3>
      <div class="muted small">状态:${pushState}</div>
      <button class="btn btn-block" id="set-push">${pushState==='已授权'?'测试通知 + 刷新徽章':'授权通知 + 启用主屏数字徽章'}</button>
      <div class="muted small">授权后:① 主屏图标右上角自动显示今日待办数量(超期+今日,红色徽章);② 后续可接收任务到期提醒。iOS 必须先把 App 添加到主屏并从主屏图标启动。</div>

      <h3 style="margin-top:18px">数据</h3>
      <div class="row">
        <button class="btn flex1" id="set-export">导出 JSON</button>
        <button class="btn flex1" id="set-import">导入 JSON</button>
      </div>
      <button class="btn btn-block btn-danger" id="set-reset" style="margin-top:8px">重置本地数据(重新预填种子)</button>

      <h3 style="margin-top:18px">关于</h3>
      <div class="muted small">v1.0 · 单人个人任务工具 · 数据存于浏览器/Firebase</div>
    `,
    actions: [{ label: '关闭', onClick: closeModal }],
  });

  // 退出登录:清除密钥并刷新触发锁屏
  document.getElementById('set-relock')?.addEventListener('click', () => {
    if (!confirm('确定退出?本浏览器密钥将被清除,需要重新输入才能解密数据。')) return;
    window.AmandaFirebase?.shutdown();
    Lock.clearKey();
    closeModal();
    location.reload();
  });
  document.getElementById('set-login')?.addEventListener('click', () => {
    closeModal();
    Lock.showOverlay({ mode: 'create' });
  });
  document.getElementById('set-refresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('set-refresh');
    btn.textContent = '正在从云端拉取…';
    btn.disabled = true;
    try {
      const r = await window.AmandaFirebase.refresh();
      if (r.ok) {
        toast(r.changed > 0 ? `已同步 ${r.changed} 类变更` : '已是最新');
      } else {
        toast('刷新失败');
      }
    } finally {
      btn.textContent = '↻ 立即从云端刷新';
      btn.disabled = false;
    }
  });
  $('#set-push').onclick = requestNotificationPermission;
  $('#set-export').onclick = exportData;
  $('#set-import').onclick = importData;
  $('#set-reset').onclick = resetData;
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return alert('当前浏览器不支持通知');

  // 已授权 → 跑一次完整诊断
  if (Notification.permission === 'granted') {
    runBadgeDiagnostic();
    return;
  }

  // 未授权 → 请求授权
  const p = await Notification.requestPermission();
  if (p === 'granted') {
    new Notification('任务指挥台', { body: '通知已开启,正在测试主屏徽章…' });
    setTimeout(runBadgeDiagnostic, 500);
  } else {
    alert('授权被拒绝。如要重新授权,需要在 iPhone 设置 → 通知 → 任务指挥台 中重新开启,或删除主屏图标重新添加。');
  }
}

async function runBadgeDiagnostic() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true;
  const hasBadgeAPI = 'setAppBadge' in navigator;
  const notifPerm = Notification.permission;
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const iosMatch = ua.match(/OS (\d+)_(\d+)/);
  const iosVer = iosMatch ? `${iosMatch[1]}.${iosMatch[2]}` : '未知';

  let setBadgeResult = '未尝试';
  let clearBadgeResult = '未尝试';
  if (hasBadgeAPI) {
    try {
      await navigator.setAppBadge(99);
      setBadgeResult = '✓ 成功(主屏图标应显示 99)';
    } catch (e) {
      setBadgeResult = '✗ ' + (e.message || e.name || String(e));
    }
    // 等2秒清掉测试值
    setTimeout(async () => {
      try {
        const todayN = State.tasks.filter(t => isTodayOrOverdue(t)).length;
        if (todayN > 0) await navigator.setAppBadge(todayN);
        else await navigator.clearAppBadge();
      } catch {}
    }, 2500);
  }

  const report = `
🔍 主屏徽章诊断
━━━━━━━━━━━━━━━━━━━━━━━

iOS 设备: ${isIOS ? '是' : '否(${ua.slice(0,40)})'}
iOS 版本: ${iosVer} ${isIOS && iosMatch ? (parseInt(iosMatch[1]) > 16 || (parseInt(iosMatch[1]) === 16 && parseInt(iosMatch[2]) >= 4) ? '✓' : '✗ 需 ≥ 16.4') : ''}

PWA 主屏模式: ${isStandalone ? '✓ 是' : '✗ 否(必须从主屏图标启动)'}
setAppBadge API: ${hasBadgeAPI ? '✓ 浏览器支持' : '✗ 不支持'}
通知权限: ${notifPerm === 'granted' ? '✓ 已授权' : (notifPerm === 'denied' ? '✗ 已拒绝' : '○ 未授权')}

设置徽章测试(应显示99):
  ${setBadgeResult}

━━━━━━━━━━━━━━━━━━━━━━━
${isStandalone && hasBadgeAPI && notifPerm === 'granted'
  ? '⚠️ 所有条件都满足。如果主屏仍无红点,试:\n1. 锁屏一次再亮屏\n2. 删主屏图标重新添加\n3. iOS 系统bug,重启iPhone'
  : '❌ 上面的 ✗ 项就是阻塞原因'}
  `.trim();

  alert(report);
}

function exportData() {
  const data = {
    tasks: State.tasks, persons: State.persons,
    trips: State.trips, templates: State.templates,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `amanda-tasks-${todayISO()}.json`;
  a.click();
  toast('已导出');
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const text = await file.text();
    try {
      const d = JSON.parse(text);
      if (d.tasks) State.tasks = d.tasks;
      if (d.persons) State.persons = d.persons;
      if (d.trips) State.trips = d.trips;
      if (d.templates) State.templates = d.templates;
      persistTasks(); persistPersons(); persistTrips(); persistTemplates();
      closeModal(); renderAll(); toast('已导入');
    } catch (e) { alert('导入失败:' + e.message); }
  };
  input.click();
}

function resetData() {
  if (!confirm('确定清空本地数据并重新预填种子?')) return;
  Object.values(KEY).forEach(k => k !== KEY.docKey && Store.remove(k));
  initData();
  closeModal(); renderAll(); toast('已重置');
}

/* ---------------------------------------------------------------------
 * 17. 锁屏(端到端加密 + 工作密钥登录)
 * ------------------------------------------------------------------ */
const Lock = {
  isRequired() {
    // 启用 Firebase 时必须设置工作密钥
    return !!(window.AmandaFirebase?.ENABLED);
  },
  getKey() {
    let v = localStorage.getItem('amanda.workKey');
    if (v && v.startsWith('"')) { try { v = JSON.parse(v); } catch {} }
    return (v || '').trim();
  },
  setKey(k) { localStorage.setItem('amanda.workKey', k); },
  clearKey() { localStorage.removeItem('amanda.workKey'); },

  showOverlay({ mode = 'unlock', error = null } = {}) {
    const existing = document.getElementById('lock-screen');
    if (existing) existing.remove();
    const ov = document.createElement('div');
    ov.id = 'lock-screen';
    ov.innerHTML = `
      <div class="lock-card">
        <div class="lock-emoji">🌻</div>
        <h2 class="lock-title">${mode === 'create' ? '设置工作密钥' : '请输入工作密钥'}</h2>
        <p class="lock-sub">
          ${mode === 'create'
            ? '密钥用于加密你的所有任务数据。<br>请记好,丢失无法找回。'
            : '此浏览器需要密钥才能解密你的数据。<br>密钥不会上传到云端。'}
        </p>
        <input id="lock-input" type="password" autocomplete="off"
               placeholder="${mode === 'create' ? '至少 8 位,自定义任意字符' : '输入你的密钥'}"
               value="">
        ${mode === 'create' ? `
          <input id="lock-input2" type="password" autocomplete="off"
                 placeholder="再输入一次确认" value="" style="margin-top:8px">` : ''}
        ${error ? `<div class="lock-error">${error}</div>` : ''}
        <button id="lock-submit" class="btn btn-primary btn-block" style="margin-top:14px">
          ${mode === 'create' ? '设置并启用同步' : '解锁'}
        </button>
        <div class="lock-foot">数据用 AES-GCM 256位加密 · 密钥仅存于此浏览器</div>
      </div>`;
    document.body.appendChild(ov);
    setTimeout(() => $('#lock-input').focus(), 100);

    const submit = async () => {
      const v1 = $('#lock-input').value.trim();
      if (!v1) return;
      if (mode === 'create') {
        if (v1.length < 8) return Lock.showOverlay({ mode, error: '密钥至少 8 位' });
        const v2 = $('#lock-input2').value.trim();
        if (v1 !== v2) return Lock.showOverlay({ mode, error: '两次输入不一致' });
      }
      $('#lock-submit').textContent = '验证中…';
      $('#lock-submit').disabled = true;

      Lock.setKey(v1);
      const res = await window.AmandaFirebase.init(v1);
      if (res.ok) {
        ov.remove();
        return;
      }
      // 验证失败
      Lock.clearKey();
      let msg;
      if (res.reason === 'wrong-key') msg = '密钥不正确,请重试';
      else if (res.reason === 'no-config') msg = 'Firebase 配置不完整';
      else msg = '连接失败,请检查网络';
      Lock.showOverlay({ mode, error: msg });
    };
    $('#lock-submit').onclick = submit;
    $('#lock-input').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    if (mode === 'create') {
      $('#lock-input2').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    }
  },

  async checkAndPrompt() {
    if (!this.isRequired()) return true;
    if (!window.AmandaFirebase.config.projectId) {
      console.warn('[Lock] Firebase 启用但未配置,降级为本地模式');
      return true;
    }
    const key = this.getKey();
    if (key) {
      // 浏览器有密钥,自动解锁
      const res = await window.AmandaFirebase.init(key);
      if (res.ok) return true;
      // 验证失败,清掉提示重新输入
      if (res.reason === 'wrong-key') {
        this.clearKey();
        this.showOverlay({ mode: 'unlock', error: '本浏览器存的密钥已失效,请重新输入' });
        return false;
      }
      // 网络问题等,先放过(用本地缓存数据)
      console.warn('[Lock] 远端验证未通过但允许本地访问:', res.reason);
      return true;
    }
    // 首次:判断远端有没有数据决定 create vs unlock 模式
    // 简单起见:统一用 unlock 模式(用户首次输入即创建)
    this.showOverlay({ mode: 'create' });
    return false;
  },
};

/* ---------------------------------------------------------------------
 * 18. 启动
 * ------------------------------------------------------------------ */
function init() {
  initData();
  renderGreeting();
  switchTab('today');

  // Tab 切换
  $$('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

  // FAB 新建
  $('#fab').onclick = () => openTaskModal();

  // 设置
  $('#settings-btn').onclick = openSettings;

  // 人筛选
  $$('#people-filter .chip').forEach(c => c.onclick = () => {
    State.ui.peopleFilter = c.dataset.filter;
    $$('#people-filter .chip').forEach(x => x.classList.toggle('active', x === c));
    renderPeople();
  });

  // 节奏切换
  $$('#rhythm-filter .chip').forEach(c => c.onclick = () => {
    State.ui.rhythmTab = c.dataset.rhythm;
    $$('#rhythm-filter .chip').forEach(x => x.classList.toggle('active', x === c));
    renderRhythm();
  });

  // 每分钟刷新一次,确保跨午夜后日期正确
  setInterval(() => {
    renderGreeting();
    renderCurrentView();
  }, 60000);

  // 切回前台时主动从云端拉一次最新数据(iOS PWA 后台时连接可能被挂起)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.AmandaFirebase?.ready) {
      window.AmandaFirebase.refresh?.().then(r => {
        if (r?.changed > 0) {
          console.info('[Sync] 切回前台:同步了', r.changed, '类变更');
        }
      }).catch(e => console.warn('[Sync] refresh err', e));
    }
  });

  // 控制台命令 + 暴露给 firebase-config.js 调用
  window.AmandaTasks = { State, Store, KEY, renderAll, captureSyncSnapshot, Lock };

  // 启动 Firebase 同步:先锁屏校验密钥
  if (window.AmandaFirebase?.ENABLED) {
    captureSyncSnapshot();
    Lock.checkAndPrompt().catch(e => console.warn('[Lock] error', e));
  }
}

document.addEventListener('DOMContentLoaded', init);

})();
