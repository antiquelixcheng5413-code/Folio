# 先鉴 Peek

先鉴是一个面向知识工作者的个性化会议筛选工具：把带时间码字幕交给
InfiniSynapse Agent，获得“值得看 / 选择性看 / 可以跳过”的判决、时间码路线、
结论证据和可沉淀的学习笔记。

## 本地运行

1. 复制 `.env.example` 为 `.env.local`。
2. 在 `.env.local` 中填写 `INFINISYNAPSE_API_KEY`；密钥不得进入前端或仓库。
3. 执行 `pnpm install`、`pnpm run db:generate`、`pnpm run dev`。

## 数据边界

- 访客会话、画像、结果、笔记和知识更新保存到 D1。
- 登录完全可选；登录后通过 InfiniSynapse 唯一用户 ID 绑定学习空间。
- 不保存视频。
- 字幕在分析成功后立即清理。
- 每个会话每天最多发起 3 次真实分析。

## 可选登录

Peek 使用 InfiniSynapse 官方 Partner SSO，用户可在官方页面通过邮箱、手机号或
扫码登录；Peek 不接触或保存密码。未配置 SSO 时，访客模式仍可完整使用。

1. 在 InfiniSynapse「设置 → 第三方接入」创建应用。
2. 回调域名白名单填写生产域名，例如 `peek.antiquelixcheng5413.workers.dev`。
3. 将 `INFINI_CLIENT_ID` 和 `INFINI_CLIENT_SECRET` 配置为服务端环境变量/Secret。
4. 回调地址由应用自动生成为
   `https://你的域名/api/auth/infini/callback`，不要把 `clientSecret` 写入仓库。

## 真实任务链

服务端先连接 `GET /api/ai/events?connId=...`，再调用
`POST /api/ai/message` 创建 `newTask`。应用持久化 `connId`、`taskId`、输入哈希、
状态和结果；刷新后使用任务查询与 workspace 接口恢复，不盲目重发任务。
