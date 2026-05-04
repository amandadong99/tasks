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
    apiKey: "AIzaSyDWiFntDTYu2XXH3Kz3ArbmrvUbfKOJER4",
    authDomain: "qiangtong-crm.firebaseapp.com",
    projectId: "qiangtong-crm",
    storageBucket: "qiangtong-crm.firebasestorage.app",
    messagingSenderId: "811603365425",
    appId: "1:811603365425:web:e17ce95d13cdeb29ec4f10",
  },
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
    const { getDocs, onSnapshot } = this._modules;
    const A = window.AmandaTasks;
    if (!A) return;

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
            // 兼容历史明文
            delete data._syncedAt;
            remoteItems.push(data);
          }
        } catch (err) {
          console.warn(`[Sync] 解密失败 ${stateKey}/${d.id}:`, err.message);
        }
      }
      if (remoteItems.length > 0) {
        A.State[stateKey] = remoteItems;
        A.Store.save(A.KEY[stateKey], remoteItems);
        console.info(`[Sync] 拉取 ${stateKey}: ${remoteItems.length}`);
      } else if (A.State[stateKey].length > 0) {
        // 远端为空,把本地种子推上去(加密)
        for (const item of A.State[stateKey]) await this._setEncrypted(stateKey, item);
        console.info(`[Sync] 首次上传 ${stateKey}: ${A.State[stateKey].length}`);
      }
    }
    A.renderAll();

    // 2. 订阅实时变更
    for (const stateKey of Object.keys(this.collMap)) {
      const unsub = onSnapshot(this._coll(stateKey), async (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        this.applyingRemote = true;
        try {
          let changed = 0;
          for (const change of snap.docChanges()) {
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
              if (idx >= 0) items[idx] = item; else items.push(item);
              changed++;
            } else if (change.type === 'removed') {
              if (idx >= 0) { items.splice(idx, 1); changed++; }
            }
          }
          if (changed) {
            A.Store.save(A.KEY[stateKey], A.State[stateKey]);
            A.captureSyncSnapshot?.();
            A.renderAll();
            console.info(`[Sync] 远端变更 ${stateKey}: ${changed}`);
          }
        } finally { this.applyingRemote = false; }
      }, (err) => console.error(`[Sync] 订阅 ${stateKey}:`, err));
      this.unsubs.push(unsub);
    }
  },

  async _setEncrypted(stateKey, item) {
    const { setDoc } = this._modules;
    const { iv, ct } = await this.Crypto.encrypt(this.cryptoKey, JSON.stringify(item));
    await setDoc(this._doc(stateKey, item.id), { iv, ct, _syncedAt: Date.now() });
  },

  async pushItem(stateKey, item) {
    if (!this.ready || this.applyingRemote || !this._firstSyncDone) return;
    try { await this._setEncrypted(stateKey, item); }
    catch (err) { console.error('[Sync] 写入失败:', err); }
  },

  async deleteItem(stateKey, id) {
    if (!this.ready || this.applyingRemote || !this._firstSyncDone) return;
    try { await this._modules.deleteDoc(this._doc(stateKey, id)); }
    catch (err) { console.error('[Sync] 删除失败:', err); }
  },

  shutdown() {
    this.unsubs.forEach(u => { try { u(); } catch {} });
    this.unsubs = []; this.ready = false;
    this.cryptoKey = null; this.userId = null;
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
