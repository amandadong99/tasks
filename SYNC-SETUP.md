# iPhone + 电脑同步 设置指南

> 目标:把任务指挥台部署到公网,iPhone 和电脑用同一个网址打开,**所有任务数据用 AES-GCM 256位加密**,任何变更几秒内自动双向同步。

## 安全模型(请先看)

- **不需要 Gmail 登录**,只需自己设一个"工作密钥"
- 浏览器用 **PBKDF2 200,000 轮** 把密钥派生成加密钥匙和路径ID
- **每条数据加密后才上传到 Firebase**(标题、客户名、备注全是密文)
- Firebase 控制台只能看到一堆乱码,**Google 自己也读不到内容**
- 密钥只存在你浏览器的 localStorage,**永远不上传**
- 同浏览器自动记住,**换浏览器需要重输密钥**
- 输错密钥 → 解密失败 → 系统提示"密钥不正确",不会让你看错乱数据
- 设置页有"退出登录(清除本机密钥)"按钮,出借手机/电脑前可以一键清除

---

## 一图概览

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│  iPhone     │  HTTPS  │  GitHub Pages    │ Firebase│  你的       │
│  Safari     │ ──────► │  (你的网址)      │ ◄─────► │  Firestore  │
│  (主屏图标) │         │  HTML/CSS/JS     │  实时   │  (云数据库) │
└─────────────┘         └──────────────────┘         └─────────────┘
       ▲                                                    ▲
       └────── 实时同步(几秒) ──────────────────────────────┤
                                                            │
┌─────────────┐                                             │
│  电脑       │                                             │
│  Chrome/    │  ──────── 同一网址 ──────────────────────────┘
│  Safari     │
└─────────────┘
```

---

## 已经准备好的(我做的)

- ✅ `firebase-config.js` 完整的Firestore读写 + 实时订阅 + 离线持久化
- ✅ `app.js` 自动diff检测变更并推送(任务/人物/出差/模板都同步)
- ✅ 远端变更自动落地本地并刷新视图
- ✅ Service Worker 离线缓存 + 推送接收
- ✅ PWA 配置(可添加到主屏)
- ✅ 数据隔离:用户在设置页输入"工作密钥",所有数据存在 `/users/{密钥}/` 路径下

---

## 你要做的(共 6 步,大约 20 分钟)

### 第 1 步:把代码推到 GitHub 仓库

打开终端,在 `amanda-tasks/` 目录下运行:

```bash
cd "/Users/dongyuehua/Documents/Cowork/amanda-tasks"
git init
git add .
git commit -m "Amanda 任务指挥台 v1.0"
git branch -M main

# 在 github.com 上先创建一个新仓库,比如叫 amanda-tasks
# 复制仓库的 HTTPS 地址,替换下面这行
git remote add origin https://github.com/你的GitHub用户名/amanda-tasks.git

git push -u origin main
```

> **你已经用 GitHub Pages 部署过 CRM,流程一样。**

### 第 2 步:开启 GitHub Pages

1. 打开仓库页面 → 点击右上角 **Settings**
2. 左侧找 **Pages**
3. **Source** 选 `Deploy from a branch`,**Branch** 选 `main` / `(root)`,点 Save
4. 等 1–2 分钟,刷新页面会显示部署后的网址,形如:
   ```
   https://你的GitHub用户名.github.io/amanda-tasks/
   ```

### 第 3 步:从 Firebase 拿到 Web SDK 配置

1. 打开 [Firebase Console](https://console.firebase.google.com/)
2. 选你 **CRM 在用的那个项目**(复用,不新建)
3. 点击左上角 **⚙️ 项目设置** → **常规** Tab
4. 滚到底部"你的应用"区域:
   - 如果已有 Web 应用(CRM 用的那个),直接点它
   - 如果没有,点 `</>` 图标加一个 Web 应用,名字随意如 `amanda-tasks`
5. 找到 **SDK 设置和配置** → 选 **配置**,会显示一段类似这样:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "xxx.firebaseapp.com",
     projectId: "xxx",
     storageBucket: "xxx.appspot.com",
     messagingSenderId: "123...",
     appId: "1:123:web:abc"
   };
   ```
   **整段复制下来**

### 第 4 步:粘配置到 firebase-config.js

打开 `firebase-config.js`,把第 35–44 行的 config 替换成你刚复制的值,并把 `ENABLED: false` 改成 `true`:

```js
window.AmandaFirebase = {

  /* === 用户配置区(改这里)=== */
  ENABLED: true,                 // ← 改成 true
  config: {
    apiKey: "AIza...",           // ← 粘贴你的真实值
    authDomain: "xxx.firebaseapp.com",
    projectId: "xxx",            // ← 复用 CRM 时这里就是 CRM 项目的 projectId
    storageBucket: "xxx.appspot.com",
    messagingSenderId: "123...",
    appId: "1:123:web:abc",
  },
  /* ======================== */
```

保存,然后 push 到 GitHub:
```bash
git add firebase-config.js
git commit -m "启用 Firebase 同步"
git push
```

### 第 5 步:加 Firestore 安全规则

1. Firebase Console → 左侧 **Firestore Database** → **规则** Tab
2. 在现有规则的最后(`match /databases/{database}/documents {` 之内)**追加**下面这段:

```
match /users/{userId}/{coll=**} {
  allow read, write: if true;
}
```

3. 点击 **发布**

> **不影响 CRM**:这条新规则只匹配 `/users/...` 路径,你 CRM 的 `customers` 之类的collections仍按各自的现有规则执行。
>
> **安全说明**:这是文档第 11.2 节的"轻量隔离"方案 — 网址不公开 + 工作密钥随机即可。如需更严,以后可以接 Firebase Auth(放第二版)。

### 第 6 步:在 iPhone + 电脑分别启用

**iPhone 上(第一次):**
1. Safari 打开 `https://你的GitHub用户名.github.io/amanda-tasks/`
2. 点底部分享按钮 → **添加到主屏幕**
3. **从主屏图标启动**(不是从 Safari 里)
4. 自动出现"🌻 设置工作密钥"全屏锁屏 → 输入 8 位以上自定义字符串(建议中英数字混用,**自己一定要记牢**),例如 `amandasunflower2026`
5. 输入两次确认 → 点"设置并启用同步" → 等几秒种子数据加密上传
6. 顶部出现青色提示"已连接到云端,数据加密同步中"
7. 之后每次打开,自动用浏览器存的密钥解锁,无需再输

**电脑上:**
1. Chrome / Safari 打开同一个网址
2. 自动出现"🌻 请输入工作密钥"锁屏 → 输入和 iPhone **完全相同**的密钥
3. 系统校验密钥(尝试解密 Firebase 上的现有数据)→ 通过则解锁,数据自动出现
4. 之后这台电脑也会自动记住密钥

**关键提示:**

> ⚠️ **密钥忘了无法找回** — 数据是用密钥加密的,Anthropic / Firebase / 我都没法帮你解密。建议在密码管理器(如 iPhone 自带钥匙串、1Password)里存一份。
>
> ⚠️ **两边密钥必须完全相同**(区分大小写)。输错的话锁屏会提示"密钥不正确"。
>
> ⚠️ **借/丢手机前**,进设置页点"退出登录(清除本机密钥)" — 这样别人即使打开 App 也看不到内容。

---

## 验证同步

在 iPhone 完成一条任务 → 5 秒内电脑那条任务应该消失。
在电脑新建一条任务 → 5 秒内 iPhone 出现。

如果不动,打开浏览器开发者工具(电脑 Chrome 按 F12 → Console),看是否有红字报错。常见情况见下:

---

## 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 顶部提示"未设置工作密钥" | 没在设置页填密钥 | 进设置页填,刷新 |
| 顶部提示"云端连接失败" | Firebase config 错 | 检查 `firebase-config.js` 是否粘对、`ENABLED: true` |
| 报错 `permission-denied` | Firestore 规则没加 | 回第 5 步,把规则加上并发布 |
| iPhone 不收推送 | iOS 限制:必须从主屏图标启动 | 删掉主屏图标重新添加,从主屏启动 |
| 两边密钥不同 | 输错或大小写 | 设置页对照重新输 |
| 改了代码电脑端没更新 | Service Worker 缓存 | F12 → Application → Service Workers → Unregister → 刷新 |

---

## 我下一步可以帮你做什么

如果第一步部署后发现某个细节不对,直接把报错截图发给我,我看完就改。

如果你想后续加:
- **真推送通知**(任务到期当天 8 点 iOS 锁屏推送)→ 需要 Firebase Cloud Functions,我可以帮你写定时函数代码
- **iOS日历订阅 .ics**(每条任务自动出现在 iPhone 自带日历)→ 我可以加一个导出 ics 的功能
- **跨工具关联 CRM 客户**(关联人字段直接选 CRM 数据库里的客户)→ 需要修改 `app.js` 的 person 选择器,从 CRM collection 读

告诉我你完成第几步、卡在哪,我都跟。
