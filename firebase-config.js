/* =====================================================================
 * Firebase Firestore 实时同步 + 端到端加密
 *
 * 安全模型:
 *   1. 用户输入"工作密钥"(passphrase) — 永远不上传任何远端
 *   2. 浏览器用 PBKDF2(200000 轮)从密钥派生:
 *      - userId      : 作为 Firestore 路径段(/users/{userId}/...)
 *      - encryptionKey: AES-GCM 256位 加密钥匙
 *   3. 每条数据写入 Firestore 之前先用 AES-GCM 加密
 *   4. 拉取后在本地解密,密钥不正确 → 解密失败 → 锁屏提示
 *
 * 这意味着:Firebase 控制台、Google 员工、Firestore 数据库的任何访问者
 * 只能看到密文。能看到内容的只有持有"工作密钥"的浏览器。
 *
 * 安全规则(Firebase Console 粘贴):
 *   rules_version = '2';
 *   service cloud.firestore {
 *     match /databases/{database}/documents {
 *       match /users/{userId}/{coll=**} {
 *         allow read, write: if true;
 *       }
 *     }
 *   }
 * ===================================================================== */

window.AmandaFirebase = {

  /* === 用户配置区(改这里)=== */
  ENABLED: true,
  config: {
    apiKey: "AIzaSyDgvuoNtTm1UCQhVfKmhlnUwDLIaR88Eiw",
    authDomain: "amanda-tasks.firebaseapp.com",
    projectId: "amanda-tasks",
    storageBucket: "amanda-tasks.firebasestorage.app",
    messagingSenderId: "200292789463",
    appId: "1:200292789463:web:131697b8d7a87fe82e1492",
  },
  // VAPID 公钥(部署 Cloud Function 时会生成,这里先填占位符,部署后替换)
  // 详见 functions/README.md
  VAPID_PUBLIC_KEY: "",
  /* ======================== */

  // 内部状态
  app: null,
  db: null,
  ready: false,
  userId: null,
  cryptoKey: null,
  unsubs: [],
  applyingRemote: false,
  _modules: null,
  _firstSyncDone: false,
  collMap: {
    tasks: 'tasks', persons: 'persons',
    trips: 'trips', templates: 'templates',
    notes: 'notes', fuzzyPlans: 'fuzzyPlans',
  },

  /* ============= 加密层(Web Crypto API)============= */
  Crypto: {
    KEY_SALT: 'amanda-tasks-v1-key-salt-7f3k',
    UID_SALT: 'amanda-tasks-v1-uid-salt-2x9c',
    ITER: 200000,

    async _material(passphrase) {
      return await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(passphrase),
        { name: 'PBKDF2' }, false, ['deriveKey', 'deriveBits']
      );
    },
    async deriveKey(passphrase) {
      const m = await this._material(passphrase);
      return await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: new TextEncoder().encode(this.KEY_SALT),
          iterations: this.ITER, hash: 'SHA-256' },
        m, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
      );
    },
    async deriveUserId(passphrase) {
      const m = await this._material(passphrase);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: new TextEncoder().encode(this.UID_SALT),
          iterations: 100000, hash: 'SHA-256' },
        m, 192   // 24 bytes → 32 字符 base64url,用作路径
      );
      return this._b64u(new Uint8Array(bits));
    },
    async encrypt(key, plaintext) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)
      );
      return { iv: this._b64(iv), ct: this._b64(new Uint8Array(ct)) };
    },
    async decrypt(key, { iv, ct }) {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: this._unb64(iv) }, key, this._unb64(ct)
      );
      return new TextDecoder().decode(pt);
    },
    _b64(bytes) { let s=''; for (const b of bytes) s+=String.fromCharCode(b); return btoa(s); },
    _b64u(bytes) { return this._b64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); },
    _unb64(s) { s = s.replace(/-/g,'+').replace(/_/g,'/');
      while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); },
  },

  /* ============= Firebase 初始化与同步 ============= */
  async init(passphraseOverride) {
    if (!this.ENABLED) return { ok: false, reason: 'disabled' };
    if (!this.config.projectId) {
      console.warn('[Sync] firebase-config.js 未填 projectId,跳过');
      return { ok: false, reason: 'no-config' };
    }

    let pass = passphraseOverride;
    if (!pass) {
      let raw = localStorage.getItem('amanda.workKey');
      if (raw && raw.startsWith('"')) { try { raw = JSON.parse(raw); } catch {} }
      pass = raw;
    }
    if (!pass) return { ok: false, reason: 'no-key' };

    try {
      // 派生密钥与 userId
      this.cryptoKey = await this.Crypto.deriveKey(pass);
      this.userId = await this.Crypto.deriveUserId(pass);

      // 把加密钥也存到 IndexedDB,Service Worker 收到 push 时能用它解密标题
      await this._storeCryptoKeyInIDB(this.cryptoKey, this.userId);

      // 加载 Firebase SDK
      const [appMod, fsMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'),
      ]);
      this._modules = { ...appMod, ...fsMod };
      this.app = this._modules.initializeApp(this.config);
      this.db = this._modules.getFirestore(this.app);

      try { await this._modules.enableIndexedDbPersistence(this.db); }
      catch (err) {
        if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
          console.warn('[Sync] 离线持久化:', err.code);
        }
      }

      // 验证密钥:试拉一个文档,能解密 = 密钥正确
      const valid = await this._validateKey();
      if (!valid) {
        this.cryptoKey = null; this.userId = null;
        return { ok: false, reason: 'wrong-key' };
      }

      this.ready = true;
      console.info(`[Sync] ✓ 已连接 (userId=${this.userId.slice(0,8)}...)`);
      await this.pullAndSubscribe();
      this._firstSyncDone = true;
      window.AmandaTasks?.captureSyncSnapshot?.();
      this._showStatus('已连接到云端,数据加密同步中', false);
      return { ok: true };
    } catch (err) {
      console.error('[Sync] 初始化失败:', err);
      this.ready = false;
      return { ok: false, reason: 'init-failed', error: err };
    }
  },

  // 验证密钥:拉一条任意文档尝试解密
  async _validateKey() {
    const { collection, getDocs, query, limit } = this._modules;
    for (const stateKey of Object.keys(this.collMap)) {
      const c = collection(this.db, 'users', this.userId, this.collMap[stateKey]);
      const snap = await getDocs(query(c, limit(1)));
      if (snap.empty) continue;
      const data = snap.docs[0].data();
      if (!data.iv || !data.ct) return true; // 老数据兼容,接纳
      try { await this.Crypto.decrypt(this.cryptoKey, { iv: data.iv, ct: data.ct }); return true; }
      catch { return false; }
    }
    return true; // 远端为空,首次使用
  },

  _coll(stateKey) {
    return this._modules.collection(this.db, 'users', this.userId, this.collMap[stateKey]);
  },
  _doc(stateKey, id) {
    return this._modules.doc(this.db, 'users', this.userId, this.collMap[stateKey], id);
  },

  async pullAndSubscribe() {
    const { getDocs, onSnapshot, waitForPendingWrites } = this._modules;
    const A = window.AmandaTasks;
    if (!A) return;

    // 启动时:先把上一次会话排队的写入(可能因为掉线/退出而没发出去)冲到服务器
    try { await waitForPendingWrites(this.db); }
    catch (e) { console.warn('[Sync] init waitForPendingWrites:', e.message); }

    // 1. 拉取并解密
    for (const stateKey of Object.keys(this.collMap)) {
      const snap = await getDocs(this._coll(stateKey));
      const remoteItems = [];
      for (const d of snap.docs) {
        const data = d.data();
        try {
          if (data.iv && data.ct) {
            const pt = await this.Crypto.decrypt(this.cryptoKey, { iv: data.iv, ct: data.ct });
            remoteItems.push(JSON.parse(pt));
          } else {
            delete data._syncedAt;
            remoteItems.push(data);
          }
        } catch (err) {
          console.warn(`[Sync] 解密失败 ${stateKey}/${d.id}:`, err.message);
        }
      }

      // 按 ID 合并 — 远端有的用远端版本,本地独有的(真正的离线编辑)保留并推送
      const remoteIds = new Set(remoteItems.map(i => i.id));
      const localItems = A.State[stateKey] || [];
      let localOnly = localItems.filter(i => i.id && !remoteIds.has(i.id));

      // ❗ 防重复:如果云端已有数据,过滤掉"看起来像种子"的本地独有项
      // (避免重置后的新种子 + 老云端数据导致重复)
      // 种子的特征:progressHistory 只有 1 条且内容是"系统预填"/"从滴答清单导入"
      if (remoteItems.length > 0 && stateKey === 'tasks') {
        const beforeFilter = localOnly.length;
        localOnly = localOnly.filter(item => {
          const hist = item.progressHistory || [];
          if (hist.length === 0) return true; // 完全没历史:无法判断,保留
          if (hist.length > 1) return true;   // 有多条历史 = 用户用过,保留
          const onlyEntry = hist[0];
          if (onlyEntry.type === '创建' &&
              (onlyEntry.content === '系统预填' || onlyEntry.content === '从滴答清单导入')) {
            return false; // 看起来是种子,过滤掉
          }
          return true;
        });
        if (beforeFilter !== localOnly.length) {
          console.info(`[Sync] 过滤掉 ${beforeFilter - localOnly.length} 条疑似种子任务,防止重复`);
        }
      }

      if (remoteItems.length > 0 || localOnly.length > 0) {
        A.State[stateKey] = [...remoteItems, ...localOnly];
        A.Store.save(A.KEY[stateKey], A.State[stateKey]);
        console.info(`[Sync] 合并 ${stateKey}: 远端 ${remoteItems.length} + 本地独有 ${localOnly.length}`);

        for (const item of localOnly) {
          try { await this._setEncrypted(stateKey, item); }
          catch (e) { console.warn(`[Sync] 推 ${stateKey}/${item.id} 失败:`, e.message); }
        }
      } else if (localItems.length > 0) {
        // 远端为空 + 本地有数据 → 首次上传
        for (const item of localItems) {
          try { await this._setEncrypted(stateKey, item); } catch {}
        }
        console.info(`[Sync] 首次上传 ${stateKey}: ${localItems.length}`);
      }
    }
    A.renderAll();

    // 2. 订阅实时变更(per-change 元数据过滤,避免本地挂起写阻塞远端通知)
    for (const stateKey of Object.keys(this.collMap)) {
      const unsub = onSnapshot(this._coll(stateKey), async (snap) => {
        this.applyingRemote = true;
        try {
          let changed = 0;
          for (const change of snap.docChanges()) {
            // 跳过本地刚发出还没server确认的回声(per-change 判断)
            if (change.doc.metadata.hasPendingWrites) continue;
            const data = change.doc.data();
            let item = null;
            if (data.iv && data.ct) {
              try { item = JSON.parse(await this.Crypto.decrypt(this.cryptoKey, { iv: data.iv, ct: data.ct })); }
              catch { continue; }
            } else { delete data._syncedAt; item = data; }
            if (!item) continue;
            const items = A.State[stateKey];
            const idx = items.findIndex(x => x.id === item.id);
            if (change.type === 'added' || change.type === 'modified') {
              // 仅当数据真的有差异时计变更(避免echo自己已有的数据)
              if (idx < 0) { items.push(item); changed++; }
              else if (JSON.stringify(items[idx]) !== JSON.stringify(item)) {
                items[idx] = item; changed++;
              }
            } else if (change.type === 'removed') {
              if (idx >= 0) { items.splice(idx, 1); changed++; }
            }
          }
          if (changed) {
            A.Store.save(A.KEY[stateKey], A.State[stateKey]);
            A.captureSyncSnapshot?.();
            A.renderAll();
            console.info(`[Sync] 远端变更 ${stateKey}: ${changed} 条`);
            this._showStatus(`☁ 已同步 ${changed} 条远端变更`, false);
          }
        } finally { this.applyingRemote = false; }
      }, (err) => console.error(`[Sync] 订阅 ${stateKey}:`, err));
      this.unsubs.push(unsub);
    }
  },

  /** 手动刷新(切回前台/点设置里"立即刷新"用)
   * 关键安全保证:先 waitForPendingWrites 把本地排队的写入全部冲到服务器,
   * 然后才让 onSnapshot 自然处理远端变更,**不再做粗暴的 pull-and-replace**。
   * 这样杜绝了"本地未同步的修改被云端旧数据覆盖"的数据丢失场景。
   */
  async refresh() {
    if (!this.ready) return { ok: false };
    const { waitForPendingWrites } = this._modules;
    try {
      await waitForPendingWrites(this.db);
      // onSnapshot 已经在后台运行,会自动把任何远端变更带过来
      // 我们只触发一次重渲染,确保 UI 反映最新状态
      window.AmandaTasks?.renderAll();
      return { ok: true, changed: 0, msg: '已同步,本地变更已上传' };
    } catch (err) {
      console.warn('[Sync] waitForPendingWrites 失败:', err.message);
      return { ok: false, reason: 'wait-failed', error: err };
    }
  },

  async _setEncrypted(stateKey, item) {
    const { setDoc } = this._modules;
    const { iv, ct } = await this.Crypto.encrypt(this.cryptoKey, JSON.stringify(item));
    // 把 dueAt(明文)单独留出来,供 Cloud Function 服务端按时间查询
    // 服务端只能看到何时有任务,看不到任务内容(标题/客户名/备注仍加密)
    const doc = { iv, ct, _syncedAt: Date.now() };
    if (stateKey === 'tasks') {
      if (item.dueAt) {
        doc.dueAt = item.dueAt;
        doc.dueAtTs = new Date(item.dueAt).getTime();
      }
      // 单独再加密标题(小 payload),Cloud Function 推送时把这个 ct 直接塞进通知
      // SW 收到推送后,用 IndexedDB 里的密钥本地解密 → iPhone 锁屏看到真实标题
      if (item.title) {
        doc.titleEnc = await this.Crypto.encrypt(this.cryptoKey, item.title);
      }
      // 提醒时间(明文,用于服务端扫描)
      if (item.reminderTimes && item.reminderTimes.length) {
        doc.reminderTimes = item.reminderTimes;
      }
      if (item.nextReminderAt) {
        doc.nextReminderAt = item.nextReminderAt;
        doc.nextReminderAtTs = new Date(item.nextReminderAt).getTime();
      }
    }
    await setDoc(this._doc(stateKey, item.id), doc);
  },

  pendingPushes: 0,

  async pushItem(stateKey, item) {
    if (!this.ready || this.applyingRemote || !this._firstSyncDone) return;
    this.pendingPushes++;
    this._updateSyncIndicator();
    try { await this._setEncrypted(stateKey, item); }
    catch (err) { console.error('[Sync] 写入失败:', err); }
    finally { this.pendingPushes--; this._updateSyncIndicator(); }
  },

  async deleteItem(stateKey, id) {
    if (!this.ready || this.applyingRemote || !this._firstSyncDone) return;
    this.pendingPushes++;
    this._updateSyncIndicator();
    try { await this._modules.deleteDoc(this._doc(stateKey, id)); }
    catch (err) { console.error('[Sync] 删除失败:', err); }
    finally { this.pendingPushes--; this._updateSyncIndicator(); }
  },

  _updateSyncIndicator() {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('sync-indicator');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sync-indicator';
      document.body && document.body.appendChild(el);
    }
    if (this.pendingPushes > 0) {
      el.textContent = `⏳ 保存中… (${this.pendingPushes})`;
      el.className = 'syncing';
    } else {
      el.textContent = '✓ 已同步';
      el.className = 'synced';
      // 1.5 秒后淡出
      clearTimeout(this._syncFadeTimer);
      this._syncFadeTimer = setTimeout(() => {
        el.classList.add('fade');
      }, 1500);
    }
    el.classList.remove('fade');
  },

  shutdown() {
    this.unsubs.forEach(u => { try { u(); } catch {} });
    this.unsubs = []; this.ready = false;
    this.cryptoKey = null; this.userId = null;
  },

  /**
   * 注册 Web Push 订阅:在 Service Worker 上订阅推送,
   * 然后把 endpoint 信息存到 Firestore /users/{userId}/pushSubs/{deviceId}。
   * Cloud Function 拿这些 endpoint 用 web-push 库发推送。
   */
  async subscribePush() {
    if (!this.ready || !this.VAPID_PUBLIC_KEY) {
      console.info('[Push] 跳过:Firebase 未就绪或未配置 VAPID');
      return { ok: false, reason: 'no-config' };
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return { ok: false, reason: 'unsupported' };
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this._urlB64ToUint8(this.VAPID_PUBLIC_KEY),
        });
      }
      // 用稳定的 device id(取 endpoint 哈希)
      const deviceId = await this._sha256Short(sub.endpoint);
      const { setDoc, doc } = this._modules;
      const ref = doc(this.db, 'users', this.userId, 'pushSubs', deviceId);
      await setDoc(ref, {
        endpoint: sub.endpoint,
        keys: sub.toJSON().keys,
        ua: navigator.userAgent.slice(0, 200),
        createdAt: Date.now(),
        platform: /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' :
                  /Android/.test(navigator.userAgent) ? 'android' : 'desktop',
      });
      console.info('[Push] 订阅成功 deviceId=' + deviceId.slice(0, 8) + '...');
      return { ok: true, deviceId };
    } catch (err) {
      console.error('[Push] 订阅失败:', err);
      return { ok: false, reason: 'error', error: err };
    }
  },

  _urlB64ToUint8(b64) {
    const padding = '='.repeat((4 - b64.length % 4) % 4);
    const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  },
  async _sha256Short(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /**
   * 把加密钥(CryptoKey)+ userId 存到 IndexedDB
   * 这样 Service Worker 收到 push 时也能读到密钥,本地解密推送内容
   */
  async _storeCryptoKeyInIDB(cryptoKey, userId) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('amanda-tasks-crypto', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('crypto')) {
          db.createObjectStore('crypto');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('crypto', 'readwrite');
        const store = tx.objectStore('crypto');
        store.put(cryptoKey, 'currentKey');
        store.put(userId, 'currentUserId');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    });
  },

  _showStatus(msg, isError) {
    if (typeof document === 'undefined' || !document.body) return;
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;top:60px;left:50%;transform:translateX(-50%);
      background:${isError ? '#E24B4A' : '#0891B2'};color:#fff;padding:8px 16px;
      border-radius:14px;font-size:13px;z-index:300;box-shadow:0 2px 10px rgba(0,0,0,0.18)`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; }, 2400);
    setTimeout(() => el.remove(), 2900);
  },
};
