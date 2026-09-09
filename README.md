# Amanda 任务指挥台 v1.0

按设计文档第一版交付清单实现的单人 PWA 任务管理工具。

## 立刻试用(零配置)

直接双击 `index.html` 即可打开使用。**所有数据存在浏览器 localStorage 里**,无需任何后端配置。已经预填了文档附录 A 的真实任务和人物作为种子数据。

## 文件清单

```
amanda-tasks/
├── index.html              主页面
├── app.css                 样式(实现文档第13节视觉规范)
├── app.js                  全部业务逻辑
├── manifest.json           PWA 清单
├── service-worker.js       离线缓存 + Push 推送接收
├── firebase-config.js      Firebase 配置(可选,默认本地模式)
├── icons/
│   ├── icon.svg            矢量图标
│   ├── icon-192.png
│   └── icon-512.png
└── README.md               本文件
```

## 已实现功能(对应文档第一版交付清单)

- [x] 5 个 Tab 主导航(今日 / 本周 / 人 / 节奏 / 出差)
- [x] 顶部 4 数字卡(超期 / 今日 / 等他人 / 已完成)
- [x] **超期任务红色置顶,永不消失**
- [x] **延期机制**(明天 / 3天后 / 下周一 / 自定义),自动累计 `postponeCount`
- [x] 三领域分组(客户与销售 / 内部与系统 / 家庭与个人),严格按文档配色
- [x] 任务详情页 + 推进历史时间线
- [x] **节奏视图**(频率型 + 日期型),距上次完成天数自动排序
- [x] 6 条预置节奏任务(招聘、外贸通、材料组周会、设备组、月度考核、财务报表、季度复盘)
- [x] **按人聚合视图**:逾期客户置顶,未关联人单独分组,4 种筛选(全部/客户/团队/有逾期)
- [x] **完整出差视图**:3 个预置模板 + 按出发日自动倒推派生任务
- [x] 出差期间会议自动改视频(节奏-日期型 + autoVideoOnTrip)
- [x] PWA 配置(可添加到主屏)
- [x] Service Worker 离线 + Push 接收骨架
- [x] 设置页:工作密钥 / 通知授权 / 数据导出导入 / 重置

## 部署到 GitHub Pages

```bash
# 1. 把 amanda-tasks/ 整个目录推到一个新仓库
git init
git add .
git commit -m "init"
git remote add origin https://github.com/<你的用户>/amanda-tasks.git
git push -u origin main

# 2. 在 GitHub 仓库 Settings → Pages → Source 选择 main 分支根目录
# 3. 等几分钟,会得到 https://<用户名>.github.io/amanda-tasks 链接
```

## iPhone 添加到主屏(必须步骤,推送依赖)

1. iOS 16.4+ 用 Safari 打开部署后的网址
2. 点击下方"分享"按钮 → "添加到主屏幕"
3. 从主屏图标启动 App(必须从主屏启动,不是 Safari 里)
4. 进入"设置"页授权通知

## 开启 Firebase 云端同步(可选,跨设备用)

1. 到 [Firebase Console](https://console.firebase.google.com/) 创建/选择项目(可复用现有 CRM 项目)
2. 启用 Firestore Database
3. 在项目设置 → 你的应用 中复制 Web SDK 配置
4. 编辑 `firebase-config.js`:
   ```js
   window.AmandaFirebase = {
     ENABLED: true,
     config: {
       apiKey: "...",
       projectId: "...",
       // 其他字段
       vapidKey: "...", // FCM 公钥
     },
   };
   ```
5. 在 Firestore Rules 粘贴 `firebase-config.js` 注释里的安全规则
6. 在 App 设置页输入"工作密钥",此密钥作为所有数据的隔离键
7. 第二版会完整接入数据双向同步逻辑(目前是配置接口已就位)

## 推送通知(完整链路,需后端)

文档第 11 节技术栈方案:Service Worker 已实现 Push 接收。要发送推送还需要:

1. 启用 Firebase Cloud Messaging
2. 写一个 Cloud Function,定时(如每天 8:00)扫描 `personal_tasks` collection,
   对所有 `dueDate <= 今天 && status != 已完成` 的任务批量推送
3. 用 web-push 或 FCM admin SDK 发送

文档建议在第一版"即使没推送,App 内的红色置顶机制已能解决 80% 的忘事问题"。
所以推送可以放到上线后再补,不阻塞试用。

## 验收测试

按文档第 14.2 节,可手动验证:

- **用例 1 超期永不消失**:打开后顶部红色区有 7 条 4/25–5/1 的真实历史逾期任务
- **用例 2 延期机制**:点任意超期任务的"延期"按钮 → 选 3 天后 → 任务从超期区移除,详情页显示"已延期 1 次"
- **用例 3 领域分组**:今日有客户/内部/家庭三类任务,3 个彩色细条分组渲染
- **用例 4 节奏频率型**:节奏 Tab 看到"招聘"已 5 天没做(绿)、"外贸通"已 8 天没做(琥珀)
- **用例 5 节奏日期型**:今天是周一(2026-05-04),"材料组周会"会出现在今日视图内部领域下
- **用例 6 按人聚合**:Yasser、Islam、Luis、Anoop、Oscar 都有任务,Islam 和 Luis 因有逾期会置顶
- **用例 7 PWA**:添加到主屏后可独立启动

## 常用命令(浏览器控制台)

```js
AmandaTasks.State           // 查看全部数据
AmandaTasks.Store.remove('amanda.meta')   // 清重置标记,刷新后重新预填种子
AmandaTasks.renderAll()     // 强制重渲染
```

## 第一版未做的(文档明确放第二版)

- Firebase Firestore 真正的双向同步(配置接口已就位)
- Cloud Functions 定时推送(Service Worker 接收已就位)
- 本周视图升级为完整日历
- 自定义模板编辑器(预置 3 模板已可用,但模板自定义留第二版)
- 暗色模式
- 电脑端访问优化

---

**下一步建议**:先在电脑浏览器打开 `index.html` 试用 1–2 天,验证字段是否够、视图是否顺手,再考虑部署到 GitHub Pages 和接入 Firebase。
