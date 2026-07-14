/* =====================================================================
 * Amanda 个人任务指挥台
 * 单文件主逻辑:数据层 + 视图渲染 + 交互
 * 数据存储:localStorage(默认) 或 Firebase Firestore(配置后)
 * ===================================================================== */

(function () {
'use strict';

/* === 版本号(与 service-worker.js 的 CACHE_VERSION 保持一致)=== */
const APP_VERSION = 'v5.7';

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
  fuzzyPlans: 'amanda.fuzzyPlans',
  exhibitions: 'amanda.exhibitions',
  notes: 'amanda.notes',
  meta: 'amanda.meta',
  docKey: 'amanda.docKey',
  dailyFocusShownAt: 'amanda.dailyFocusShownAt',
};

/** 工作日节奏:周一三五管理,周二四六销售,周日不提示 */
const DAILY_FOCUS = {
  1: { focus: '管理', emoji: '👥', sub: '复盘流程 · 团队推动 · 系统优化 · 招聘检查' },
  2: { focus: '销售', emoji: '💼', sub: '客户跟进 · 报价 · 谈判 · 询盘回复' },
  3: { focus: '管理', emoji: '👥', sub: '复盘流程 · 团队推动 · 系统优化 · 招聘检查' },
  4: { focus: '销售', emoji: '💼', sub: '客户跟进 · 报价 · 谈判 · 询盘回复' },
  5: { focus: '管理', emoji: '👥', sub: '复盘流程 · 团队推动 · 系统优化 · 招聘检查' },
  6: { focus: '销售', emoji: '💼', sub: '客户跟进 · 报价 · 谈判 · 询盘回复' },
};

const NOTE_CATEGORIES = {
  yellow: { name: '客户笔记', bg: '#FEF7CD', accent: '#B45309', soft: '#FFFBEB' },
  blue:   { name: '工作思路', bg: '#DBEAFE', accent: '#1E40AF', soft: '#EFF6FF' },
  green:  { name: '学习参考', bg: '#D1FAE5', accent: '#065F46', soft: '#ECFDF5' },
  pink:   { name: '灵感想法', bg: '#FCE7F3', accent: '#9D174D', soft: '#FDF2F8' },
  purple: { name: '日常生活', bg: '#EDE9FE', accent: '#5B21B6', soft: '#F5F3FF' },
  gray:   { name: '其他',     bg: '#E5E7EB', accent: '#374151', soft: '#F9FAFB' },
};
const NOTE_CAT_KEYS = Object.keys(NOTE_CATEGORIES);

/** 提醒预设(按距任务到期时间的分钟数)*/
const REMINDER_PRESETS = [
  { minutes: 5,     label: '5 分钟前' },
  { minutes: 15,    label: '15 分钟前' },
  { minutes: 30,    label: '30 分钟前' },
  { minutes: 60,    label: '1 小时前' },
  { minutes: 120,   label: '2 小时前' },
  { minutes: 1440,  label: '1 天前' },
  { minutes: 2880,  label: '2 天前' },
  { minutes: 4320,  label: '3 天前' },
  { minutes: 10080, label: '1 周前' },
];
function reminderLabel(min) {
  return REMINDER_PRESETS.find(p => p.minutes === min)?.label || `${min} 分钟前`;
}

/** 中国法定节假日(2026-2035,共 10 年)
 *  说明:仅标节日正日,不含国务院每年 12 月公布的调休补休日
 */
const CN_HOLIDAYS = {
  // === 2026 ===
  '2026-01-01': '元旦',
  '2026-02-17': '春节',
  '2026-04-05': '清明',
  '2026-05-01': '劳动节',
  '2026-06-19': '端午',
  '2026-09-25': '中秋',
  '2026-10-01': '国庆',
  // === 2027 ===
  '2027-01-01': '元旦',
  '2027-02-06': '春节',
  '2027-04-05': '清明',
  '2027-05-01': '劳动节',
  '2027-06-09': '端午',
  '2027-09-15': '中秋',
  '2027-10-01': '国庆',
  // === 2028 ===
  '2028-01-01': '元旦',
  '2028-01-26': '春节',
  '2028-04-04': '清明',
  '2028-05-01': '劳动节',
  '2028-05-28': '端午',
  '2028-10-03': '中秋',
  '2028-10-01': '国庆',
  // === 2029 ===
  '2029-01-01': '元旦',
  '2029-02-13': '春节',
  '2029-04-05': '清明',
  '2029-05-01': '劳动节',
  '2029-06-16': '端午',
  '2029-09-22': '中秋',
  '2029-10-01': '国庆',
  // === 2030 ===
  '2030-01-01': '元旦',
  '2030-02-03': '春节',
  '2030-04-05': '清明',
  '2030-05-01': '劳动节',
  '2030-06-05': '端午',
  '2030-09-12': '中秋',
  '2030-10-01': '国庆',
  // === 2031 ===
  '2031-01-01': '元旦',
  '2031-01-23': '春节',
  '2031-04-05': '清明',
  '2031-05-01': '劳动节',
  '2031-06-24': '端午',
  '2031-10-01': '中秋·国庆',  // 中秋恰逢国庆当日
  // === 2032 ===
  '2032-01-01': '元旦',
  '2032-02-11': '春节',
  '2032-04-04': '清明',
  '2032-05-01': '劳动节',
  '2032-06-12': '端午',
  '2032-09-19': '中秋',
  '2032-10-01': '国庆',
  // === 2033 ===
  '2033-01-01': '元旦',
  '2033-01-31': '春节',
  '2033-04-04': '清明',
  '2033-05-01': '劳动节',
  '2033-06-01': '端午',
  '2033-09-08': '中秋',
  '2033-10-01': '国庆',
  // === 2034 ===
  '2034-01-01': '元旦',
  '2034-02-19': '春节',
  '2034-04-05': '清明',
  '2034-05-01': '劳动节',
  '2034-06-20': '端午',
  '2034-09-27': '中秋',
  '2034-10-01': '国庆',
  // === 2035 ===
  '2035-01-01': '元旦',
  '2035-02-08': '春节',
  '2035-04-05': '清明',
  '2035-05-01': '劳动节',
  '2035-06-10': '端午',
  '2035-09-16': '中秋',
  '2035-10-01': '国庆',
};

const TRIP_TYPES = {
  paidExpo: { name: '付费展会', color: '#F59E0B', shades: ['#F59E0B', '#FBBF24', '#FCD34D', '#FDE68A'], soft: '#FEF3C7' },
  freeExpo: { name: '免费展会', color: '#3B82F6', shades: ['#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE'], soft: '#DBEAFE' },
  visit:    { name: '拜访客户', color: '#7C3AED', shades: ['#7C3AED', '#A78BFA', '#C4B5FD', '#DDD6FE'], soft: '#EDE9FE' },
  incoming: { name: '客户来访', color: '#D97706', shades: ['#D97706', '#F59E0B', '#FBBF24', '#FCD34D'], soft: '#FEF3C7' },
  inspect:  { name: '考察',     color: '#10B981', shades: ['#10B981', '#34D399', '#6EE7B7', '#A7F3D0'], soft: '#D1FAE5' },
  travel:   { name: '旅行',     color: '#EC4899', shades: ['#EC4899', '#F472B6', '#F9A8D4', '#FBCFE8'], soft: '#FCE7F3' },
  other:    { name: '其他',     color: '#6B7280', shades: ['#6B7280', '#9CA3AF', '#D1D5DB', '#E5E7EB'], soft: '#F3F4F6' },
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
        { title: '准备宣传册 + 名片 + 样板 + 礼品', stage: '出行准备', daysBeforeDeparture: 10, alertLevel: '普通' },
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
      id: 'tpl-expo-paid', name: '付费展会(含布展+海报+样品)', isBuiltIn: true,
      tasks: [
        { title: '申请签证', stage: '出行准备', daysBeforeDeparture: 60, alertLevel: '普通' },
        { title: '定酒店【展馆附近窗口】', stage: '出行准备', daysBeforeDeparture: 45, alertLevel: '琥珀提醒' },
        { title: '装修准备(展位设计 / 装修方案)', stage: '出行准备', daysBeforeDeparture: 30, alertLevel: '琥珀提醒' },
        { title: '定机票【便宜价窗口】', stage: '出行准备', daysBeforeDeparture: 30, alertLevel: '琥珀提醒' },
        { title: '定酒店【最后窗口】', stage: '出行准备', daysBeforeDeparture: 30, alertLevel: '红色警告' },
        { title: '寄送展品 / 样板', stage: '出行准备', daysBeforeDeparture: 21, alertLevel: '普通' },
        { title: '定机票【最后窗口】', stage: '出行准备', daysBeforeDeparture: 20, alertLevel: '红色警告' },
        { title: '海报 + 宣传样册准备', stage: '出行准备', daysBeforeDeparture: 15, alertLevel: '琥珀提醒' },
        { title: '样品 + 名片准备', stage: '出行准备', daysBeforeDeparture: 10, alertLevel: '普通' },
        { title: '入场牌申请 / 现场注册', stage: '出行准备', daysBeforeDeparture: 5, alertLevel: '普通' },
        { title: '备份电脑本地盘数据到移动硬盘(防出差中电脑丢失)', stage: '出行准备', daysBeforeDeparture: 1, alertLevel: '琥珀提醒' },
        { title: '提前布展', stage: '出行准备', daysBeforeDeparture: 1, alertLevel: '普通' },
        { title: '展会名片扫描入库', stage: '行程后跟进', daysBeforeDeparture: -3, alertLevel: '普通' },
        { title: '整理展会潜在客户清单 + 分配跟进', stage: '行程后跟进', daysBeforeDeparture: -7, alertLevel: '普通' },
      ],
    },
    {
      id: 'tpl-expo-free', name: '免费展会(简化版)', isBuiltIn: true,
      tasks: [
        { title: '申请签证', stage: '出行准备', daysBeforeDeparture: 60, alertLevel: '普通' },
        { title: '定机票【便宜价窗口】', stage: '出行准备', daysBeforeDeparture: 30, alertLevel: '琥珀提醒' },
        { title: '定机票【最后窗口】', stage: '出行准备', daysBeforeDeparture: 20, alertLevel: '红色警告' },
        { title: '定酒店', stage: '出行准备', daysBeforeDeparture: 14, alertLevel: '普通' },
        { title: '样册 + 样品 + 名片准备', stage: '出行准备', daysBeforeDeparture: 10, alertLevel: '普通' },
        { title: '入场牌申请 / 现场注册', stage: '出行准备', daysBeforeDeparture: 5, alertLevel: '普通' },
        { title: '备份电脑本地盘数据到移动硬盘(防出差中电脑丢失)', stage: '出行准备', daysBeforeDeparture: 1, alertLevel: '琥珀提醒' },
        { title: '展会名片扫描入库', stage: '行程后跟进', daysBeforeDeparture: -3, alertLevel: '普通' },
        { title: '整理潜在客户清单 + 分配跟进', stage: '行程后跟进', daysBeforeDeparture: -7, alertLevel: '普通' },
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
  fuzzyPlans: [],   // 客户模糊来访计划 { id, text, createdAt }
  exhibitions: [],  // 展会 { id, name, dateStart, dateEnd, country, city, frequency, agent, url, notes }
  notes: [],
  ui: { tab: 'today', peopleFilter: 'all', rhythmTab: 'frequency',
        notesFilter: 'all', tripView: 'calendar',
        tripCalYear: null, tripCalMonth: null,   // 当前显示的月份
        tripCardCollapsed: {},                    // trip.id -> bool 折叠状态
        todayFilter: 'default',                   // default / overdue / today / week / tomorrow / all
        exFilter: { month: 'all', country: 'all' } },  // 展会筛选
};

function initData() {
  const meta = Store.load(KEY.meta, null);
  if (!meta || !meta.seeded) {
    State.persons = seedPersons();
    State.tasks = seedTasks();
    State.templates = seedTemplates();
    State.trips = [];
    State.notes = [];
    Store.save(KEY.persons, State.persons);
    Store.save(KEY.tasks, State.tasks);
    Store.save(KEY.templates, State.templates);
    Store.save(KEY.trips, State.trips);
    Store.save(KEY.notes, State.notes);
    Store.save(KEY.meta, { seeded: true, seededAt: new Date().toISOString(), version: '1.0' });
  } else {
    State.persons = Store.load(KEY.persons, []);
    State.tasks = Store.load(KEY.tasks, []);
    State.templates = Store.load(KEY.templates, seedTemplates());
    State.trips = Store.load(KEY.trips, []);
    State.fuzzyPlans = Store.load(KEY.fuzzyPlans, []);
    State.exhibitions = Store.load(KEY.exhibitions, []);
    State.notes = Store.load(KEY.notes, []);

    // v5.7 迁移:行业→客户 · 个人→团队(用户不再需要这两类)
    let migrated = 0;
    for (const p of State.persons) {
      if (p.type === '行业') { p.type = '客户'; migrated++; }
      else if (p.type === '个人') { p.type = '团队'; migrated++; }
    }
    if (migrated) {
      Store.save(KEY.persons, State.persons);
      console.info(`[Migrate v5.7] 迁移 ${migrated} 个人物:行业→客户 / 个人→团队`);
    }
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
  let templatesChanged = false;
  let tripsChanged = false;
  const backupTaskPattern = /备份电脑本地盘/;

  // 1. 现有模板补"备份电脑数据"任务
  for (const tpl of State.templates) {
    if (!tpl.tasks.some(t => backupTaskPattern.test(t.title))) {
      tpl.tasks.push({
        title: '备份电脑本地盘数据到移动硬盘(防出差中电脑丢失)',
        stage: '出行准备',
        daysBeforeDeparture: 1,
        alertLevel: '琥珀提醒',
      });
      templatesChanged = true;
    }
  }

  // 2. 旧文案 → 新文案
  for (const tpl of State.templates) {
    for (const task of tpl.tasks) {
      if (task.title === '准备宣传册 + 压机样板') {
        task.title = '准备宣传册 + 名片 + 样板 + 礼品';
        templatesChanged = true;
      }
    }
  }

  // 3. 老的 'tpl-expo' 模板 → 升级为新的"付费展会"模板(整体替换任务列表)
  const expoIdx = State.templates.findIndex(t => t.id === 'tpl-expo');
  if (expoIdx >= 0) {
    const seedTpls = seedTemplates();
    const newPaid = seedTpls.find(t => t.id === 'tpl-expo-paid');
    State.templates[expoIdx] = newPaid;
    templatesChanged = true;
    console.info('[Migrate] tpl-expo → tpl-expo-paid');
  }

  // 4. 如果没有 tpl-expo-free 模板,加上
  if (!State.templates.some(t => t.id === 'tpl-expo-free')) {
    const seedTpls = seedTemplates();
    const newFree = seedTpls.find(t => t.id === 'tpl-expo-free');
    if (newFree) {
      State.templates.push(newFree);
      templatesChanged = true;
      console.info('[Migrate] 新增 tpl-expo-free 免费展会模板');
    }
  }

  // 5. 老 trip:tripType='expo' → 'paidExpo';templateId='tpl-expo' → 'tpl-expo-paid'
  for (const trip of State.trips) {
    if (trip.tripType === 'expo') {
      trip.tripType = 'paidExpo';
      tripsChanged = true;
    }
    if (trip.templateId === 'tpl-expo') {
      trip.templateId = 'tpl-expo-paid';
      tripsChanged = true;
    }
  }

  if (templatesChanged) {
    persistTemplates();
    console.info('[Migrate] 出差模板已升级');
  }
  if (tripsChanged) {
    persistTrips();
    console.info('[Migrate] 历史出差行程已迁移');
  }
}

/* 持久化 + Firebase 同步 */
const _syncSnapshot = { tasks: null, persons: null, trips: null, templates: null, notes: null, fuzzyPlans: null, exhibitions: null };

function captureSyncSnapshot() {
  for (const k of ['tasks', 'persons', 'trips', 'templates', 'notes', 'fuzzyPlans', 'exhibitions']) {
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
function persistNotes() { Store.save(KEY.notes, State.notes); _syncToFirebase('notes'); }
function persistFuzzyPlans() { Store.save(KEY.fuzzyPlans, State.fuzzyPlans); _syncToFirebase('fuzzyPlans'); }
function persistExhibitions() { Store.save(KEY.exhibitions, State.exhibitions); _syncToFirebase('exhibitions'); }

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

/** 把 "YYYY-MM-DD" 解析成本地 Date(避免 UTC 解析造成的日期偏移)*/
function parseLocalDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** 本周(周一-周日)结束日期的 ISO 字符串 */
function endOfThisWeekISO() {
  const today = new Date(todayISO());
  const dow = today.getDay(); // 0=周日, 1=周一, ...
  const sunday = new Date(today);
  // 距离本周日还有几天:周日 dow=0 → 0 天;周一 → 6 天;周六 → 1 天
  const daysToSunday = (7 - dow) % 7;
  sunday.setDate(today.getDate() + daysToSunday);
  return sunday.toISOString().slice(0, 10);
}

/** 按时间排序:有时间的在前(按 HH:MM 升序),无时间的在后保持原顺序 */
function sortByTime(tasks) {
  return [...tasks].sort((a, b) => {
    const ta = a.dueTime || a.timeOfDay || '';
    const tb = b.dueTime || b.timeOfDay || '';
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    if (ta && tb) return ta.localeCompare(tb);
    return 0;
  });
}

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
  return ({ '每天': 1, '每周': 7, '每月': 30, '每季': 90 })[period] || custom || 7;
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

/** 判断节奏-频率型任务今天是否应在"今日"列表显示 */
function frequencyDueToday(task) {
  const today = new Date(todayISO());
  const todayStr = todayISO();
  const lastDoneStr = task.lastDoneAt || '';

  // 今天已经完成过 → 不重复显示
  if (lastDoneStr === todayStr) return false;

  if (task.frequencyPeriod === '每天') {
    return true;
  }
  if (task.frequencyPeriod === '每周') {
    return today.getDay() === (task.weekday ?? -1);
  }
  if (task.frequencyPeriod === '每月') {
    return today.getDate() === (task.monthDay ?? -1);
  }
  if (task.frequencyPeriod === '每季') {
    const m = today.getMonth();  // 0=1月
    if (![2, 5, 8, 11].includes(m)) return false;  // 3/6/9/12月
    return today.getDate() === (task.quarterDay ?? -1);
  }
  if (task.frequencyPeriod === '自定义天数') {
    if (!lastDoneStr) return true;
    const days = task.frequencyCustomDays || 7;
    const next = new Date(lastDoneStr);
    next.setDate(next.getDate() + days);
    return next <= today;
  }
  return false;
}

/* 判断节奏-日期型任务今天是否应触发 */
function dateBasedTriggersToday(task) {
  const today = new Date(todayISO());
  if (task.datePattern === '每天') return true;
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
    if (t.type === '节奏-日期型') {
      if (dateBasedTriggersToday(t) &&
          (!t.lastDoneAt || daysBetween(t.lastDoneAt, todayISO()) !== 0)) {
        t._instanceDueToday = true;
      } else {
        t._instanceDueToday = false;
      }
    }
    // 节奏-频率型(支持选具体日,到期出现在今日)
    if (t.type === '节奏-频率型') {
      t._freqDueToday = frequencyDueToday(t);
    }
  });
}

/* 出差期间会议自动改视频 */
function isDuringActiveTrip(dateStr) {
  return State.trips.find(trip => {
    if (trip.status === '已完成') return false;
    if (!trip.autoVideoMeeting) return false;
    return parseLocalDate(dateStr) >= parseLocalDate(trip.departureDate) &&
           parseLocalDate(dateStr) <= parseLocalDate(trip.returnDate);
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
  const filter = State.ui.todayFilter || 'default';
  const tomorrowDate = addDays(todayISO(), 1);

  // 5 类计数
  const overdue = State.tasks.filter(isOverdue);
  const todayTasks = State.tasks.filter(t =>
    !isOverdue(t) && (
      isToday(t) ||
      (t.type === '节奏-日期型' && t._instanceDueToday) ||
      (t.type === '节奏-频率型' && t._freqDueToday)
    )
  );
  const tomorrowTasks = State.tasks.filter(t =>
    t.dueDate === tomorrowDate && t.status !== '已完成'
  );
  // 本周(今~周日;不含超期)
  const _eow = endOfThisWeekISO();
  const _today = todayISO();
  const weekTasks = State.tasks.filter(t =>
    t.status !== '已完成' &&
    t.dueDate && t.dueDate >= _today && t.dueDate <= _eow
  );
  // 所有未完成的待办(不含节奏型,那些在长期 Tab 有专属展示)
  const allOpen = State.tasks.filter(t =>
    t.status !== '已完成' &&
    t.type !== '节奏-频率型' &&
    t.type !== '节奏-日期型'
  );

  // 顶部 5 个可点击数字卡
  stats.innerHTML = `
    <button class="stat stat-overdue ${overdue.length ? 'on' : ''} ${filter==='overdue'?'active':''}" data-stat-filter="overdue">
      <div class="stat-num">${overdue.length}</div><div class="stat-label">超期</div>
    </button>
    <button class="stat stat-today ${filter==='today'?'active':''}" data-stat-filter="today">
      <div class="stat-num">${todayTasks.length}</div><div class="stat-label">今日</div>
    </button>
    <button class="stat stat-tomorrow ${tomorrowTasks.length ? 'on' : ''} ${filter==='tomorrow'?'active':''}" data-stat-filter="tomorrow">
      <div class="stat-num">${tomorrowTasks.length}</div><div class="stat-label">明天</div>
    </button>
    <button class="stat stat-week ${filter==='week'?'active':''}" data-stat-filter="week">
      <div class="stat-num">${weekTasks.length}</div><div class="stat-label">本周</div>
    </button>
    <button class="stat stat-all ${filter==='all'?'active':''}" data-stat-filter="all">
      <div class="stat-num">${allOpen.length}</div><div class="stat-label">所有</div>
    </button>`;

  // 数字卡点击切换 filter(再次点同一张卡返回默认视图)
  $$('.stat[data-stat-filter]', stats).forEach(el => {
    el.onclick = () => {
      const f = el.dataset.statFilter;
      State.ui.todayFilter = State.ui.todayFilter === f ? 'default' : f;
      renderToday();
    };
  });

  let html = '';

  // === 渲染主体:根据 filter 切换 ===

  // FILTER: overdue 单独显示
  if (filter === 'overdue') {
    if (!overdue.length) {
      html = renderEmpty('☀', '今天没有超期任务', '继续保持节奏');
    } else {
      html = `<div class="section section-overdue">
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
  }

  // FILTER: today
  else if (filter === 'today') {
    if (!todayTasks.length) {
      html = renderEmpty('☀', '今天没有任务', '点 + 新建一条');
    } else {
      for (const d of DOMAINS) {
        const items = sortByTime(todayTasks.filter(t => t.domain === d));
        if (!items.length) continue;
        html += renderDomainSection(d, items);
      }
    }
  }

  // FILTER: tomorrow
  else if (filter === 'tomorrow') {
    if (!tomorrowTasks.length) {
      html = renderEmpty('🌅', '明天暂无安排', '提前规划一下?');
    } else {
      for (const d of DOMAINS) {
        const items = sortByTime(tomorrowTasks.filter(t => t.domain === d));
        if (!items.length) continue;
        html += renderDomainSection(d, items);
      }
      // 不属于已知领域的兜底(按理不会有)
      const otherTomorrow = tomorrowTasks.filter(t => !DOMAINS.includes(t.domain));
      if (otherTomorrow.length) {
        html += `<div class="section"><div class="section-body">
          ${otherTomorrow.map(t => taskCard(t)).join('')}
        </div></div>`;
      }
    }
  }

  // FILTER: week(本周内待办,按日期分组显示)
  else if (filter === 'week') {
    if (!weekTasks.length) {
      html = renderEmpty('📅', '本周暂无剩余任务', '继续保持');
    } else {
      // 按日期分组
      const byDate = {};
      for (const t of weekTasks) (byDate[t.dueDate] ||= []).push(t);
      const dates = Object.keys(byDate).sort();
      const wdNames = ['日','一','二','三','四','五','六'];
      for (const d of dates) {
        const items = sortByTime(byDate[d]);
        const dt = parseLocalDate(d);
        const label = d === _today ? '今天' :
                      d === tomorrowDate ? '明天' :
                      `${dt.getMonth()+1}/${dt.getDate()} 周${wdNames[dt.getDay()]}`;
        html += `<div class="section">
          <div class="section-head">
            <span class="section-title">${label}</span>
            <span class="section-count">${items.length}</span>
          </div>
          <div class="section-body">
            ${items.map(t => taskCard(t)).join('')}
          </div>
        </div>`;
      }
    }
  }

  // FILTER: all(所有未完成待办 — 超期红区 + 按领域分组)
  else if (filter === 'all') {
    if (!allOpen.length) {
      html = renderEmpty('☀', '所有待办都完成了', '真棒 ✓');
    } else {
      // 排序:未逾期按 dueDate 升序,无日期最后
      const sortedAll = [...allOpen].sort((a, b) => {
        const aOv = isOverdue(a), bOv = isOverdue(b);
        if (aOv !== bOv) return aOv ? -1 : 1;
        const aD = a.dueDate || 'zzz';
        const bD = b.dueDate || 'zzz';
        return aD.localeCompare(bD);
      });
      // 超期红区置顶
      const overdueAll = sortedAll.filter(isOverdue);
      if (overdueAll.length) {
        html += `<div class="section section-overdue">
          <div class="section-bar bar-red"></div>
          <div class="section-head">
            <span class="section-title">超期 · 不会自动消失</span>
            <span class="section-count">${overdueAll.length}</span>
          </div>
          <div class="section-body">
            ${overdueAll.map(t => taskCard(t, { overdue: true })).join('')}
          </div>
        </div>`;
      }
      // 非超期任务按 3 个领域分组
      const nonOverdue = sortedAll.filter(t => !isOverdue(t));
      for (const d of DOMAINS) {
        const items = nonOverdue.filter(t => t.domain === d);
        if (!items.length) continue;
        html += renderDomainSection(d, items);
      }
      // 兜底:未知领域
      const otherDom = nonOverdue.filter(t => !DOMAINS.includes(t.domain));
      if (otherDom.length) {
        html += `<div class="section">
          <div class="section-head">
            <span class="section-title">其他</span>
            <span class="section-count">${otherDom.length}</span>
          </div>
          <div class="section-body">${otherDom.map(t => taskCard(t)).join('')}</div>
        </div>`;
      }
    }
  }

  // FILTER: default(置顶 + 超期红色 + 今日领域分组)
  else {
    // 置顶区 —— 用户手动 pin 的重点/长期任务,始终首屏
    const pinnedTasks = State.tasks.filter(t => t.pinned && t.status !== '已完成');
    if (pinnedTasks.length) {
      html += `<div class="section section-pinned">
        <div class="section-bar bar-gold"></div>
        <div class="section-head">
          <span class="section-title">📌 置顶</span>
          <span class="section-count">${pinnedTasks.length}</span>
        </div>
        <div class="section-body">
          ${pinnedTasks
            .sort((a,b)=> (a.dueDate||'zzz').localeCompare(b.dueDate||'zzz'))
            .map(t => taskCard(t)).join('')}
        </div>
      </div>`;
    }
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
      const items = sortByTime(todayTasks.filter(t => t.domain === d));
      if (!items.length) continue;
      html += renderDomainSection(d, items);
    }
    const pinnedCount = State.tasks.filter(t => t.pinned && t.status !== '已完成').length;
    if (!pinnedCount && !overdue.length && !todayTasks.length) {
      html = renderEmpty('☀', '今天没有待办', '点击右下角 + 新建任务');
    }
  }

  root.innerHTML = html;
  bindTaskCardEvents(root, { swipe: true });
  updateBadges();
}

function renderDomainSection(d, items) {
  return `<div class="section section-domain" style="background:${DOMAIN_BG[d]}">
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

function renderEmpty(emoji, title, sub) {
  return `<div class="empty">
    <div class="empty-emoji">${emoji}</div>
    <div class="empty-title">${escapeHtml(title)}</div>
    <div class="empty-sub">${escapeHtml(sub)}</div>
  </div>`;
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
    const items = sortByTime(State.tasks.filter(t => t.dueDate === iso && t.status !== '已完成'));
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
 * 7. 视图:客户 / 团队(原"人物"拆成两个 Tab)
 * ------------------------------------------------------------------ */
function renderCustomerView() { renderPersonsScope('customer'); }
function renderTeamView() { renderPersonsScope('team'); }

function renderPersonsScope(scope) {
  const rootId = scope === 'customer' ? '#customer-content' : '#team-content';
  const root = $(rootId);
  const targetType = scope === 'customer' ? '客户' : '团队';

  // 给每个人聚合任务
  const cards = State.persons.filter(p => p.type === targetType).map(p => {
    const allTasks = State.tasks.filter(t => t.relatedPerson?.includes(p.id));
    const openTasks = allTasks.filter(t => t.status !== '已完成');
    const lastProgress = allTasks
      .flatMap(t => (t.progressHistory || []).map(h => h.date))
      .sort().pop();
    const daysSince = lastProgress ? daysBetween(lastProgress, todayISO()) : 9999;
    return { person: p, tasks: openTasks, allTasks, daysSince };
  });

  // 只展示**至少有 1 个任务** 或 **设置了跟进频率** 的人物
  let filtered = cards.filter(c => c.allTasks.length > 0 || c.person.followupIntervalDays > 0);

  // 排序:优先用手动 sortOrder,未设置则退回"重要客户 → 久没动"
  filtered.sort((a, b) => {
    const ao = a.person.sortOrder, bo = b.person.sortOrder;
    if (ao != null && bo != null) return ao - bo;
    if (ao != null) return -1;
    if (bo != null) return 1;
    const ia = a.person.importance === '重要客户' ? 1 : 0;
    const ib = b.person.importance === '重要客户' ? 1 : 0;
    if (ia !== ib) return ib - ia;
    return b.daysSince - a.daysSince;
  });

  let html = filtered.map(personCard).join('');

  if (!html) {
    html = `<div class="empty">
      <div class="empty-emoji">${scope==='customer'?'◉':'◍'}</div>
      <div class="empty-title">暂无${targetType}</div>
      <div class="empty-sub">新建任务时勾选关联人,该${targetType}会出现在这里</div>
    </div>`;
  }

  root.innerHTML = html;
  bindTaskCardEvents(root);

  // 点人物卡头部 → 编辑/删除
  $$('.person-head', root).forEach(el => {
    el.onclick = () => {
      const pid = el.closest('.person-card')?.dataset.pid;
      if (pid) openPersonModal(pid);
    };
  });

  // 长按拖动排序
  bindPersonReorder(root);

  // "+ 设置下次跟进"
  $$('[data-act="next-followup"]', root).forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const pid = b.dataset.pid;
      const p = State.persons.find(x => x.id === pid);
      openTaskModal(null, {
        title: `跟进 ${p?.name || ''}`,
        domain: p?.type === '团队' ? '内部与系统' : '客户与销售',
        type: '长期跟进',
        relatedPerson: [pid],
        priority: 'P1',
        status: '进行中',
      });
    };
  });
}

/** 人物管理弹窗:编辑信息 / 删除人物 */
function openPersonModal(pid) {
  const p = State.persons.find(x => x.id === pid);
  if (!p) return;
  const usedBy = State.tasks.filter(t => t.relatedPerson?.includes(pid));

  openModal({
    title: '人物 · ' + p.name,
    body: `
      <label>姓名 <input id="pe-name" value="${escapeHtml(p.name)}"></label>
      <div class="row">
        <label class="flex1">类型
          <select id="pe-type">
            ${['客户','团队'].map(x =>
              `<option ${p.type===x?'selected':''}>${x}</option>`).join('')}
          </select>
        </label>
        <label class="flex1">重要度
          <select id="pe-importance">
            <option value="" ${!p.importance||p.importance==='普通客户'?'selected':''}>普通</option>
            <option value="重要客户" ${p.importance==='重要客户'?'selected':''}>重要</option>
          </select>
        </label>
      </div>
      <div class="row">
        <label class="flex1">公司 <input id="pe-company" value="${escapeHtml(p.company||'')}"></label>
        <label class="flex1">国家/地区 <input id="pe-country" value="${escapeHtml(p.country||'')}"></label>
      </div>
      <label>备注 <input id="pe-note" value="${escapeHtml(p.note||'')}"></label>
      <label>定期跟进
        <select id="pe-followup">
          <option value="0" ${!p.followupIntervalDays?'selected':''}>不跟进</option>
          <option value="3"  ${p.followupIntervalDays===3?'selected':''}>每 3 天</option>
          <option value="7"  ${p.followupIntervalDays===7?'selected':''}>每周</option>
          <option value="14" ${p.followupIntervalDays===14?'selected':''}>每 2 周</option>
          <option value="30" ${p.followupIntervalDays===30?'selected':''}>每月</option>
          <option value="60" ${p.followupIntervalDays===60?'selected':''}>每 2 个月</option>
          <option value="90" ${p.followupIntervalDays===90?'selected':''}>每季度</option>
        </select>
      </label>
      <div class="muted small">当前关联 ${usedBy.length} 个任务</div>
    `,
    actions: [
      { label: '取消', onClick: closeModal },
      { label: '删除人物', danger: true, onClick: () => {
        let msg = `确定删除人物 "${p.name}"?`;
        if (usedBy.length) msg += `\n\n该人物还在 ${usedBy.length} 个任务里使用,删除后这些任务的关联会被自动清除(任务本身保留)。`;
        if (!confirm(msg)) return;
        if (usedBy.length) {
          usedBy.forEach(t => { t.relatedPerson = t.relatedPerson.filter(id => id !== pid); });
          persistTasks();
        }
        State.persons = State.persons.filter(x => x.id !== pid);
        persistPersons();
        closeModal();
        renderAll();
        toast('已删除人物');
      }},
      { label: '保存', primary: true, onClick: () => {
        const newName = $('#pe-name').value.trim();
        if (!newName) { toast('姓名不能为空'); return; }
        p.name = newName;
        p.type = $('#pe-type').value;
        p.importance = $('#pe-importance').value || '普通客户';
        p.company = $('#pe-company').value.trim();
        p.country = $('#pe-country').value.trim();
        p.note = $('#pe-note').value.trim();
        p.followupIntervalDays = parseInt($('#pe-followup').value, 10) || 0;
        persistPersons();
        closeModal();
        renderAll();
        toast('已保存');
      }},
    ],
  });
}

function personCard({ person, tasks, daysSince }) {
  const tagText = [person.country, person.importance, person.note]
    .filter(Boolean).join(' · ');
  const sortedTasks = sortByTime([...tasks].sort((a, b) =>
    (a.dueDate || 'zzz').localeCompare(b.dueDate || 'zzz')));
  const lastSeen = daysSince < 9999 ? `${daysSince} 天前推进过` : '无推进记录';

  // 跟进频率:如果设置了周期且已超期,亮红色 "该跟进" 徽章
  let followupBadge = '';
  if (person.followupIntervalDays > 0) {
    const overdue = daysSince - person.followupIntervalDays;
    if (overdue >= 0) {
      followupBadge = `<span class="person-followup-badge overdue">该跟进 · 超 ${overdue} 天</span>`;
    } else {
      followupBadge = `<span class="person-followup-badge ok">每 ${person.followupIntervalDays} 天跟进 · 还剩 ${-overdue} 天</span>`;
    }
  }

  return `<div class="person-card" data-pid="${person.id}">
    <div class="person-head">
      <div class="person-avatar">${escapeHtml(person.name.slice(0,1))}</div>
      <div class="person-info">
        <div class="person-name">${escapeHtml(person.name)}${person.company ? ` <span class="muted small">(${escapeHtml(person.company)})</span>` : ''}</div>
        <div class="person-tag muted small">${escapeHtml(tagText) || person.type || ''}</div>
        <div class="person-tag muted small">${lastSeen}</div>
        ${followupBadge}
      </div>
      <div class="person-badge">${tasks.length} 项 ›</div>
    </div>
    <div class="person-tasks">
      ${sortedTasks.map(t => taskCard(t, { compact: true })).join('')}
    </div>
    <button class="btn btn-block btn-small person-followup" data-act="next-followup" data-pid="${person.id}">
      + 设置下次跟进
    </button>
  </div>`;
}

/* ---- 人物卡:长按拖动排序 ---- */
let _personDrag = null;
function bindPersonReorder(root) {
  $$('.person-card', root).forEach(card => {
    let holdTimer = null, sx = 0, sy = 0;
    card.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('button, input, textarea, select, a')) return;
      sx = e.clientX; sy = e.clientY;
      holdTimer = setTimeout(() => { holdTimer = null; _startPersonDrag(card, e); }, 400);
    });
    card.addEventListener('pointermove', (e) => {
      if (holdTimer && (Math.abs(e.clientY - sy) > 8 || Math.abs(e.clientX - sx) > 8)) {
        clearTimeout(holdTimer); holdTimer = null;
      }
      if (_personDrag && _personDrag.card === card) _onPersonDrag(e);
    });
    const stop = (e) => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      if (_personDrag && _personDrag.card === card) _endPersonDrag();
    };
    card.addEventListener('pointerup', stop);
    card.addEventListener('pointercancel', stop);
  });
}
function _startPersonDrag(card, e) {
  try { card.setPointerCapture(e.pointerId); } catch {}
  card.classList.add('is-dragging');
  document.body.classList.add('reordering');
  if (navigator.vibrate) { try { navigator.vibrate(25); } catch {} }
  _personDrag = { card, pointerId: e.pointerId, refY: e.clientY };
}
function _onPersonDrag(e) {
  const s = _personDrag;
  const dy = e.clientY - s.refY;
  s.card.style.transform = `translateY(${dy}px)`;
  const parent = s.card.parentElement;
  const siblings = Array.from(parent.querySelectorAll('.person-card')).filter(c => c !== s.card);
  for (const sib of siblings) {
    const r = sib.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const rel = s.card.compareDocumentPosition(sib);
    if (e.clientY < mid && (rel & Node.DOCUMENT_POSITION_PRECEDING)) {
      parent.insertBefore(s.card, sib);
      s.card.style.transform = '';
      s.refY = e.clientY;
      return;
    }
    if (e.clientY > mid && (rel & Node.DOCUMENT_POSITION_FOLLOWING)) {
      parent.insertBefore(s.card, sib.nextSibling);
      s.card.style.transform = '';
      s.refY = e.clientY;
      return;
    }
  }
}
function _endPersonDrag() {
  const s = _personDrag; _personDrag = null;
  try { s.card.releasePointerCapture(s.pointerId); } catch {}
  s.card.classList.remove('is-dragging');
  s.card.style.transform = '';
  document.body.classList.remove('reordering');
  const parent = s.card.parentElement;
  Array.from(parent.querySelectorAll('.person-card')).forEach((c, i) => {
    const pid = c.dataset.pid;
    const p = State.persons.find(x => x.id === pid);
    if (p) p.sortOrder = (i + 1) * 1000;
  });
  persistPersons();
  toast('顺序已保存');
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

    // === 本周之外的长期任务 ===
    const endOfWeek = endOfThisWeekISO();
    const longTermTasks = State.tasks.filter(t =>
      t.status !== '已完成' &&
      t.type !== '节奏-频率型' &&
      t.type !== '节奏-日期型' &&
      // 没有日期的长期跟进 OR 日期在本周日之后
      (!t.dueDate || t.dueDate > endOfWeek)
    );

    if (longTermTasks.length) {
      html += `<div class="long-term-divider"></div>`;
      // 按领域分组 + 每组内按日期排序(无日期的最后)
      for (const d of DOMAINS) {
        const items = longTermTasks
          .filter(t => t.domain === d)
          .sort((a, b) => {
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate) - new Date(b.dueDate);
          });
        if (!items.length) continue;
        html += `<div class="section section-domain" style="background:${DOMAIN_BG[d]}">
          <div class="section-bar" style="background:${DOMAIN_COLOR[d]}"></div>
          <div class="section-head">
            <span class="section-title">${d} · 本周之外</span>
            <span class="section-count">${items.length}</span>
          </div>
          <div class="section-body">
            ${items.map(t => taskCard(t)).join('')}
          </div>
        </div>`;
      }
    }

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
 * 9b. 视图:笔记
 * ------------------------------------------------------------------ */
function renderNotes() {
  const root = $('#notes-content');
  const filterBar = $('#notes-filter');

  // 重新渲染分类筛选条
  filterBar.innerHTML = `<button class="chip ${State.ui.notesFilter === 'all' ? 'active' : ''}" data-notes-cat="all">全部</button>`
    + NOTE_CAT_KEYS.map(k => `<button class="chip ${State.ui.notesFilter === k ? 'active' : ''}" data-notes-cat="${k}" style="background:${NOTE_CATEGORIES[k].soft};color:${NOTE_CATEGORIES[k].accent}">${NOTE_CATEGORIES[k].name}</button>`).join('');

  let notes = [...State.notes];
  if (State.ui.notesFilter !== 'all') {
    notes = notes.filter(n => n.category === State.ui.notesFilter);
  }
  // 置顶 + 按最后更新时间倒序
  notes.sort((a, b) => {
    if ((b.pinned ? 1 : 0) !== (a.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
  });

  if (!notes.length) {
    root.innerHTML = `<div class="empty">
      <div class="empty-emoji">📝</div>
      <div class="empty-title">${State.ui.notesFilter === 'all' ? '还没有笔记' : '此分类暂无笔记'}</div>
      <div class="empty-sub">点右下角 + 新建一条笔记</div>
    </div>`;
    bindNotesFilter();
    return;
  }

  root.innerHTML = `<div class="notes-grid">${notes.map(noteCard).join('')}</div>`;
  bindNotesFilter();
  $$('.note-card', root).forEach(el => {
    el.onclick = () => openNoteReader(el.dataset.nid);
  });
}

function bindNotesFilter() {
  $$('#notes-filter .chip').forEach(c => {
    c.onclick = () => {
      State.ui.notesFilter = c.dataset.notesCat;
      renderNotes();
    };
  });
}

function noteCard(n) {
  const cat = NOTE_CATEGORIES[n.category] || NOTE_CATEGORIES.gray;
  const date = (n.updatedAt || n.createdAt || '').slice(5, 10).replace('-', '/');
  // 富文本预览:保留所有格式,仅把图片替换成🖼避免预览过大
  const previewHTML = (n.content || '').replace(/<img[^>]*>/gi, '<span class="note-img-pill">🖼</span>');
  const isEmpty = !noteContentPreview(n.content).trim();
  return `<div class="note-card" data-nid="${n.id}" style="background:${cat.bg}">
    <div class="note-head">
      <span class="note-date" style="color:${cat.accent}">📅 ${date} · ${cat.name}</span>
      ${n.pinned ? '<span class="note-pin">📌</span>' : ''}
    </div>
    <div class="note-title">${escapeHtml(n.title || '(无标题)')}</div>
    <div class="note-preview note-rich-preview">${isEmpty ? '<span class="muted">空笔记</span>' : previewHTML}</div>
  </div>`;
}

/** 把图片文件压缩成 dataURL(最宽 maxW,JPEG quality)*/
function compressImage(file, maxW = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      try { resolve(canvas.toDataURL('image/jpeg', quality)); }
      catch (e) { reject(e); }
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** 选图 + 压缩 + 插入到 contenteditable 编辑器 */
function pickAndInsertImage(editor) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      toast('正在压缩图片…');
      const dataUrl = await compressImage(file, 800, 0.7);
      editor.focus();
      document.execCommand('insertImage', false, dataUrl);
      toast('图片已插入');
    } catch (e) {
      toast('图片插入失败');
      console.error(e);
    }
  };
  input.click();
}

/** 把笔记内容(可能是 HTML 也可能是旧的纯文本)转成编辑器可用的 HTML */
function noteContentToHTML(content) {
  if (!content) return '';
  // 检测是否含 HTML 标签
  if (/<[a-z][\s\S]*>/i.test(content)) return content;
  // 旧的纯文本:转义 + 换行变 <br>
  return escapeHtml(content).replace(/\n/g, '<br>');
}

/** 从笔记 HTML 内容提取纯文本预览 */
function noteContentPreview(content) {
  if (!content) return '';
  return content
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|h1|h2|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 阅读模式:点笔记卡片默认进这里,只展示内容 */
function openNoteReader(noteId) {
  const n = State.notes.find(x => x.id === noteId);
  if (!n) return;
  const cat = NOTE_CATEGORIES[n.category] || NOTE_CATEGORIES.gray;

  openModal({
    title: n.title || '(无标题)',
    body: `
      <div class="note-read-meta">
        <span class="note-cat-pill" style="background:${cat.bg};color:${cat.accent}">${escapeHtml(cat.name)}</span>
        ${n.pinned ? '<span class="muted small">📌 已置顶</span>' : ''}
      </div>
      <div class="note-read-content note-rich">${noteContentToHTML(n.content) || '<span class="muted">(空内容)</span>'}</div>
      <div class="muted small" style="margin-top:14px;padding-top:10px;border-top:0.5px dashed var(--c-border)">
        创建于 ${(n.createdAt || '').slice(0,16).replace('T',' ')}
        ${n.updatedAt && n.updatedAt !== n.createdAt
          ? `<br>最后修改 ${n.updatedAt.slice(0,16).replace('T',' ')}` : ''}
      </div>
    `,
    actions: [
      { label: '关闭', onClick: closeModal },
      { label: '删除', danger: true, onClick: () => {
        if (!confirm('确定删除此笔记?')) return;
        State.notes = State.notes.filter(x => x.id !== noteId);
        persistNotes(); closeModal(); renderNotes(); toast('已删除');
      }},
      { label: '编辑', primary: true, onClick: () => {
        closeModal();
        // 等模态关闭动画完再打开编辑(closeModal cancel pending timer 防 flash)
        setTimeout(() => openNoteModal(noteId), 50);
      }},
    ],
  });
}

function openNoteModal(noteId) {
  const isNew = !noteId;
  const n = isNew
    ? { id: uuid(), title: '', content: '', category: 'yellow', pinned: false,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    : State.notes.find(x => x.id === noteId);
  if (!n) return;

  const colorPicker = NOTE_CAT_KEYS.map(k => {
    const c = NOTE_CATEGORIES[k];
    return `<button type="button" class="note-color-chip ${n.category === k ? 'active' : ''}"
      data-cat="${k}" style="background:${c.bg};color:${c.accent};border-color:${n.category === k ? c.accent : 'transparent'}">${c.name}</button>`;
  }).join('');

  openModal({
    title: isNew ? '新建笔记' : '编辑笔记',
    body: `
      <label>标题 <input id="note-title" value="${escapeHtml(n.title)}" placeholder="一句话标题"></label>
      <label>分类 / 颜色
        <div class="note-colors">${colorPicker}</div>
      </label>
      <label class="check-row">
        <input type="checkbox" id="note-pin" ${n.pinned ? 'checked' : ''}>
        置顶笔记
      </label>
      <label>正文</label>
      <div class="note-toolbar">
        <button type="button" data-cmd="bold" title="加粗"><b>B</b></button>
        <button type="button" data-cmd="italic" title="斜体"><i>I</i></button>
        <button type="button" data-cmd="h1" title="一级标题">H1</button>
        <button type="button" data-cmd="h2" title="二级标题">H2</button>
        <button type="button" data-cmd="ul" title="项目符号">•</button>
        <button type="button" data-cmd="ol" title="编号列表">1.</button>
        <span class="note-toolbar-sep"></span>
        <button type="button" class="note-tb-color" data-color="#E24B4A" style="background:#E24B4A" title="红"></button>
        <button type="button" class="note-tb-color" data-color="#EF9F27" style="background:#EF9F27" title="橙"></button>
        <button type="button" class="note-tb-color" data-color="#1D9E75" style="background:#1D9E75" title="绿"></button>
        <button type="button" class="note-tb-color" data-color="#185FA5" style="background:#185FA5" title="蓝"></button>
        <button type="button" class="note-tb-color" data-color="#7C3AED" style="background:#7C3AED" title="紫"></button>
        <button type="button" class="note-tb-color" data-color="#1B1B1A" style="background:#1B1B1A" title="黑(恢复)"></button>
        <span class="note-toolbar-sep"></span>
        <button type="button" data-cmd="image" title="插入图片">📷</button>
      </div>
      <div id="note-content" class="note-editor" contenteditable="true"></div>
      <div class="muted small">
        创建于 ${(n.createdAt || '').slice(0, 16).replace('T', ' ')}<br>
        ${!isNew && n.updatedAt ? '最后修改 ' + n.updatedAt.slice(0, 16).replace('T', ' ') : ''}
      </div>
    `,
    actions: [
      { label: '取消', onClick: closeModal },
      ...(!isNew ? [{ label: '删除', danger: true, onClick: () => {
        if (!confirm('确定删除此笔记?')) return;
        State.notes = State.notes.filter(x => x.id !== noteId);
        persistNotes(); closeModal(); renderNotes(); toast('已删除');
      }}] : []),
      { label: '保存', primary: true, onClick: () => {
        const editor = $('#note-content');
        const contentHTML = editor ? editor.innerHTML.trim() : '';
        n.title = $('#note-title').value.trim();
        n.content = contentHTML;
        n.pinned = $('#note-pin').checked;
        n.updatedAt = new Date().toISOString();
        if (!n.title && !noteContentPreview(contentHTML)) {
          toast('标题或正文至少填一项'); return;
        }
        // 内容过大提示(Firestore 单文档 ~1MB,加密后更大)
        const size = new Blob([contentHTML]).size;
        if (size > 700 * 1024) {
          if (!confirm(`此笔记内容较大(${Math.round(size/1024)}KB,可能含大图),会拖慢同步。\n建议图片压缩后再插入。仍要保存?`)) return;
        }
        if (isNew) State.notes.push(n);
        else {
          const idx = State.notes.findIndex(x => x.id === n.id);
          if (idx >= 0) State.notes[idx] = n;
        }
        persistNotes(); closeModal(); renderNotes();
        toast(isNew ? '已新建' : '已保存');
      }},
    ],
  });

  // 初始化富文本编辑器内容
  const editor = $('#note-content');
  if (editor) editor.innerHTML = noteContentToHTML(n.content);

  // 颜色分类选择器交互
  $$('.note-color-chip', $('#modal-root')).forEach(b => {
    b.onclick = (e) => {
      e.preventDefault();
      n.category = b.dataset.cat;
      $$('.note-color-chip', $('#modal-root')).forEach(x => {
        const cat = NOTE_CATEGORIES[x.dataset.cat];
        x.classList.toggle('active', x.dataset.cat === n.category);
        x.style.borderColor = x.dataset.cat === n.category ? cat.accent : 'transparent';
      });
    };
  });

  // 富文本工具栏交互
  $$('.note-toolbar button', $('#modal-root')).forEach(btn => {
    // mousedown 阻止默认,保持编辑器里的选区不丢失
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.onclick = (e) => {
      e.preventDefault();
      const ed = $('#note-content');
      ed.focus();
      // 颜色按钮
      if (btn.classList.contains('note-tb-color')) {
        document.execCommand('foreColor', false, btn.dataset.color);
        return;
      }
      const cmd = btn.dataset.cmd;
      if (cmd === 'bold') document.execCommand('bold');
      else if (cmd === 'italic') document.execCommand('italic');
      else if (cmd === 'h1') document.execCommand('formatBlock', false, 'h1');
      else if (cmd === 'h2') document.execCommand('formatBlock', false, 'h2');
      else if (cmd === 'ul') document.execCommand('insertUnorderedList');
      else if (cmd === 'ol') document.execCommand('insertOrderedList');
      else if (cmd === 'image') pickAndInsertImage(ed);
    };
  });
}

/* ---------------------------------------------------------------------
 * 9. 视图:出差
 * ------------------------------------------------------------------ */
function renderTrip() {
  const root = $('#trip-content');
  const today = todayISO();
  // 列表排序:出发时间由近到远(待启动按出发日升序;已完成按出发日降序;进行中插最前)
  const trips = [...State.trips].sort((a, b) => {
    const aOngoing = a.departureDate <= today && a.returnDate >= today;
    const bOngoing = b.departureDate <= today && b.returnDate >= today;
    if (aOngoing !== bOngoing) return aOngoing ? -1 : 1;
    const aFuture = a.departureDate >= today;
    const bFuture = b.departureDate >= today;
    if (aFuture !== bFuture) return aFuture ? -1 : 1;  // upcoming 先于 past
    if (aFuture) return parseLocalDate(a.departureDate) - parseLocalDate(b.departureDate);
    return parseLocalDate(b.departureDate) - parseLocalDate(a.departureDate);
  });

  // 顶部工具条 + 视图切换
  let html = `<div class="trip-toolbar">
    <button class="btn btn-primary" data-act="new-trip">+ 新建出差</button>
    <button class="btn btn-ghost btn-small" data-act="manage-templates">管理模板</button>
  </div>
  <div class="trip-view-toggle">
    <button class="chip ${State.ui.tripView === 'calendar' ? 'active' : ''}" data-tv="calendar">📅 日历</button>
    <button class="chip ${State.ui.tripView === 'list' ? 'active' : ''}" data-tv="list">📋 列表</button>
  </div>
  <div class="trip-type-legend">
    ${Object.entries(TRIP_TYPES).map(([k, v]) =>
      `<span class="trip-type-tag" style="background:${v.soft};color:${v.color}"><span class="dot" style="background:${v.color}"></span>${v.name}</span>`
    ).join('')}
  </div>`;

  if (State.ui.tripView === 'calendar') {
    // 日历视图:即使没有出差也显示日历 + 模糊计划板块(空日历也能看节假日)
    html += renderTripCalendar(trips);
    if (!trips.length) {
      html += `<div class="empty" style="padding:16px;margin-top:8px">
        <div class="empty-sub">还没有确定日期的出差 · 点右上「+ 新建出差」</div>
      </div>`;
    }
    html += renderFuzzyPlans();
  } else if (!trips.length) {
    html += `<div class="empty">
      <div class="empty-emoji">✈</div>
      <div class="empty-title">还没有出差行程</div>
      <div class="empty-sub">点击 + 新建出差,系统按出发日期自动倒推所有提醒</div>
    </div>`;
  } else {
    html += trips.map(tripCard).join('');
  }
  root.innerHTML = html;

  // === 模糊计划:绑定新增/删除 ===
  const fpAdd = $('#fp-add-btn');
  if (fpAdd) {
    fpAdd.onclick = () => {
      const input = $('#fp-input');
      const text = (input.value || '').trim();
      if (!text) { toast('请先输入计划内容'); return; }
      State.fuzzyPlans.push({
        id: uuid(), text, createdAt: new Date().toISOString(),
      });
      persistFuzzyPlans();
      input.value = '';
      renderTrip();
    };
  }
  $$('[data-fp-del]', root).forEach(b => {
    b.onclick = () => {
      const id = b.dataset.fpDel;
      const item = State.fuzzyPlans.find(x => x.id === id);
      if (!confirm(`删除这条计划?\n\n"${item?.text || ''}"`)) return;
      State.fuzzyPlans = State.fuzzyPlans.filter(x => x.id !== id);
      persistFuzzyPlans();
      renderTrip();
    };
  });
  $$('[data-fp-edit]', root).forEach(b => {
    b.onclick = () => {
      const id = b.dataset.fpEdit;
      const item = State.fuzzyPlans.find(x => x.id === id);
      if (!item) return;
      const newText = prompt('编辑来访计划', item.text);
      if (newText == null) return;
      const t = newText.trim();
      if (!t) return;
      item.text = t;
      item.updatedAt = new Date().toISOString();
      persistFuzzyPlans();
      renderTrip();
    };
  });

  $('[data-act="new-trip"]')?.addEventListener('click', () => openTripModal());
  $('[data-act="manage-templates"]')?.addEventListener('click', () => openTemplateManager());
  $$('.trip-view-toggle .chip').forEach(c => {
    c.onclick = () => {
      State.ui.tripView = c.dataset.tv;
      renderTrip();
    };
  });
  $$('.trip-cal-bar', root).forEach(el => {
    el.addEventListener('click', () => openTripDetail(el.dataset.tripId));
  });

  // 月份导航(上月/下月按钮)
  $$('[data-cal-nav]', root).forEach(b => {
    b.onclick = () => navigateTripMonth(b.dataset.calNav === 'next' ? 1 : -1);
  });

  // 日历左右滑动切换月份
  const cal = root.querySelector('.trip-calendar');
  if (cal) {
    let startX = null, startY = null;
    cal.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    cal.addEventListener('touchend', e => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      // 横向位移 > 50px 且远大于纵向位移 → 视为滑动切月
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        navigateTripMonth(dx < 0 ? 1 : -1);
      }
      startX = startY = null;
    }, { passive: true });
  }

  // 列表卡片:头部点击 = 折叠/展开;详情按钮 = 打开模态
  $$('.trip-card-head', root).forEach(el => {
    el.onclick = (e) => {
      const card = el.closest('.trip-card');
      const tid = card.dataset.tripId;
      // 当前是否已展开 = State.ui.tripCardCollapsed[tid] === false
      // 切换:展开 → 折叠(true);折叠/未设置 → 展开(false)
      State.ui.tripCardCollapsed[tid] = State.ui.tripCardCollapsed[tid] === false;
      renderTrip();
    };
  });
  $$('[data-act="open-trip-detail"]', root).forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      openTripDetail(b.dataset.tripId);
    };
  });
}

/** 模糊来访计划板块:输入框 + 已有计划列表 */
function renderFuzzyPlans() {
  const list = [...(State.fuzzyPlans || [])].sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || ''));
  let itemsHtml = '';
  if (!list.length) {
    itemsHtml = `<div class="fp-empty muted small">还没有模糊计划 — 客户何时来中国还没定日期的都写这里</div>`;
  } else {
    itemsHtml = list.map(fp => `<div class="fp-item">
      <div class="fp-text">${escapeHtml(fp.text)}</div>
      <div class="fp-actions">
        <button class="btn-icon" data-fp-edit="${fp.id}" title="编辑">✎</button>
        <button class="btn-icon danger" data-fp-del="${fp.id}" title="删除">×</button>
      </div>
    </div>`).join('');
  }
  return `<div class="fuzzy-plans">
    <div class="fp-head">
      <span class="fp-title">📝 来访/模糊计划</span>
      <span class="muted small">日期未定的先记这里,一旦确定就 + 新建出差</span>
    </div>
    <div class="fp-input-row">
      <input id="fp-input" type="text" placeholder="例:XXX 客户计划 10 月来中国 3 天" />
      <button id="fp-add-btn" class="btn btn-primary btn-small">添加</button>
    </div>
    <div class="fp-list">${itemsHtml}</div>
  </div>`;
}

/* ============================================================
 * 展会 (Exhibition) — 数据模型 · 解析 · 视图
 * ============================================================ */

/** 中文国家名字典(按名称首字符出现顺序匹配) */
const EX_COUNTRIES = [
  '墨西哥','美国','韩国','沙特阿拉伯','沙特','波兰','泰国','孟加拉','土耳其',
  '罗马尼亚','印尼','印度尼西亚','西班牙','阿尔及利亚','俄罗斯','埃及','越南',
  '印度','马来西亚','阿联酋','迪拜','乌兹别克斯坦','德国','哈萨克斯坦','巴西',
  '加拿大','哥伦比亚','意大利','法国','英国','日本','澳大利亚','南非','尼日利亚',
  '肯尼亚','新加坡','菲律宾','土库曼斯坦','巴基斯坦','伊朗','摩洛哥','突尼斯',
  '中国',
];
function extractExCountry(name) {
  for (const c of EX_COUNTRIES) if (name.includes(c)) return c === '沙特' ? '沙特阿拉伯' : (c==='迪拜'?'阿联酋':(c==='印尼'?'印度尼西亚':c));
  return '';
}

/** 解析日期字符串:2026.08.19-22 / 2026.8.27-30 / 2027.02.26-03.01 */
function parseExDate(str) {
  if (!str) return null;
  str = str.replace(/\//g, '.').trim();
  // A: YYYY.MM.DD-DD  (同月)
  let m = str.match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})-(\d{1,2})$/);
  if (m) return { start: _pad(m[1],m[2],m[3]), end: _pad(m[1],m[2],m[4]) };
  // B: YYYY.MM.DD-MM.DD  (跨月)
  m = str.match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})-(\d{1,2})[.\-](\d{1,2})$/);
  if (m) return { start: _pad(m[1],m[2],m[3]), end: _pad(m[1],m[4],m[5]) };
  // C: 单日 YYYY.MM.DD
  m = str.match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})$/);
  if (m) return { start: _pad(m[1],m[2],m[3]), end: _pad(m[1],m[2],m[3]) };
  return null;
}
function _pad(y, m, d) {
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

/** 解析用户粘贴的展会表格文本(每行 TAB 分隔;续行属上一条) */
function parseExhibitionText(raw) {
  const lines = raw.split('\n').map(l => l.replace(/\r/g,'')).filter(l => l.trim());
  const rows = [];
  let cur = null;
  const dateRe = /^\s*\d{4}[.\/-]\d{1,2}/;
  for (const line of lines) {
    if (dateRe.test(line)) {
      if (cur) rows.push(cur);
      cur = line;
    } else if (cur) {
      cur += ' ' + line.trim();  // 续行拼到上一条
    }
  }
  if (cur) rows.push(cur);

  const out = [];
  for (const r of rows) {
    // 优先按 TAB 分列;若失败按连续空格
    let parts = r.split('\t').map(x => x.trim());
    if (parts.length < 3) parts = r.split(/\s{2,}/).map(x => x.trim());
    const [dateStr, name, frequency, city] = parts;
    if (!dateStr || !name) continue;
    const d = parseExDate(dateStr);
    if (!d) continue;
    const cleanName = name.replace(/\s+中国区总代\s*/g, '').replace(/\s+/g, ' ').trim();
    const agent = /中国区总代/.test(name);
    out.push({
      id: uuid(),
      name: cleanName,
      dateStart: d.start,
      dateEnd: d.end,
      country: extractExCountry(cleanName),
      city: (city || '').trim(),
      frequency: (frequency || '').trim(),
      agent,
      notes: '',
      createdAt: new Date().toISOString(),
    });
  }
  return out;
}

/** 展会视图入口 */
function renderExhibitions() {
  const root = $('#exhibition-content');
  const filter = State.ui.exFilter || (State.ui.exFilter = { month: 'all', country: 'all' });

  // 已过期(结束日 < 今天)不显示,让用户专注未来展会
  const today = todayISO();
  let list = (State.exhibitions || []).filter(e => (e.dateEnd || e.dateStart) >= today);

  // 收集用于筛选的国家、月份
  const countries = [...new Set(list.map(e => e.country).filter(Boolean))].sort();
  const months = [...new Set(list.map(e => (e.dateStart||'').slice(0,7)).filter(Boolean))].sort();

  // 应用筛选
  let filtered = list.slice();
  if (filter.month && filter.month !== 'all') {
    filtered = filtered.filter(e => (e.dateStart||'').startsWith(filter.month));
  }
  if (filter.country && filter.country !== 'all') {
    filtered = filtered.filter(e => e.country === filter.country);
  }
  filtered.sort((a,b) => (a.dateStart||'').localeCompare(b.dateStart||''));

  let html = `<div class="ex-toolbar">
    <button class="btn btn-primary btn-small" id="ex-add">+ 添加展会</button>
    <button class="btn btn-ghost btn-small" id="ex-import">📥 导入表格</button>
    <span class="muted small">共 ${list.length} 场未开始 / 全部 ${State.exhibitions.length} 场</span>
  </div>`;

  // 月份筛选条
  html += `<div class="ex-filter-row">
    <label class="ex-filter-label">月份</label>
    <select id="ex-month-filter" class="ex-select">
      <option value="all">全部</option>
      ${months.map(mo => {
        const [y,m] = mo.split('-');
        return `<option value="${mo}" ${filter.month===mo?'selected':''}>${y} 年 ${parseInt(m)} 月</option>`;
      }).join('')}
    </select>
    <label class="ex-filter-label">国家</label>
    <select id="ex-country-filter" class="ex-select">
      <option value="all">全部</option>
      ${countries.map(c => `<option value="${escapeHtml(c)}" ${filter.country===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}
    </select>
  </div>`;

  if (!filtered.length) {
    html += `<div class="empty">
      <div class="empty-emoji">🎪</div>
      <div class="empty-title">${State.exhibitions.length ? '当前筛选下没有展会' : '还没有展会数据'}</div>
      <div class="empty-sub">${State.exhibitions.length ? '换个月份/国家试试' : '点「+ 添加」手动录入,或「📥 导入表格」粘贴展会计划表'}</div>
    </div>`;
  } else {
    // 按月分组展示
    const byMonth = {};
    for (const e of filtered) {
      const k = (e.dateStart||'').slice(0,7);
      (byMonth[k] ||= []).push(e);
    }
    for (const k of Object.keys(byMonth).sort()) {
      const [y,m] = k.split('-');
      html += `<div class="ex-month-group">
        <div class="ex-month-head">${y} 年 ${parseInt(m)} 月</div>
        ${byMonth[k].map(exhibitionCard).join('')}
      </div>`;
    }
  }

  root.innerHTML = html;

  $('#ex-month-filter')?.addEventListener('change', (e) => {
    filter.month = e.target.value;
    renderExhibitions();
  });
  $('#ex-country-filter')?.addEventListener('change', (e) => {
    filter.country = e.target.value;
    renderExhibitions();
  });
  $('#ex-add')?.addEventListener('click', () => openExhibitionModal());
  $('#ex-import')?.addEventListener('click', () => openExhibitionImportModal());
  $$('.ex-card', root).forEach(el => {
    el.onclick = () => openExhibitionModal(el.dataset.exId);
  });
}

function exhibitionCard(e) {
  const startDate = fmtDate(e.dateStart);
  const endDate = fmtDate(e.dateEnd);
  const dateStr = e.dateStart === e.dateEnd ? startDate : `${startDate} — ${endDate}`;
  const daysAway = Math.ceil((parseLocalDate(e.dateStart) - new Date(todayISO())) / 86400000);
  const badge = daysAway <= 0 ? '<span class="ex-badge ongoing">进行中</span>'
              : daysAway <= 30 ? `<span class="ex-badge soon">${daysAway} 天</span>`
              : `<span class="ex-badge future">${daysAway} 天</span>`;
  return `<div class="ex-card" data-ex-id="${e.id}">
    <div class="ex-card-head">
      <span class="ex-country-flag">${escapeHtml(e.country || '?')}</span>
      <span class="ex-card-title">${escapeHtml(e.name)}</span>
      ${badge}
    </div>
    <div class="ex-card-meta muted small">
      <span>📅 ${dateStr}</span>
      ${e.city ? `<span>📍 ${escapeHtml(e.city)}</span>` : ''}
      ${e.frequency ? `<span>${escapeHtml(e.frequency)}</span>` : ''}
      ${e.agent ? '<span class="ex-agent-tag">中国区总代</span>' : ''}
    </div>
    ${e.notes ? `<div class="ex-card-notes muted small">${escapeHtml(e.notes)}</div>` : ''}
  </div>`;
}

/** 展会新建/编辑弹窗 */
function openExhibitionModal(exId) {
  const isNew = !exId;
  const e = isNew ? {
    id: uuid(), name: '', dateStart: '', dateEnd: '', country: '', city: '',
    frequency: '', agent: false, notes: '',
  } : { ...State.exhibitions.find(x => x.id === exId) };
  if (!e) return;

  openModal({
    title: isNew ? '新增展会' : '编辑展会',
    body: `
      <label>展会名称 <input id="ex-name" value="${escapeHtml(e.name)}" placeholder="如:墨西哥国际家具展 TECNO MUEBLE"></label>
      <div class="row">
        <label class="flex1">开始日期 <input type="date" id="ex-date-start" value="${e.dateStart||''}"></label>
        <label class="flex1">结束日期 <input type="date" id="ex-date-end" value="${e.dateEnd||''}"></label>
      </div>
      <div class="row">
        <label class="flex1">国家 <input id="ex-country" value="${escapeHtml(e.country||'')}" placeholder="如:墨西哥"></label>
        <label class="flex1">城市 <input id="ex-city" value="${escapeHtml(e.city||'')}" placeholder="如:瓜达拉哈拉"></label>
      </div>
      <div class="row">
        <label class="flex1">届数/周期 <input id="ex-freq" value="${escapeHtml(e.frequency||'')}" placeholder="如:一年一届"></label>
        <label class="flex1"><input type="checkbox" id="ex-agent" ${e.agent?'checked':''}> 中国区总代</label>
      </div>
      <label>备注 <textarea id="ex-notes" rows="2">${escapeHtml(e.notes||'')}</textarea></label>
    `,
    actions: [
      { label: '取消', onClick: closeModal },
      ...(isNew ? [] : [{ label: '删除', danger: true, onClick: () => {
        if (!confirm(`删除展会「${e.name}」?`)) return;
        State.exhibitions = State.exhibitions.filter(x => x.id !== exId);
        persistExhibitions();
        closeModal();
        renderExhibitions();
        toast('已删除');
      }}]),
      { label: '保存', primary: true, onClick: () => {
        const name = $('#ex-name').value.trim();
        const ds = $('#ex-date-start').value;
        const de = $('#ex-date-end').value || ds;
        if (!name) { toast('请填写展会名称'); return; }
        if (!ds) { toast('请选择开始日期'); return; }
        const payload = {
          id: e.id, name,
          dateStart: ds, dateEnd: de,
          country: $('#ex-country').value.trim() || extractExCountry(name),
          city: $('#ex-city').value.trim(),
          frequency: $('#ex-freq').value.trim(),
          agent: $('#ex-agent').checked,
          notes: $('#ex-notes').value.trim(),
          createdAt: e.createdAt || new Date().toISOString(),
        };
        if (isNew) State.exhibitions.push(payload);
        else State.exhibitions = State.exhibitions.map(x => x.id === exId ? payload : x);
        persistExhibitions();
        closeModal();
        renderExhibitions();
        toast(isNew ? '已添加' : '已保存');
      }},
    ],
  });
}

/** 导入弹窗:粘贴表格文本(TAB / 空格分隔) */
function openExhibitionImportModal() {
  openModal({
    title: '📥 导入展会',
    body: `
      <div class="muted small" style="margin-bottom:8px;line-height:1.5">
        把 Word 展会计划表里的表格<b>复制粘贴</b>到下面(4 列:日期 / 名称 / 届数 / 城市)。<br>
        支持 TAB 或多个空格分隔;跨行的名称会自动合并。
      </div>
      <textarea id="ex-import-text" rows="10" placeholder="示例:
2026.08.19-22\t墨西哥国际家具、家具配件及木工机械展TECNO MUEBLE\t一年一届\t瓜达拉哈拉
2026.08.25-28\t美国亚特兰大国际家具配件及木工机械展IWF\t两年一届\t亚特兰大"></textarea>
      <div id="ex-import-preview" class="muted small" style="margin-top:8px"></div>
    `,
    actions: [
      { label: '取消', onClick: closeModal },
      { label: '预览', onClick: () => {
        const raw = $('#ex-import-text').value;
        const parsed = parseExhibitionText(raw);
        const box = $('#ex-import-preview');
        if (!parsed.length) { box.innerHTML = '<span style="color:var(--c-red)">未解析到任何行</span>'; return; }
        box.innerHTML = `<b>识别到 ${parsed.length} 场:</b><br>` +
          parsed.slice(0, 10).map(p => `· ${p.dateStart} — ${p.name.slice(0,30)} <span class="muted">(${p.country||'?'})</span>`).join('<br>') +
          (parsed.length > 10 ? `<br>… 还有 ${parsed.length-10} 场` : '');
      }},
      { label: '导入', primary: true, onClick: () => {
        const raw = $('#ex-import-text').value;
        const parsed = parseExhibitionText(raw);
        if (!parsed.length) { toast('未解析到有效展会,请检查格式'); return; }
        // 去重:同名 + 同开始日期 判为重复
        const existKey = new Set(State.exhibitions.map(e => `${e.name}::${e.dateStart}`));
        let added = 0, skipped = 0;
        for (const p of parsed) {
          const k = `${p.name}::${p.dateStart}`;
          if (existKey.has(k)) { skipped++; continue; }
          existKey.add(k);
          State.exhibitions.push(p);
          added++;
        }
        persistExhibitions();
        closeModal();
        renderExhibitions();
        toast(`导入完成:新增 ${added} 场${skipped?`,跳过 ${skipped} 场重复`:''}`);
      }},
    ],
  });
}

function navigateTripMonth(delta) {
  let m = State.ui.tripCalMonth + delta;
  let y = State.ui.tripCalYear;
  if (m < 0) { m = 11; y--; }
  if (m > 11) { m = 0; y++; }
  State.ui.tripCalYear = y;
  State.ui.tripCalMonth = m;
  renderTrip();
}

/** 出差日历模式渲染:单月显示 + 左右滑动切换 */
function renderTripCalendar(trips) {
  // 初次访问时,默认显示今天所在月
  if (State.ui.tripCalYear == null || State.ui.tripCalMonth == null) {
    const today = new Date(todayISO());
    State.ui.tripCalYear = today.getFullYear();
    State.ui.tripCalMonth = today.getMonth();
  }
  const { tripCalYear: y, tripCalMonth: m } = State.ui;
  const monthName = `${y} 年 ${m + 1} 月`;
  return `<div class="trip-cal-nav">
    <button class="trip-cal-arrow" data-cal-nav="prev" aria-label="上月">‹</button>
    <span class="trip-cal-title">${monthName}</span>
    <button class="trip-cal-arrow" data-cal-nav="next" aria-label="下月">›</button>
  </div>${renderTripCalendarMonth(y, m, trips)}`;
}

/** 给月内的出差按"类型 + 时间槽"分配渲染参数 */
function _assignTripVisuals(monthTrips) {
  const sorted = [...monthTrips].sort((a, b) =>
    parseLocalDate(a.departureDate) - parseLocalDate(b.departureDate));

  const typeIdx = {};
  for (const trip of sorted) {
    const tt = trip.tripType || 'visit';
    if (!(tt in typeIdx)) typeIdx[tt] = 0;
    trip._shadeIdx = typeIdx[tt]++;
  }

  const slots = [];
  for (const trip of sorted) {
    const dep = parseLocalDate(trip.departureDate);
    let placed = false;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] < dep) {
        slots[i] = parseLocalDate(trip.returnDate);
        trip._slot = i;
        placed = true;
        break;
      }
    }
    if (!placed) {
      trip._slot = slots.length;
      slots.push(parseLocalDate(trip.returnDate));
    }
  }
  return { maxSlot: slots.length, sorted };
}

function renderTripCalendarMonth(year, month, trips) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay(); // 0 = Sunday
  const numDays = lastDay.getDate();
  const todayStr = todayISO();

  // 收集该月有重叠的出差(用本地日期解析,防止时区 bug)
  const monthTrips = trips.filter(t => {
    const dep = parseLocalDate(t.departureDate);
    const ret = parseLocalDate(t.returnDate);
    if (!dep || !ret) return false;
    return ret >= firstDay && dep <= lastDay;
  });

  // 给每条出差分配"槽位"+ "色阶"(同类型重叠用不同浅色)
  const { maxSlot } = _assignTripVisuals(monthTrips);
  const SLOT_HEIGHT = 20;        // 每条色条高 20px(v5.6 字号放大)
  const SLOT_GAP = 3;            // 色条间距 3px
  const HEAD_RESERVE = 28;       // 顶部留给日期数字的高度(数字变大)
  const ROW_HEIGHT = HEAD_RESERVE + Math.max(maxSlot, 1) * (SLOT_HEIGHT + SLOT_GAP) + 4;

  // 周日开始的网格
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  let html = `<div class="trip-calendar" style="--row-h:${ROW_HEIGHT}px">
    <div class="trip-cal-weekdays">
      ${['日','一','二','三','四','五','六'].map(w => `<div>${w}</div>`).join('')}
    </div>
    <div class="trip-cal-grid">`;

  for (const day of cells) {
    if (day === null) {
      html += `<div class="trip-cal-cell empty"></div>`;
      continue;
    }
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = dateStr === todayStr;
    const holiday = CN_HOLIDAYS[dateStr];
    html += `<div class="trip-cal-cell ${isToday ? 'is-today' : ''}${holiday ? ' is-holiday' : ''}">
      <div class="trip-cal-num">${day}</div>
      ${holiday ? `<div class="trip-cal-holiday">${escapeHtml(holiday)}</div>` : ''}
    </div>`;
  }

  // 出差色条:作为 grid 的子元素(position:absolute),top 起点 = grid 顶部 = 第一行起点
  // 这样 bar.top = ${r} * row-h + HEAD_RESERVE 就刚好落在日期数字下方
  if (monthTrips.length) {
    html += `<div class="trip-cal-bars">`;
    monthTrips.forEach((trip) => {
      const dep = parseLocalDate(trip.departureDate);
      const ret = parseLocalDate(trip.returnDate);
      const startDay = dep < firstDay ? 1 : dep.getDate();
      const endDay = ret > lastDay ? numDays : ret.getDate();
      const startCellIdx = startWeekday + startDay - 1;
      const endCellIdx = startWeekday + endDay - 1;
      const startRow = Math.floor(startCellIdx / 7);
      const endRow = Math.floor(endCellIdx / 7);
      const type = TRIP_TYPES[trip.tripType || 'visit'] || TRIP_TYPES.other;
      const shadeColor = (type.shades && type.shades[trip._shadeIdx % type.shades.length]) || type.color;

      for (let r = startRow; r <= endRow; r++) {
        const rowStart = r === startRow ? startCellIdx % 7 : 0;
        const rowEnd = r === endRow ? endCellIdx % 7 : 6;
        const widthPct = ((rowEnd - rowStart + 1) / 7) * 100;
        const leftPct = (rowStart / 7) * 100;
        // top = 行起点 + 头部预留(给日期数字) + 槽位偏移
        html += `<div class="trip-cal-bar"
          data-trip-id="${trip.id}"
          style="left:${leftPct}%;width:${widthPct}%;
                 top:calc(${r} * var(--row-h) + ${HEAD_RESERVE}px + ${trip._slot} * (${SLOT_HEIGHT + SLOT_GAP}px));
                 height:${SLOT_HEIGHT}px;
                 background:${shadeColor};
                 ${r === startRow ? 'border-top-left-radius:6px;border-bottom-left-radius:6px;' : ''}
                 ${r === endRow ? 'border-top-right-radius:6px;border-bottom-right-radius:6px;' : ''}">
          ${r === startRow ? escapeHtml(trip.name) : ''}
        </div>`;
      }
    });
    html += `</div>`;
  }

  html += `</div>`;  // close .trip-cal-grid
  html += `</div>`;  // close .trip-calendar
  return html;
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
  const tripType = TRIP_TYPES[trip.tripType || 'visit'] || TRIP_TYPES.other;
  // 默认折叠;只有显式标记为 false 才展开
  const collapsed = State.ui.tripCardCollapsed[trip.id] !== false;

  return `<div class="card trip-card ${collapsed ? 'is-collapsed' : 'is-expanded'}" data-trip-id="${trip.id}"
    style="border-left:4px solid ${tripType.color}">
    <div class="trip-card-head">
      <div class="flex1">
        <div class="trip-name">${escapeHtml(trip.name)}
          <span class="trip-type-pill" style="background:${tripType.soft};color:${tripType.color}">${tripType.name}</span>
        </div>
        <div class="muted small">${fmtDate(trip.departureDate)} – ${fmtDate(trip.returnDate)} · ${escapeHtml(trip.destination)}</div>
      </div>
      <div class="trip-card-head-right">
        <span class="trip-status status-${trip.status === '进行中' ? 'on' : trip.status === '已完成' ? 'done' : 'pending'}">${trip.status}</span>
        <span class="trip-card-toggle">${collapsed ? '▼' : '▲'}</span>
      </div>
    </div>
    <div class="trip-progress">
      <div class="trip-progress-bar"><div style="width:${pct}%"></div></div>
      <span class="muted small">${done} / ${total}</span>
    </div>
    ${!collapsed ? `
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
      <button class="btn btn-small btn-block" data-act="open-trip-detail" data-trip-id="${trip.id}" style="margin-top:8px">查看详情 / 编辑</button>
    ` : ''}
  </div>`;
}

function openTripModal(existing) {
  const t = existing || {
    name: '', destination: '', departureDate: '', returnDate: '',
    templateId: 'tpl-intl-standard', tripType: 'visit', autoVideoMeeting: true,
  };
  const tplOptions = State.templates.map(tp =>
    `<option value="${tp.id}" ${tp.id === t.templateId ? 'selected' : ''}>${escapeHtml(tp.name)}</option>`).join('');
  const typeOptions = Object.entries(TRIP_TYPES).map(([k, v]) =>
    `<option value="${k}" ${k === (t.tripType||'visit') ? 'selected' : ''}>${v.name}</option>`).join('');

  openModal({
    title: existing ? '编辑出差' : '新建出差',
    body: `
      <label>行程名<input id="trip-name" value="${escapeHtml(t.name)}" placeholder="如:南美客户拜访行"></label>
      <label>目的地<input id="trip-dest" value="${escapeHtml(t.destination)}" placeholder="国家/城市"></label>
      <div class="row">
        <label class="flex1">出发日期<input id="trip-dep" type="date" value="${t.departureDate}"></label>
        <label class="flex1">返程日期<input id="trip-ret" type="date" value="${t.returnDate}"></label>
      </div>
      <div class="row">
        <label class="flex1">出差类型<select id="trip-type">${typeOptions}</select></label>
        <label class="flex1">套用模板<select id="trip-tpl">${tplOptions}</select></label>
      </div>
      <label class="check-row">
        <input type="checkbox" id="trip-video" ${t.autoVideoMeeting ? 'checked' : ''}>
        出差期间会议自动改视频
      </label>
      <div class="muted small">保存后系统按出发日期自动倒推派生任务(包含"出发前1天备份电脑数据"提醒)。</div>`,
    actions: [
      { label: '取消', onClick: closeModal },
      { label: '保存并派生任务', primary: true, onClick: () => {
        const trip = existing ? { ...existing } : { id: uuid(), status: '待启动', relatedTaskIds: [] };
        trip.name = $('#trip-name').value.trim();
        trip.destination = $('#trip-dest').value.trim();
        trip.departureDate = $('#trip-dep').value;
        trip.returnDate = $('#trip-ret').value;
        trip.templateId = $('#trip-tpl').value;
        trip.tripType = $('#trip-type').value;
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
  // 出差/展会子任务:徽章上带上父行程名,便于区分「哪次出差」
  let typeBadgeText = t.type;
  if (t.type === '出差子任务' && t.linkedTripId) {
    const parentTrip = State.trips && State.trips.find(x => x.id === t.linkedTripId);
    if (parentTrip && parentTrip.name) typeBadgeText = `${parentTrip.name} · 子任务`;
  }
  const typeBadge = t.type && t.type !== '单点' ? `<span class="task-type">${escapeHtml(typeBadgeText)}</span>` : '';
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
        ${(t.dueTime || t.timeOfDay) ? `<span class="task-time">${escapeHtml(t.dueTime || t.timeOfDay)}</span>` : ''}
        ${t.dueDate ? `<span class="task-due">${fmtDate(t.dueDate)}</span>` : ''}
        ${overdue ? `<span class="task-overdue">逾期 ${overdueDays} 天</span>` : ''}
        ${t._videoBadge ? '<span class="badge-video">📹</span>' : ''}
        ${(t.reminders && t.reminders.length) ? `<span class="task-reminder" title="提醒:${t.reminders.map(reminderLabel).join(' / ')}">⏰ ${t.reminders.length}</span>` : ''}
      </div>
    </div>
    ${overdue ? `<button class="btn-postpone" data-act="postpone">延期</button>` : ''}
  </div>`;
}

function bindTaskCardEvents(root, opt = {}) {
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
    card.addEventListener('click', () => {
      if (card._suppressClick) return;
      openTaskDetail(tid);
    });
  });
  // 今日视图额外启用 左划(置顶/删除) + 右划(延到明天)
  if (opt.swipe) wrapCardsForSwipe(root);
}

/* ---- 任务卡:左划抽屉(置顶/删除) + 右划(延到明天) ---- */
function wrapCardsForSwipe(root) {
  $$('.task-card', root).forEach(card => {
    if (card.parentElement.classList.contains('swipe-wrap')) return;
    const tid = card.dataset.tid;
    if (!tid) return;
    const t = State.tasks.find(x => x.id === tid);
    if (!t) return;
    const wrap = document.createElement('div');
    wrap.className = 'swipe-wrap';
    const pinLabel = t.pinned ? '取消置顶' : '置顶';
    wrap.innerHTML = `
      <div class="swipe-bg-right"><span>→ 延到明天</span></div>
      <div class="swipe-actions">
        <button type="button" class="swipe-btn pin" data-swipe-act="pin" data-tid="${tid}">${pinLabel}</button>
        <button type="button" class="swipe-btn del" data-swipe-act="del" data-tid="${tid}">删除</button>
      </div>`;
    card.parentNode.insertBefore(wrap, card);
    wrap.appendChild(card);
    _bindSwipeCard(wrap, card, tid);
  });
  $$('[data-swipe-act]', root).forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const tid = b.dataset.tid;
      if (b.dataset.swipeAct === 'pin') togglePinTask(tid);
      else if (b.dataset.swipeAct === 'del') deleteTask(tid);
    };
  });
}
function _bindSwipeCard(wrap, card, tid) {
  let sx = 0, sy = 0, dx = 0, active = false, decided = false, vertical = false;
  let openState = 0;
  const OPEN_X = -160;
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, textarea, select, a')) return;
    sx = e.clientX; sy = e.clientY; dx = 0;
    active = true; decided = false; vertical = false;
    card.style.transition = '';
  });
  card.addEventListener('pointermove', (e) => {
    if (!active) return;
    const cdx = e.clientX - sx;
    const cdy = e.clientY - sy;
    if (!decided) {
      if (Math.abs(cdx) < 6 && Math.abs(cdy) < 6) return;
      decided = true;
      if (Math.abs(cdy) > Math.abs(cdx)) { vertical = true; return; }
      try { card.setPointerCapture(e.pointerId); } catch {}
    }
    if (vertical) return;
    dx = cdx + (openState === 1 ? OPEN_X : 0);
    if (dx > 220) dx = 220;
    if (dx < -220) dx = -220;
    card.style.transform = `translateX(${dx}px)`;
    wrap.classList.toggle('swipe-right-preview', dx > 40);
    wrap.classList.toggle('swipe-left-preview', dx < -40);
  });
  const finish = () => {
    if (!active) return;
    active = false;
    if (vertical) return;
    card.style.transition = 'transform .18s ease';
    if (dx <= -60) {
      card.style.transform = `translateX(${OPEN_X}px)`;
      openState = 1;
    } else if (dx >= 80) {
      card.style.transform = 'translateX(120vw)';
      setTimeout(() => postponeTask(tid, addDays(todayISO(), 1)), 180);
    } else {
      card.style.transform = 'translateX(0)';
      openState = 0;
    }
    wrap.classList.remove('swipe-right-preview', 'swipe-left-preview');
    if (Math.abs(dx) > 6) {
      card._suppressClick = true;
      setTimeout(() => { card._suppressClick = false; }, 300);
    }
  };
  card.addEventListener('pointerup', finish);
  card.addEventListener('pointercancel', () => { active = false; });
  // 抽屉打开状态下,点空白 → 关闭
  card.addEventListener('click', (e) => {
    if (openState === 1 && !e.target.closest('.swipe-btn')) {
      openState = 0;
      card.style.transition = 'transform .18s ease';
      card.style.transform = 'translateX(0)';
      e.stopPropagation();
    }
  }, true);
}
function togglePinTask(tid) {
  const t = State.tasks.find(x => x.id === tid);
  if (!t) return;
  t.pinned = !t.pinned;
  persistTasks();
  renderAll();
  toast(t.pinned ? '已置顶 📌' : '已取消置顶');
}

/* ---------------------------------------------------------------------
 * 11. 任务操作
 * ------------------------------------------------------------------ */
function completeTask(tid) {
  const t = State.tasks.find(x => x.id === tid);
  if (!t) return;
  if (t.type === '节奏-频率型') return markRhythmDone(tid);
  if (t.type === '节奏-日期型') return markDateInstanceDone(tid);
  t.status = '已完成';
  t.completedAt = new Date().toISOString();
  (t.progressHistory ||= []).push({ date: todayISO(), type: '推进', content: '标记完成' });
  persistTasks();
  renderAll();
  toast('已完成 ✓');
}

/** 节奏-日期型 任务"今日完成":只关闭今天的实例,下次按计划再出现 */
function markDateInstanceDone(tid) {
  const t = State.tasks.find(x => x.id === tid);
  if (!t) return;
  t.lastDoneAt = todayISO();
  t._instanceDueToday = false;
  (t.progressHistory ||= []).push({ date: todayISO(), type: '推进', content: '本次完成' });
  persistTasks();
  renderAll();
  toast('已完成 ✓ — 下次按计划再出现');
}

function markRhythmDone(tid) {
  const t = State.tasks.find(x => x.id === tid);
  if (!t) return;
  t.lastDoneAt = todayISO();
  t._freqDueToday = false;  // 关闭今日实例,下个周期重新出现
  (t.progressHistory ||= []).push({ date: todayISO(), type: '推进', content: '完成一次,周期重置' });
  persistTasks();
  renderAll();
  toast('已完成 ✓ — 下次按周期再出现');
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
          ${(t.reminders && t.reminders.length) ? `<div><b>⏰ 提醒</b> ${t.reminders.map(reminderLabel).join(' / ')}</div>` : ''}
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
    `<label class="person-opt">
      <input type="checkbox" value="${p.id}" ${t.relatedPerson?.includes(p.id)?'checked':''}>
      <span class="person-opt-name">${escapeHtml(p.name)}</span>
      <span class="muted small"> ${p.type}</span>
      <button type="button" class="person-del" data-pid="${p.id}" aria-label="删除">×</button>
    </label>`
  ).join('');

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
        <div class="row">
          <label class="flex1">日期 <input id="ti-due" type="date" value="${t.dueDate||''}"></label>
          <label class="flex1">时间(选填) <input id="ti-due-time" type="time" value="${t.dueTime||''}"></label>
        </div>
        <div class="reminder-section">
          <div class="reminder-label">⏰ 提醒(可多选,留空不提醒)</div>
          <div class="reminder-chips">
            ${REMINDER_PRESETS.map(p => {
              const sel = (t.reminders || []).includes(p.minutes);
              return `<button type="button" class="reminder-chip ${sel?'selected':''}" data-minutes="${p.minutes}">${p.label}</button>`;
            }).join('')}
          </div>
          <div class="muted small reminder-hint">⚠️ 仅"日期+时间"都填了才会触发推送</div>
        </div>
      </div>

      <div id="ti-freq-wrap" ${isFreq?'':'hidden'}>
        <label>周期
          <select id="ti-period">
            ${['每天','每周','每月','每季','自定义天数'].map(x =>
              `<option ${t.frequencyPeriod===x?'selected':''}>${x}</option>`).join('')}
          </select>
        </label>
        <div id="ti-freq-weekday-wrap" ${t.frequencyPeriod==='每周'?'':'hidden'}>
          <label>每周几提醒
            <select id="ti-freq-weekday">
              ${['周日','周一','周二','周三','周四','周五','周六'].map((w,i)=>
                `<option value="${i}" ${(t.weekday??1)===i?'selected':''}>${w}</option>`).join('')}
            </select>
          </label>
        </div>
        <div id="ti-freq-monthday-wrap" ${t.frequencyPeriod==='每月'?'':'hidden'}>
          <label>每月几号提醒(1-28)
            <input id="ti-freq-monthday" type="number" min="1" max="28" value="${t.monthDay||1}">
          </label>
        </div>
        <div id="ti-freq-quarter-wrap" ${t.frequencyPeriod==='每季'?'':'hidden'}>
          <label>每季末几号提醒(20-28,3/6/9/12 月)
            <input id="ti-freq-quarterday" type="number" min="20" max="28" value="${t.quarterDay||28}">
          </label>
        </div>
        <div id="ti-custom-days-wrap" ${t.frequencyPeriod==='自定义天数'?'':'hidden'}>
          <label>每隔多少天 <input id="ti-custom-days" type="number" min="1" value="${t.frequencyCustomDays||7}"></label>
        </div>
        <div class="muted small">设置后任务会在到期那一天自动出现在"今日"列表。完成后下个周期再出现。</div>
      </div>

      <div id="ti-date-wrap" ${isDate?'':'hidden'}>
        <label>日期模式
          <select id="ti-pattern">
            ${['每天','每周某日','每月某日','每季末'].map(x =>
              `<option ${t.datePattern===x?'selected':''}>${x}</option>`).join('')}
          </select>
        </label>
        <div id="ti-pattern-weekday-wrap" ${t.datePattern==='每周某日'?'':'hidden'}>
          <label>每周几 <select id="ti-weekday">
            ${['周日','周一','周二','周三','周四','周五','周六'].map((w,i)=>
              `<option value="${i}" ${t.weekday===i?'selected':''}>${w}</option>`).join('')}
          </select></label>
        </div>
        <div id="ti-pattern-monthday-wrap" ${t.datePattern==='每月某日'?'':'hidden'}>
          <label>每月几号 <input id="ti-monthday" type="number" min="1" max="31" value="${t.monthDay||1}"></label>
        </div>
        <label>时间 <input id="ti-time" type="time" value="${t.timeOfDay||'09:00'}"></label>
        <label class="check-row">
          <input type="checkbox" id="ti-video" ${t.autoVideoOnTrip?'checked':''}>
          出差期间自动改视频
        </label>
        <div class="muted small">"节奏-日期型"会按规则自动出现在"今日"列表。完成后下次按计划再出现。</div>
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

      <details><summary>关联人(可多选,可新增/删除)</summary>
        <div class="person-add-row">
          <input id="ti-new-person-name" placeholder="新人物名字..." />
          <select id="ti-new-person-type">
            <option value="客户">客户</option>
            <option value="团队">团队</option>
            <option value="行业">行业</option>
            <option value="个人">个人</option>
          </select>
          <button type="button" id="ti-new-person-add" class="btn btn-mini">+ 添加</button>
        </div>
        <div class="person-grid" id="ti-person-grid">${personOpts}</div>
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

  // 频率型周期切换 → 显示对应的输入框
  $('#ti-period')?.addEventListener('change', e => {
    const v = e.target.value;
    $('#ti-freq-weekday-wrap').hidden  = v !== '每周';
    $('#ti-freq-monthday-wrap').hidden = v !== '每月';
    $('#ti-freq-quarter-wrap').hidden  = v !== '每季';
    $('#ti-custom-days-wrap').hidden   = v !== '自定义天数';
  });

  // 日期型 模式切换 → 显示对应的"周几"或"几号"输入
  $('#ti-pattern')?.addEventListener('change', e => {
    const v = e.target.value;
    $('#ti-pattern-weekday-wrap').hidden = v !== '每周某日';
    $('#ti-pattern-monthday-wrap').hidden = v !== '每月某日';
  });

  // 提醒 chip 多选切换
  $$('.reminder-chip', $('#modal-root')).forEach(chip => {
    chip.onclick = (e) => {
      e.preventDefault();
      chip.classList.toggle('selected');
    };
  });

  // 关联人:新增人物 + 删除人物
  bindPersonManagement();
}

function bindPersonManagement() {
  $('#ti-new-person-add')?.addEventListener('click', () => {
    const name = $('#ti-new-person-name').value.trim();
    const type = $('#ti-new-person-type').value;
    if (!name) { toast('请输入名字'); return; }
    if (State.persons.some(p => p.name === name)) {
      toast('已存在同名人物');
      return;
    }
    const p = {
      id: 'p-' + Date.now() + Math.random().toString(36).slice(2, 6),
      name, type,
    };
    State.persons.push(p);
    persistPersons();
    $('#ti-new-person-name').value = '';
    refreshPersonGrid();
    toast(`已添加 ${name}`);
  });
  // 回车也能添加
  $('#ti-new-person-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('#ti-new-person-add').click(); }
  });

  // 每个人物旁的 × 删除按钮
  bindPersonDeleteButtons();
}

function bindPersonDeleteButtons() {
  $$('.person-del', $('#modal-root')).forEach(b => {
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pid = b.dataset.pid;
      const p = State.persons.find(x => x.id === pid);
      if (!p) return;
      const usedBy = State.tasks.filter(t => t.relatedPerson?.includes(pid));
      if (usedBy.length > 0) {
        if (!confirm(`${p.name} 还在 ${usedBy.length} 个任务里使用,确定删除?\n这些任务里的关联会被自动清除。`)) return;
        usedBy.forEach(t => { t.relatedPerson = t.relatedPerson.filter(id => id !== pid); });
        persistTasks();
      } else {
        if (!confirm(`确定删除 "${p.name}"?`)) return;
      }
      State.persons = State.persons.filter(x => x.id !== pid);
      persistPersons();
      refreshPersonGrid();
      toast('已删除');
    };
  });
}

function refreshPersonGrid() {
  const grid = $('#ti-person-grid');
  if (!grid) return;
  // 保留之前已勾选的状态
  const checkedIds = new Set(
    $$('input[type="checkbox"]', grid).filter(i => i.checked).map(i => i.value)
  );
  grid.innerHTML = State.persons.map(p =>
    `<label class="person-opt">
      <input type="checkbox" value="${p.id}" ${checkedIds.has(p.id) ? 'checked' : ''}>
      <span class="person-opt-name">${escapeHtml(p.name)}</span>
      <span class="muted small"> ${p.type}</span>
      <button type="button" class="person-del" data-pid="${p.id}" aria-label="删除">×</button>
    </label>`
  ).join('');
  bindPersonDeleteButtons();
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
    // 根据周期保存对应的具体日字段
    if (t.frequencyPeriod === '每周') {
      t.weekday = +$('#ti-freq-weekday').value;
      delete t.monthDay; delete t.quarterDay; delete t.frequencyCustomDays;
    } else if (t.frequencyPeriod === '每月') {
      t.monthDay = Math.min(28, Math.max(1, +$('#ti-freq-monthday').value || 1));
      delete t.weekday; delete t.quarterDay; delete t.frequencyCustomDays;
    } else if (t.frequencyPeriod === '每季') {
      t.quarterDay = Math.min(28, Math.max(20, +$('#ti-freq-quarterday').value || 28));
      delete t.weekday; delete t.monthDay; delete t.frequencyCustomDays;
    } else if (t.frequencyPeriod === '自定义天数') {
      t.frequencyCustomDays = Math.max(1, +$('#ti-custom-days').value || 7);
      delete t.weekday; delete t.monthDay; delete t.quarterDay;
    } else { // 每天
      delete t.weekday; delete t.monthDay; delete t.quarterDay; delete t.frequencyCustomDays;
    }
    t.overdueMultiplier = 1.5;
    if (!t.lastDoneAt) t.lastDoneAt = todayISO();
    delete t.dueDate; delete t.dueTime;
  } else if (t.type === '节奏-日期型') {
    t.datePattern = $('#ti-pattern').value;
    t.weekday = +$('#ti-weekday').value;
    t.monthDay = +$('#ti-monthday').value;
    t.timeOfDay = $('#ti-time').value;
    t.autoVideoOnTrip = $('#ti-video').checked;
    delete t.dueDate; delete t.dueTime;
  } else {
    t.dueDate = $('#ti-due').value || null;
    t.dueTime = $('#ti-due-time').value || null;
  }

  // 计算未加密的 dueAt 时间戳(供 Cloud Function 服务端定时扫描)
  if (t.dueDate && t.dueTime) {
    t.dueAt = new Date(`${t.dueDate}T${t.dueTime}:00`).toISOString();
  } else {
    delete t.dueAt;
  }

  // 收集提醒选择(只对单点任务且有时间的才有意义)
  const selectedChips = $$('.reminder-chip.selected', $('#modal-root'));
  if (selectedChips.length && t.dueAt) {
    t.reminders = selectedChips.map(c => +c.dataset.minutes).sort((a, b) => a - b);
    const dueMs = new Date(t.dueAt).getTime();
    t.reminderTimes = t.reminders.map(min => new Date(dueMs - min * 60000).toISOString());
    // nextReminderAt = 最近的尚未发生的提醒
    const now = Date.now();
    const futureMs = t.reminderTimes
      .map(s => new Date(s).getTime())
      .filter(ts => ts > now);
    t.nextReminderAt = futureMs.length
      ? new Date(Math.min(...futureMs)).toISOString()
      : null;
  } else {
    delete t.reminders;
    delete t.reminderTimes;
    delete t.nextReminderAt;
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
  else if (tab === 'customer') renderCustomerView();
  else if (tab === 'team') renderTeamView();
  else if (tab === 'rhythm') renderRhythm();
  else if (tab === 'trip') renderTrip();
  else if (tab === 'exhibition') renderExhibitions();
  else if (tab === 'notes') renderNotes();
  // 每次切换/渲染任何视图都同步徽章
  updateBadges();
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
  if (badge) {
    if (todayN > 0) { badge.hidden = false; badge.textContent = todayN; }
    else { badge.hidden = true; }
  }

  // iPhone / 桌面主屏图标徽章(W3C Badging API)
  // 失败原因记录到 window._badgeError,便于诊断
  if ('setAppBadge' in navigator) {
    const op = todayN > 0
      ? navigator.setAppBadge(todayN)
      : navigator.clearAppBadge();
    op.then(() => {
      window._badgeError = null;
    }).catch(err => {
      window._badgeError = err?.message || String(err);
      console.warn('[Badge] setAppBadge 失败 — 通常是因为通知权限未授权:', err);
    });
  } else {
    window._badgeError = 'API 不支持(浏览器太旧)';
  }
}

/** 首次在 PWA 模式打开时,如果通知权限从未授权过,弹一个温和提示
 *  让用户选择是否开启。点了"开启"才能在用户手势下触发 iOS 系统授权框。
 */
function maybeOfferNotificationOptIn() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;  // 已 granted/denied 都不弹
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true;
  if (!isStandalone) return;  // 必须 PWA 主屏模式

  // 不要太频繁,同一天只弹一次
  const today = todayISO();
  const shownAt = Store.load('amanda.notifOptInShownAt', '');
  if (shownAt === today) return;
  Store.save('amanda.notifOptInShownAt', today);

  const banner = document.createElement('div');
  banner.id = 'notif-optin';
  banner.innerHTML = `
    <span>🔔 开启通知后,主屏图标将显示待办数字</span>
    <button id="noi-yes">开启</button>
    <button id="noi-no">稍后</button>
  `;
  document.body.appendChild(banner);
  banner.querySelector('#noi-yes').onclick = async () => {
    banner.remove();
    try {
      const p = await Notification.requestPermission();
      if (p === 'granted') {
        updateBadges();
        // 也注册推送订阅(如果 Firebase 已就位)
        window.AmandaFirebase?.subscribePush?.().catch(() => {});
        toast('已授权 — 主屏图标会显示徽章 ✓');
      } else {
        toast('未授权 — 之后可在设置里重试');
      }
    } catch (e) { toast('授权请求失败:' + e.message); }
  };
  banner.querySelector('#noi-no').onclick = () => banner.remove();
}

/** 工作日打开 App 弹"今日侧重"提示卡(每天只弹一次)*/
function showDailyFocusReminder() {
  const today = todayISO();
  const shownAt = Store.load(KEY.dailyFocusShownAt, '');
  if (shownAt === today) return;
  const dow = new Date(today).getDay();
  const info = DAILY_FOCUS[dow];
  if (!info) return;  // 周日不弹
  // 避免重复弹
  if (document.getElementById('daily-focus-card')) return;

  const dayNames = ['周日','周一','周二','周三','周四','周五','周六'];
  const backdrop = document.createElement('div');
  backdrop.id = 'daily-focus-backdrop';
  const card = document.createElement('div');
  card.id = 'daily-focus-card';
  card.innerHTML = `
    <div class="dfc-emoji">${info.emoji}</div>
    <div class="dfc-day">${dayNames[dow]}</div>
    <div class="dfc-title">今日侧重 · <span class="dfc-focus">${info.focus}</span></div>
    <div class="dfc-sub">${info.sub}</div>
    <button class="btn btn-primary btn-block" id="dfc-ok">明白了 ✓</button>
  `;
  document.body.appendChild(backdrop);
  document.body.appendChild(card);
  const dismiss = () => {
    Store.save(KEY.dailyFocusShownAt, today);
    card.remove();
    backdrop.remove();
  };
  card.querySelector('#dfc-ok').onclick = dismiss;
  backdrop.onclick = dismiss;
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

  // 在顶部 appbar 右下角显示版本号(放在齿轮按钮下方)
  let verEl = document.getElementById('app-ver-tag');
  if (!verEl) {
    verEl = document.createElement('div');
    verEl.id = 'app-ver-tag';
    verEl.textContent = APP_VERSION;
    $('#appbar')?.appendChild(verEl);
  }
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
      <button class="btn btn-block" id="set-dedupe-tasks" style="margin-top:8px">🧹 清理重复任务</button>
      <button class="btn btn-block" id="set-dedupe-notes" style="margin-top:6px">🧹 清理重复笔记</button>
      <button class="btn btn-block btn-danger" id="set-reset" style="margin-top:8px">重置本地数据(重新预填种子)</button>

      <h3 style="margin-top:18px">关于 / 版本</h3>
      <div class="version-row">
        <div>
          <div><b>App 版本</b> · <span id="set-app-ver">${APP_VERSION}</span></div>
          <div class="muted small">SW 缓存版本 · <span id="set-sw-ver">读取中…</span></div>
        </div>
        <button class="btn btn-mini" id="set-check-update">↻ 检查更新</button>
      </div>
      <div class="muted small" style="margin-top:6px">单人个人任务工具 · 数据存于浏览器/Firebase</div>
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
  $('#set-dedupe-tasks').onclick = dedupeTasks;
  $('#set-dedupe-notes').onclick = dedupeNotes;

  // 读 SW 当前版本号
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => {
      const el = document.getElementById('set-sw-ver');
      if (el) el.textContent = e.data?.version || '(未知)';
    };
    navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    // 超时回落
    setTimeout(() => {
      const el = document.getElementById('set-sw-ver');
      if (el && el.textContent === '读取中…') el.textContent = '(超时,可能无 SW)';
    }, 2000);
  } else {
    const el = document.getElementById('set-sw-ver');
    if (el) el.textContent = '(Service Worker 未运行)';
  }

  // 手动检查更新
  document.getElementById('set-check-update')?.addEventListener('click', async () => {
    const btn = document.getElementById('set-check-update');
    btn.textContent = '检查中…'; btn.disabled = true;
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) { toast('Service Worker 未注册'); return; }
      await reg.update();
      // 看看有没有等待中的新版本
      if (reg.waiting) {
        toast('发现新版本,3 秒后自动应用…');
        setTimeout(() => reg.waiting.postMessage({ type: 'SKIP_WAITING' }), 3000);
      } else if (reg.installing) {
        toast('正在下载新版本…稍候');
      } else {
        toast('已是最新版本 ✓');
      }
    } catch (e) {
      toast('检查失败:' + e.message);
    } finally {
      btn.textContent = '↻ 检查更新'; btn.disabled = false;
    }
  });
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return alert('当前浏览器不支持通知');

  // 已授权 → 跑一次完整诊断 + 同步推送订阅
  if (Notification.permission === 'granted') {
    if (window.AmandaFirebase?.ready) {
      const r = await window.AmandaFirebase.subscribePush();
      if (r.ok) toast('推送订阅已就绪');
    }
    runBadgeDiagnostic();
    return;
  }

  // 未授权 → 请求授权
  const p = await Notification.requestPermission();
  if (p === 'granted') {
    new Notification('任务指挥台', { body: '通知已开启,正在配置推送…' });
    if (window.AmandaFirebase?.ready) {
      const r = await window.AmandaFirebase.subscribePush();
      if (r.ok) toast('推送订阅已就绪 — Cloud Function 部署后任务到期自动提醒');
    }
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

  // 给出具体修复指引
  let advice = '';
  if (notifPerm !== 'granted') {
    advice = '👉 通知权限未授权 — 这就是徽章不显示的原因。\n' +
             '   解决:点 "授权通知" 按钮 → iOS 弹框时点"允许"。\n' +
             '   如果"已拒绝"无法重新弹框,需要删除主屏图标 + 清 Safari 网站数据后重新添加。';
  } else if (!isStandalone) {
    advice = '👉 你不是从主屏图标启动的 App — iOS 必须从主屏启动才能给 PWA 显示徽章。\n' +
             '   解决:退出 App,从主屏点向日葵图标重新打开。';
  } else if (!hasBadgeAPI) {
    advice = '👉 当前浏览器不支持 setAppBadge API — iOS Safari 需要 ≥16.4。';
  } else if (window._badgeError) {
    advice = '👉 setAppBadge 调用失败: ' + window._badgeError + '\n' +
             '   通常是 iOS 设置 → 通知 → 任务指挥台 → "标记" 开关被关闭,打开它。';
  } else {
    advice = '✓ 所有条件都满足。如果主屏仍无红点,试:\n' +
             '   1. 锁屏一次再亮屏\n' +
             '   2. iOS 设置 → 通知 → 任务指挥台 → "标记"开关确保是开的\n' +
             '   3. 重启 iPhone(iOS 偶尔出 bug)';
  }

  const report = `
🔍 主屏徽章诊断
━━━━━━━━━━━━━━━━━━━━━━━

iOS 设备: ${isIOS ? '是' : '否'}
iOS 版本: ${iosVer} ${isIOS && iosMatch ? (parseInt(iosMatch[1]) > 16 || (parseInt(iosMatch[1]) === 16 && parseInt(iosMatch[2]) >= 4) ? '✓' : '✗ 需 ≥ 16.4') : ''}

PWA 主屏模式: ${isStandalone ? '✓ 是' : '✗ 否(必须从主屏图标启动)'}
setAppBadge API: ${hasBadgeAPI ? '✓ 浏览器支持' : '✗ 不支持'}
通知权限: ${notifPerm === 'granted' ? '✓ 已授权' : (notifPerm === 'denied' ? '✗ 已拒绝' : '○ 未授权(从未询问)')}

设置徽章测试(应显示99):
  ${setBadgeResult}

━━━━━━━━━━━━━━━━━━━━━━━
${advice}
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

/** 查找重复:把 title+dueDate+domain 完全相同的任务视为重复 */
function findTaskDuplicates() {
  const seen = new Map();
  for (const t of State.tasks) {
    const key = (t.title || '') + '|' + (t.dueDate || '') + '|' + (t.domain || '') + '|' + (t.type || '');
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(t);
  }
  const groups = [];
  for (const [, group] of seen) {
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

/** 清理重复:每组保留一条(优先保留有最多推进历史的),其余删除 */
function dedupeTasks() {
  const groups = findTaskDuplicates();
  if (!groups.length) {
    toast('没有发现重复任务');
    return;
  }
  const totalExtras = groups.reduce((sum, g) => sum + g.length - 1, 0);
  if (!confirm(`发现 ${groups.length} 组重复(共 ${totalExtras} 条多余)。\n每组保留一条(优先保留有推进历史的),其余删除。\n继续?`)) return;

  const toDelete = [];
  for (const group of groups) {
    // 按"已完成的优先 → 推进历史多的优先 → createdAt 早的优先"排序;保留第1条
    const sorted = [...group].sort((a, b) => {
      const aDone = a.status === '已完成' ? 1 : 0;
      const bDone = b.status === '已完成' ? 1 : 0;
      if (aDone !== bDone) return bDone - aDone;
      const ah = a.progressHistory?.length || 0;
      const bh = b.progressHistory?.length || 0;
      if (ah !== bh) return bh - ah;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
    for (let i = 1; i < sorted.length; i++) {
      toDelete.push(sorted[i].id);
    }
  }

  State.tasks = State.tasks.filter(t => !toDelete.includes(t.id));

  // 把删除推到云端(同步到其他设备)
  if (window.AmandaFirebase?.ready) {
    for (const id of toDelete) {
      window.AmandaFirebase.deleteItem('tasks', id);
    }
  }

  persistTasks();
  renderAll();
  toast(`✓ 已清理 ${toDelete.length} 条重复`);
}

/** 同样的清理,针对笔记 */
function dedupeNotes() {
  const seen = new Map();
  for (const n of State.notes) {
    const key = (n.title || '') + '|' + (n.content || '');
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(n);
  }
  const dupes = [];
  for (const [, group] of seen) {
    if (group.length > 1) {
      const sorted = [...group].sort((a, b) =>
        (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
      for (let i = 1; i < sorted.length; i++) dupes.push(sorted[i].id);
    }
  }
  if (!dupes.length) { toast('没有重复笔记'); return; }
  if (!confirm(`发现 ${dupes.length} 条重复笔记。删除?`)) return;
  State.notes = State.notes.filter(n => !dupes.includes(n.id));
  if (window.AmandaFirebase?.ready) {
    for (const id of dupes) window.AmandaFirebase.deleteItem('notes', id);
  }
  persistNotes(); renderAll();
  toast(`✓ 已清理 ${dupes.length} 条重复笔记`);
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

  // FAB 新建(根据当前 Tab 决定新建什么)
  $('#fab').onclick = () => {
    if (State.ui.tab === 'notes') openNoteModal();
    else if (State.ui.tab === 'trip') openTripModal();
    else if (State.ui.tab === 'exhibition') openExhibitionModal();
    else openTaskModal();
  };

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

  // 切回前台:刷新徽章 + 从云端拉一次最新数据
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    // 1. 立刻刷新主屏徽章(不依赖 Firebase 状态)
    updateBadges();
    // 2. 如果 Firebase 在线,拉最新数据
    if (window.AmandaFirebase?.ready) {
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

  // 工作日提示卡(每天弹一次)— 延迟 800ms 避开锁屏
  setTimeout(showDailyFocusReminder, 800);

  // 首次在 iPhone PWA 打开时,提示开启通知(为了主屏徽章)
  setTimeout(maybeOfferNotificationOptIn, 1500);
}

document.addEventListener('DOMContentLoaded', init);

})();
