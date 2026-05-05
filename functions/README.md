# Cloud Function 推送部署指南

> 目标:任务到期前 5-10 分钟,iPhone / 电脑自动收到锁屏推送通知。

## 工作流程一图

```
Amanda 创建任务 "下午3点 Yasser 开会"(15:00)
        │
        ▼
  客户端把 dueAt: "2026-05-04T15:00:00Z" 存到 Firestore(明文)
  + 加密的标题/客户/备注 (iv/ct)
        │
        ▼
  Cloud Function 每 5 分钟跑一次
  扫到 dueAt 在 14:50-15:00 的任务
        │
        ▼
  通过 web-push 发到所有订阅设备
  通知文案: "📋 任务即将到期 - 15:00 有任务"
  (内容匿名,Apple/Google 服务器看不到具体任务)
        │
        ▼
  iPhone 锁屏弹通知 → 点开 → 打开 App → 看到任务详情
```

## 部署步骤(只需做一次,大约 15 分钟)

### 第 1 步:在 Mac 装 Firebase CLI

```bash
# 如果之前没装过 firebase-tools
npm install -g firebase-tools

# 用你的 Google 账号登录(amandadong99@gmail.com)
firebase login
```

如果你装 firebase-tools 时遇到权限问题,可以用:`sudo npm install -g firebase-tools`

### 第 2 步:启用 Cloud Functions 计费(必需)

Cloud Functions 需要 **Blaze 套餐**。每月有免费额度:200 万次函数调用 + 40 万 GB 秒计算时间(我们这个每 5 分钟跑一次,每月才 8640 次,远低于免费额度,**实际不会扣费**)。

1. 打开 https://console.firebase.google.com/project/amanda-tasks/usage/details
2. 点 "Modify plan" → 选 **Blaze (按用量付费)**
3. 添加你的信用卡(只用于超出免费额度的部分)
4. 设置一个**预算上限**,比如 5 美元/月。即使有 bug 死循环也不会被扣大额费用

### 第 3 步:生成 VAPID 密钥(Web Push 凭证)

VAPID 密钥让你的服务端能给浏览器/手机发推送。生成一对公私钥:

```bash
cd "/Users/dongyuehua/Documents/Cowork/amanda-tasks/functions"
npm install
npx web-push generate-vapid-keys --json
```

会输出类似:
```json
{
  "publicKey":  "BDh4MKB...一长串...",
  "privateKey": "Ryxbzj...另一串..."
}
```

**两个都复制,等下要用。**

### 第 4 步:把 VAPID 配置注入 Cloud Function 环境

把刚才两个密钥设置成 Functions 的环境变量(部署后函数运行时能读到):

```bash
cd "/Users/dongyuehua/Documents/Cowork/amanda-tasks"
# 替换下面两个值为你刚生成的真实密钥
firebase functions:secrets:set VAPID_PUBLIC_KEY
# 它会让你粘贴值,粘贴 publicKey 那串
firebase functions:secrets:set VAPID_PRIVATE_KEY
# 同样,粘贴 privateKey 那串
```

> 也可以直接在 functions/.env 里写,但用 secrets 更安全。

### 第 5 步:把 publicKey 也填进客户端

打开 `/Users/dongyuehua/Documents/Cowork/amanda-tasks/firebase-config.js`,找:
```js
VAPID_PUBLIC_KEY: "",
```
改成:
```js
VAPID_PUBLIC_KEY: "BDh4MKB...一长串...",   // 你刚生成的 publicKey
```

只填 publicKey,**privateKey 永远不要进客户端代码**(它只在服务端用)。

### 第 6 步:部署 Functions + Firestore Rules + Indexes

```bash
cd "/Users/dongyuehua/Documents/Cowork/amanda-tasks"

# 部署 Functions
firebase deploy --only functions

# 部署 Firestore 索引(让 Cloud Function 能高效查询 dueAtTs)
firebase deploy --only firestore:indexes
```

第一次部署 Functions 要 3-5 分钟,显示 "✔ Deploy complete!" 就成功了。

### 第 7 步:把客户端代码改动也推到 GitHub Pages

```bash
cd "/Users/dongyuehua/Documents/Cowork/amanda-tasks"
git add -A
git commit -m "客户端配置 VAPID + 推送订阅"
git push
```

### 第 8 步:在 iPhone / 电脑上注册推送订阅

1. 强制刷新一次 App(让 Service Worker 拉新代码)
2. 进 ⚙️ 设置 → 点 "授权通知 + 启用主屏数字徽章"
3. iOS 系统弹"是否允许通知" → 允许
4. App 自动调用 `subscribePush()` → 把 endpoint 存到 Firestore
5. 提示 "推送订阅已就绪"

### 第 9 步:测试

**测试 1:手动触发推送**

在浏览器打开:
```
https://asia-east1-amanda-tasks.cloudfunctions.net/testPush?userId=<你的userId>
```

(userId 怎么找?Firebase Console → Firestore Database → users → 看到的那个长串字符就是。)

正常情况下 1-2 秒后 iPhone 会弹"🌻 测试推送"通知。

**测试 2:实战测试**

1. 在 App 里新建一条任务,日期=今天,时间=**8 分钟后**(比如现在 14:00 就设 14:08)
2. 等 5-10 分钟
3. iPhone 应该在到期前 5 分钟左右收到通知 "📋 任务即将到期 - 14:08 有任务"

如果没收到,看 logs:
```bash
firebase functions:log --limit 50
```

## 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| firebase login 报错 | 需要梯子访问 google.com | 开梯子再试 |
| firebase deploy 失败 401 | 没切到对的项目 | `firebase use amanda-tasks` |
| Function 部署成功但日志说没找到任务 | Firestore 索引还没建好 | 等几分钟,或在 Firebase Console 手动加索引 |
| 推送测试 testPush 显示无订阅设备 | App 端没成功订阅 | 重新进设置点"授权通知"按钮 |
| iPhone 收不到推送 | iOS PWA 限制多 | 必须从主屏图标启动 + 已加入主屏 + 通知已授权 |
| 推送收到但内容空白 | payload 格式问题 | 看 SW 日志 |

## 函数运行成本预估

每 5 分钟跑一次 + 每天 288 次 + 每月约 8640 次

- Cloud Functions 免费额度:每月 200 万次调用 + 40 万 GB 秒
- Firestore 读取:每个任务一次读,每天可能扫 100 条 = 每月 3000 次
- Firestore 写入:更新 _notifiedAt 字段 ≈ 每月 100 次
- Cloud Messaging (FCM):**免费,无配额**

**预估月费用:0 元**(完全在免费额度内)

设置个 5 美元的预算上限作为防呆即可。
