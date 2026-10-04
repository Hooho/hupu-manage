# AGENTS.md — 虎扑评论管理 · agent 工作流

> 给未来在此项目上工作的 agent 阅读的工作流规范。Cursor / Codex / OpenCode / Aider 等会自动消费本文件。

---

## 1. 项目一句话

虎扑评论管理工具（React + Vite 前端 + Express 后端）：监控指定用户回帖 → 批量/单条举报 → 统计。支持多 cookie 账号、定时调度、号与号互相点亮。

## 2. 启动

```bash
npm install                # 装包（含 Radix UI Headless 组件）
npm run dev                # concurrently 启动 client (3000) + server (3002)
```

- 前端：http://localhost:3000
- 后端：http://localhost:3002（API）
- API 代理：`/api/*` 在 vite.config.js 里代理到 3002

如果端口冲突可改 `vite.config.js` 的 `server.port`。

## 3. 数据文件（不入库）

| 路径 | 内容 | 操作 |
|---|---|---|
| `server/data/config.json` | Cookie / euids / accounts / taskSchedules | 手工新增/修改或通过 API |
| `server/data/users.json` | 被监控用户的抓取信息（声望/回帖数等） | 后端 fetch-user-info 写 |
| `server/data/operations.json` | 举报操作历史记录 | 每次举报追加 |
| `server/data/progress.json` | 翻页进度 | 后端维护 |
| `server/data/stats.json` | 举报统计 | 重新统计按钮写 |

`server/data/` 已被 `.gitignore` 排除。**不要**把 cookie 入库。

## 4. 文件结构（关键文件）

```
src/
├── App.jsx                 # 顶部 TodayBanner（今日任务跑过的状态条）
├── index.css               # 设计 token（颜色/字号/间距/圆角/阴影/动效）
├── pages/
│   ├── HomePage.jsx        # 回帖列表（卡片化 + 自定义账号栏）
│   ├── ReportResultsPage.jsx
│   └── ConfigPage.jsx      # TABS=[账号, 监控账号, 调度]
├── components/             # 8 个基础组件
└── hooks/

server/
├── index.js                # Express 路由主文件
├── operations.js           # ACTIONS（写）/ SCRAPERS（读）抽象表
├── scheduler.js            # 定时任务引擎 + 跨号任务
└── storage.js              # 数据访问层（accounts/taskSchedules 等）
```

## 5. 后端抽象规范

**新增"对虎扑接口的写操作"**（如举报、推荐、点亮）：

```js
// server/operations.js 的 ACTIONS 表里加一项
{
  myAction: {
    label: '我的操作',
    url: (p) => `https://bbs.hupu.com/...`,
    body: (p) => ({ tid: p.tid, ... }),
    referer: (p) => `https://bbs.hupu.com/${p.tid}.html`
  }
}
```

调用 `POST /api/action/myAction body={...}`。

**新增"读 + 解析页面"的操作**（如抓帖子列表、抓评论）：

```js
// server/operations.js 的 SCRAPERS 表里加一项
myScraper: {
  label: '抓取xxx',
  async run({ ...params }) {
    // axios.get + cheerio.load
    return { count, items: [...] }
  }
}
```

调用 `POST /api/scrape/myScraper body={...}`。

**注意**：
- `light` 接口是 **toggle** 行为（每调一次状态翻转），不是显式的"亮/灭"参数
- `recommend` 用 status:1/0 显式区分推荐/取消
- `recommendStatus`/`shumeiId`/`deviceid` 是虎扑私有风控字段，没填会被业务校验拒

## 6. 多账号约定

- **多 cookie 账号管理**：每个 cookie 是一个"操作账号"，id 自动分配 A→B→C→...
- **主账号**：被标记 `primary: true` 的账号。**所有抓取、举报、调度任务都走主账号 cookie**
- **监控账号**：用 euid 标识的被监控虎扑用户（旧功能，独立概念）
- 不要混淆：
  - 「账号」tab 管多 cookie（操作账号）
  - 「监控账号」tab 管被监控 euid（被监控的用户）

修改 server 端读 cookie 的逻辑：用 `await getPrimaryCookie()` 而非 `config.cookie`。

## 7. 调度任务规范

`server/scheduler.js` 里的 `TASKS` 数组定义任务逻辑（`run(ctx)` 函数）。
schedule / enabled 由用户在「调度」tab UI 配置，持久化在 `config.taskSchedules`。

新增任务：

```js
// server/scheduler.js 的 TASKS 加一项
{
  id: 'my-task',                  // 唯一 id
  name: '我的任务',
  description: '...',
  defaultSchedule: '12:00',        // 用户没配时的默认值
  run: async (ctx) => { ... }     // ctx = { accounts, cookie, log, sleep }
}
```

**防重复**：
- 任务完成后写入 `taskStates[id].lastRunByDate = { date: 'YYYY-MM-DD', at: 'HH:mm', success, result, error }`
- 自动调度触发时如果 `hasRunToday()` 返回 true，跳过本次
- 手动 `runTask(id)` 不加 force 也跳过；加 `{ force: true }` 强制重跑

**调时间**：UI 直接改，或 `PATCH /api/scheduler/task/:id body={schedule:'15:30'}`。

## 8. UI 设计 token

`src/index.css` 顶部定义 CSS 变量，**禁止硬编码颜色/间距**：

```
颜色：--bg / --bg-2 / --surface / --text / --text-2 / --text-3
主色：--accent (#e73828 虎扑红) / --accent-hover / --accent-bg / --accent-soft
状态：--danger / --success / --focus
圆角：--r-xs/sm/md/lg/pill
阴影：--sh-sm/md/lg/pop
字号：--fs-12/13/14/15/18
动效：--t (160ms cubic-bezier)
```

按钮、checkbox、tab 等组件都已封装在 `src/components/`。新增按钮用 `<Button variant="primary|danger|ghost">`，不要自己写 `<button>`。

## 9. Commit 规范

**按功能 commit**，每个 commit 是一个独立完整的功能。

格式：`<type>(<scope>): <imperative summary>`

`<type>`：
- `feat` 新功能
- `fix` bug fix
- `refactor` 重构
- `docs` 文档
- `chore` 杂项

`<scope>`（可选）：`ops` / `storage` / `scheduler` / `api` / `ui` / `accounts` / `schedule`

commit body 写清楚改动点和理由，避免"update files"这种空话。

## 10. 调试临时脚本清理

调试用的临时脚本（puppeteer 探测、curl 测试）必须以以下前缀之一，**且不被 git 追踪**（已被 `.gitignore` 覆盖）：

- `.probe*.mjs`
- `.check-*.mjs`
- `.find-*.mjs`
- `.show-*.mjs`
- `.inspect-*.mjs`
- `.test-*.mjs`
- `.nav-to-*.html`

不要把这些前缀的文件留到 commit 里。如果发现残留，先确认 `.gitignore` 覆盖了，再 commit。

## 11. 已知坑

- 虎扑 web 端**没有"删除自己回复"按钮**——只能用 App 操作
- `light` 的 `deviceId` 当前传空串，虎扑可能校验失败（需要浏览器侧注入指纹）
- `createReply` 的 `deviceId`/`shumeiId` 是必需的（数美验证）
- 抓取 `__NEXT_DATA__` 比 cheerio DOM 选择器稳定——优先用 SSR JSON
- 手机端 `m.hupu.com` 帖子页 404，老的 mobile h5 已下线
- 虎扑服务端偶发 502 是正常的，加 retry 或忽略
- cookie 失效后所有接口返回空数据或 AS021999；让用户重新粘贴 cookie

## 12. 测试方法

无单元测试。手动验证步骤：

```bash
# 启动
npm run dev

# 健康检查
curl http://localhost:3002/api/scheduler/board

# 手动触发任务（响应可能慢）
curl -X POST http://localhost:3002/api/scheduler/run/daily-post-light

# 抓取帖子列表
curl -X POST http://localhost:3002/api/scrape/threads -H 'content-type: application/json' -d '{}'

# 截图验证 UI（用 puppeteer-core + chrome headless）
node .show-xxx.mjs   # 这些 .show-*.mjs 已被 .gitignore 忽略
```

## 13. 推送

```bash
git push origin master
```

macOS keychain 已配置 GitHub 凭证（用户 hoho），可直推。
