/* =====================================================================
 * Amanda 任务指挥台 — Cloud Function 推送
 *
 * 工作机制:
 *  - 每 5 分钟跑一次 sendTaskReminders 函数
 *  - 扫描所有用户的任务,找 dueAt 在 [now, now+10min] 且未推过提醒的
 *  - 给该用户的所有 pushSubs 发通用 web push 通知
 *  - 推送内容是匿名的(只显示时间,不含任务标题)— 任务详情仍加密存储
 *
 * 隐私保证:
 *  - 服务端只能查到任务的"何时到期"(dueAt 时间戳)
 *  - 任务标题/客户名/备注 全部加密(iv/ct),服务端读不到
 *  - 推送内容是通用文案,不会经过 Apple/Google 推送服务器泄露详情
 * ===================================================================== */

const functions = require('firebase-functions/v2');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp();
const db = admin.firestore();

// VAPID 密钥(部署前必须先用 setVapidKeys 命令配置环境变量)
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || functions.params.defineString('VAPID_PUBLIC_KEY').value();
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || functions.params.defineString('VAPID_PRIVATE_KEY').value();
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     || 'mailto:amandadong99@gmail.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

/* ---------------------------------------------------------------------
 * 定时函数:每 5 分钟扫一次,推送即将到期的任务
 * ------------------------------------------------------------------ */
exports.sendTaskReminders = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Shanghai',
    region: 'asia-east1',
    memory: '256MiB',
  },
  async (event) => {
    const now = Date.now();
    const lookAhead = 10 * 60 * 1000;  // 提前 10 分钟开始通知
    const lowerBound = now;
    const upperBound = now + lookAhead;

    logger.info(`扫描时间窗:${new Date(lowerBound).toISOString()} ~ ${new Date(upperBound).toISOString()}`);

    // 用 collection group 跨用户扫所有 tasks
    const snap = await db.collectionGroup('tasks')
      .where('dueAtTs', '>=', lowerBound)
      .where('dueAtTs', '<=', upperBound)
      .get();

    if (snap.empty) {
      logger.info('无即将到期任务');
      return;
    }

    logger.info(`发现 ${snap.size} 条即将到期的任务`);

    let sent = 0, failed = 0, skipped = 0;
    for (const taskDoc of snap.docs) {
      // 路径形如 /users/{userId}/tasks/{taskId}
      const segments = taskDoc.ref.path.split('/');
      const userId = segments[1];
      const taskId = segments[3];
      const data = taskDoc.data();

      // 防重发:已经推过的任务就跳过
      if (data._notifiedAt) { skipped++; continue; }

      // 推送 payload:
      // - 如果任务有加密标题(titleEnc),把它原样塞进 payload,SW 端本地解密后显示真实标题
      // - Apple/Google 推送服务器、Cloud Function 自身只看到密文
      const dueDate = new Date(data.dueAt);
      const localTime = dueDate.toLocaleTimeString('zh-CN', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai',
      });
      const payloadObj = {
        title: '📋 任务即将到期',
        body: `${localTime} 有任务 — 打开 App 查看详情`,
        tag: 'task-' + taskId,
        url: './index.html#today',
        urgent: true,
        dueTime: localTime,
      };
      if (data.titleEnc && data.titleEnc.iv && data.titleEnc.ct) {
        payloadObj.titleEnc = data.titleEnc;
      }
      const payload = JSON.stringify(payloadObj);

      // 找该用户的所有 pushSubs
      const subsSnap = await db.collection('users').doc(userId)
        .collection('pushSubs').get();
      if (subsSnap.empty) {
        logger.info(`用户 ${userId.slice(0, 8)} 没有订阅设备,跳过`);
        skipped++;
        continue;
      }

      let userSent = 0;
      for (const subDoc of subsSnap.docs) {
        const sub = subDoc.data();
        const subscription = {
          endpoint: sub.endpoint,
          keys: sub.keys,
        };
        try {
          await webpush.sendNotification(subscription, payload);
          userSent++;
        } catch (err) {
          logger.warn(`推送失败 ${userId.slice(0,8)}/${subDoc.id.slice(0,8)}:`, err.statusCode, err.body);
          // 410 Gone 表示订阅已失效,清理掉
          if (err.statusCode === 410 || err.statusCode === 404) {
            await subDoc.ref.delete().catch(() => {});
          }
          failed++;
        }
      }

      if (userSent > 0) {
        // 标记已推送,避免下次循环重发
        await taskDoc.ref.update({ _notifiedAt: now }).catch(e =>
          logger.warn('标记推送时间失败:', e.message));
        sent++;
      }
    }

    logger.info(`到期推送完成 — 推送任务数:${sent}, 跳过:${skipped}, 失败:${failed}`);

    // === 第二轮:扫描自定义提醒(reminderTimes / nextReminderAt)===
    const reminderSnap = await db.collectionGroup('tasks')
      .where('nextReminderAtTs', '>=', lowerBound)
      .where('nextReminderAtTs', '<=', upperBound)
      .get();

    if (reminderSnap.empty) {
      logger.info('无即将触发的自定义提醒');
      return;
    }
    logger.info(`发现 ${reminderSnap.size} 条即将触发的自定义提醒`);

    let rSent = 0, rFailed = 0;
    for (const taskDoc of reminderSnap.docs) {
      const segments = taskDoc.ref.path.split('/');
      const userId = segments[1];
      const taskId = segments[3];
      const data = taskDoc.data();

      // 找出本次触发的提醒(reminderTime 落在当前窗口)
      const triggered = (data.reminderTimes || []).find(s => {
        const ts = new Date(s).getTime();
        return ts >= lowerBound && ts <= upperBound;
      });
      if (!triggered) { rSent--; continue; }

      // 计算"提前多久"文案
      const dueAtTs = data.dueAtTs || (data.dueAt ? new Date(data.dueAt).getTime() : 0);
      const offsetMin = Math.round((dueAtTs - new Date(triggered).getTime()) / 60000);
      let offsetText = `${offsetMin} 分钟前`;
      if (offsetMin >= 10080 && offsetMin % 10080 === 0) offsetText = `${offsetMin/10080} 周前`;
      else if (offsetMin >= 1440 && offsetMin % 1440 === 0) offsetText = `${offsetMin/1440} 天前`;
      else if (offsetMin >= 60 && offsetMin % 60 === 0) offsetText = `${offsetMin/60} 小时前`;

      const dueDate = new Date(data.dueAt);
      const localTime = dueDate.toLocaleTimeString('zh-CN', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai',
      });
      const payloadObj = {
        title: `⏰ ${offsetText}提醒`,
        body: `任务将于 ${localTime} 到期 — 打开 App 查看`,
        tag: 'reminder-' + taskId + '-' + offsetMin,
        url: './index.html#today',
        urgent: true,
        dueTime: localTime,
      };
      if (data.titleEnc && data.titleEnc.iv && data.titleEnc.ct) {
        payloadObj.titleEnc = data.titleEnc;
      }
      const payload = JSON.stringify(payloadObj);

      // 找该用户订阅
      const subsSnap = await db.collection('users').doc(userId).collection('pushSubs').get();
      let userSent = 0;
      for (const subDoc of subsSnap.docs) {
        const sub = subDoc.data();
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            payload
          );
          userSent++;
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await subDoc.ref.delete().catch(() => {});
          }
          rFailed++;
        }
      }

      // 更新 nextReminderAt → 下一个未触发的提醒(在 upperBound 之后)
      const futureReminders = (data.reminderTimes || [])
        .filter(s => new Date(s).getTime() > upperBound);
      const next = futureReminders.length
        ? futureReminders.reduce((a, b) =>
            new Date(a).getTime() < new Date(b).getTime() ? a : b)
        : null;
      await taskDoc.ref.update({
        nextReminderAt: next,
        nextReminderAtTs: next ? new Date(next).getTime() : null,
      }).catch(e => logger.warn('更新 nextReminderAt 失败:', e.message));

      if (userSent > 0) rSent++;
    }
    logger.info(`提醒推送完成 — 触发:${rSent}, 失败:${rFailed}`);
  }
);

/* ---------------------------------------------------------------------
 * HTTP 函数(可选):手动测试推送 — 部署后可用浏览器或 curl 触发
 *  GET https://<region>-<project>.cloudfunctions.net/testPush?userId=xxx
 * ------------------------------------------------------------------ */
const { onRequest } = require('firebase-functions/v2/https');
exports.testPush = onRequest(
  { region: 'asia-east1', cors: true },
  async (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).send('Missing userId query param');

    const subsSnap = await db.collection('users').doc(userId).collection('pushSubs').get();
    if (subsSnap.empty) return res.send(`用户 ${userId} 无订阅设备`);

    const payload = JSON.stringify({
      title: '🌻 测试推送',
      body: '如果你看到这条,推送通道工作正常 ✓',
      tag: 'test-' + Date.now(),
      url: './index.html',
    });

    let sent = 0, failed = 0;
    for (const subDoc of subsSnap.docs) {
      try {
        await webpush.sendNotification({
          endpoint: subDoc.data().endpoint,
          keys: subDoc.data().keys,
        }, payload);
        sent++;
      } catch (err) {
        failed++;
        logger.warn('test push fail:', err.statusCode);
      }
    }
    res.send(`推送已发送 — 成功 ${sent}, 失败 ${failed}`);
  }
);
