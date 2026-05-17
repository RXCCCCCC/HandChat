# 后端开发技术文档

> **角色：成员C（后端工程师）**  
> **原则：先做不依赖接口文档的基础设施（阶段A），再等文档冻结后写协议层（阶段B）。**  
> **后端完全自测，不依赖前端和模型。验证工具：`curl` + `wscat`。**  
> **接口协议基准：** `docs/interfaces.md`（本技术文档中所有接口定义以此为准，如有冲突以 `interfaces.md` 为权威源）。

---

## 一、总体架构决策

| 决策点 | 结论 |
|--------|------|
| 运行环境 | Node.js + TypeScript + Express |
| 数据库 | PostgreSQL（Supabase 托管）+ Prisma ORM |
| 实时通信 | WebSocket（ws 库），与 Express 共端口 |
| 用户认证 | Supabase Auth JWT — 后端用 `@supabase/supabase-js` 验证 |
| 用户数据 | 不建 User 表，直接引用 Supabase Auth 的 `sub` 作为 `userId` |
| sessionId | 后端生成 UUID，通过 `session_created` 返回前端 |
| LLM句子整合 | 未来阶段 → 追加模式（不覆盖原始词） |
| 会话恢复 | `session_start` 支持 `resume_session_id` 恢复旧会话 |

### Translation 消息流向

```
MVP 阶段：
  前端本地推理 → 本地即时显示 → WS发translation → 后端存DB

LLM增强阶段（未来）：
  前端本地推理 → 本地即时显示 → WS发translation → 后端存DB
                                                     ↓
                                               句子缓冲队列（检测sentence_end）
                                                     ↓
                                               LLM 整合 → 后端推送 sentence_final → 前端追加显示
```

---

## 二、阶段A：基础设施搭建（不依赖接口文档）

> **目标：** 1-2天完成。项目骨架、数据库、日志、认证占位、WebSocket心跳。

### A1：项目骨架

```bash
cd HandChatFinal/backend
pnpm init
pnpm add express cors ws dotenv @supabase/supabase-js
pnpm add -D typescript @types/node @types/express @types/cors @types/ws tsx
```

文件结构：
```
backend/
├── package.json
├── tsconfig.json
├── .env
├── .env.example
├── .gitignore
├── prisma/
│   └── schema.prisma
├── src/
│   ├── index.ts                  # 入口（Express+WS 共端口 + 30s 心跳）
│   ├── config.ts                 # 环境变量管理
│   ├── logger.ts                 # 统一日志
│   ├── db.ts                     # Prisma Client 单例
│   ├── types.d.ts                # Express Request 扩展
│   ├── middleware/
│   │   └── auth.ts               # Supabase JWT 认证中间件（占位）
│   ├── services/
│   │   └── sessionService.ts     # DB 服务层
│   └── routes/
│       └── sessionRoutes.ts      # REST API
└── scripts/
    └── selfcheck.mjs             # 自动化健康检查（阶段C填充）
```

### A2：Prisma Schema + 数据库

```prisma
model Session {
  id        String        @id @default(uuid())
  userId    String?       // Supabase Auth 的 sub（auth.users.id），不建 User 表
  status    String        @default("active")  // active | ended
  startedAt DateTime      @default(now())
  endedAt   DateTime?
  translations Translation[]
}

model Translation {
  id           Int      @id @default(autoincrement())
  sessionId    String
  session      Session  @relation(fields: [sessionId], references: [id])
  frameId      Int      // 前端发送的帧序号（从0递增），用于丢帧检测和前后端对齐
  text         String
  confidence   Float
  gestureLabel String?
  type         String   // partial | final | sentence_end | sentence_final（LLM）
  createdAt    DateTime @default(now())

  @@index([sessionId, createdAt])
}
```

`.env` 中 `DATABASE_URL` 指向 Supabase PostgreSQL 的 Session Pooler 连接串。

### A2.5：认证基础设施占位

> **说明：** 阶段A/B 不拦截请求（仅占位），阶段C 正式启用。认证逻辑与 `docs/interfaces.md` §5.1-5.2 完全对齐。

**`src/middleware/auth.ts`** — 阶段A/B 占位，阶段C 取消注释启用：

```ts
// ═══ 阶段C 启用时取消下方注释 ═══
// import { createClient } from '@supabase/supabase-js';
// import { config } from '../config';
//
// const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
//
// /**
//  * Supabase JWT 认证中间件
//  * 对齐 docs/interfaces.md §5.1-5.2：
//  *   - Authorization: Bearer <Supabase JWT>
//  *   - userId 来源：Supabase Auth 的 sub（auth.users.id）
//  */
// export async function authMiddleware(req, res, next) {
//   const token = req.headers.authorization?.replace('Bearer ', '');
//   if (!token) return res.status(401).json({ error: 'Missing token', code: 401 });
//   const { data: { user }, error } = await supabase.auth.getUser(token);
//   if (error || !user) return res.status(401).json({ error: 'Invalid token', code: 401 });
//   req.userId = user.id;  // user.id = Supabase Auth 的 sub (auth.users.id)
//   next();
// }
// ═══════════════════════════════════

import { Request, Response, NextFunction } from 'express';

/**
 * 阶段A/B 占位：放行所有请求
 * 阶段C 替换为上方 Supabase JWT 验证实现
 */
export function authMiddleware(_req: Request, _res: Response, next: NextFunction) {
  next();
}
```

**`src/types.d.ts`**：
```ts
declare namespace Express {
  interface Request {
    userId?: string;
  }
}
```

**`src/config.ts`** 增加两个必需变量：
```ts
export const config = {
  // ... 已有变量 ...
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseAnonKey: requireEnv('SUPABASE_ANON_KEY'),
};
```

### A3：日志系统

统一 `[ISO时间] [级别] message` 格式。部署备注：Docker/Railway 环境下 stdout 即日志，如需持久化可重定向或引入云日志服务。

### A4：环境变量

```
DATABASE_URL="postgresql://..."
SUPABASE_URL="https://jgverskznikedselvshj.supabase.co"
SUPABASE_ANON_KEY="eyJhbGci..."
PORT=3001
CORS_ORIGIN="http://localhost:5173"
NODE_ENV="development"
```

> **说明：** `CORS_ORIGIN` 控制允许跨域的前端域名（对齐 `docs/interfaces.md` §5.4）。生产部署时替换为实际前端域名。

### A5：数据库服务层

`src/services/sessionService.ts`：
- `createSession(sessionId, userId?)` — 后端传入生成的 UUID
- `endSession(sessionId)` — 更新 status='ended'
- `saveTranslation(...)` — 写入翻译
- `getSessionHistory(sessionId, limit)` — 按 createdAt 倒序
- `getSession(sessionId)` — 查询会话状态（用于 resume 判断）

### A6：测试工具

`package.json` 预留 `"selfcheck": "node scripts/selfcheck.mjs"`（阶段C填充完整）。

### A7：WebSocket 心跳

在 `src/index.ts` 中实现：
- 每个连接维护 `isAlive` 标志
- `setInterval` 每 30s 扫描：`isAlive === false` → `terminate()`
- 收到任何消息 → 重置 `isAlive = true`

---

## 三、阶段B：WS 协议层（接口文档冻结后）

> **依赖：** `docs/interfaces.md` 冻结  
> **目标：** 2-3天。消息路由、认证、帧验证、假翻译引擎。

### B1：假翻译引擎（+safeSend 保护）

生成的翻译消息格式严格依照 `docs/interfaces.md` §2.3.1：

- 5条预定义翻译循环，每 1.8s 推送一条
- 每第 4 条 type=`sentence_end`，其余 `final`
- `safeSend` 包装：`send` 失败时自清理定时器，不抛异常
- 每条翻译同步 `saveTranslation` 写 DB（用于验证 DB 持久化链路）
- 每条消息包含完整字段：`session_id`, `frame_id`, `type`, `text`, `confidence`, `gesture_label`（对齐 `docs/interfaces.md` §2.3.1）
- `safeSend` 实现：包装 `ws.send()`，在 `ws.readyState !== WebSocket.OPEN` 或 `send` 抛异常时自动清理 `setInterval`，防止僵尸定时器泄漏

### B2：WebSocket 消息路由

**入口改造：** `src/index.ts` 中将 `handleConnection` 改为从 `wsRouter.ts` 导入。

**消息处理矩阵（依照 `docs/interfaces.md` §3.2）：**

| 收到 | 来源 | 校验 | 动作 | 回复 |
|------|------|------|------|------|
| `session_start` | 前端 | token 非空 → Supabase 验证 JWT → 失败返回 4003 | 1. 检查 `resume_session_id`<br>2. 有效→沿用旧 session<br>3. 无效→`createSession(新UUID, userId)`<br>4. 启动假翻译 | `session_created { session_id }` |
| `frame` | 前端 | `session_id` 匹配当前会话 → `validateFrameMessage()` → 失败返回 4001 | 记录日志 | 无 |
| `keypoints` | 前端 | `session_id` 匹配当前会话 → `validateKeypointsMessage()` → 失败返回 4001 | 日志记录（含 hands 数量与关键点长度统计） | 无 |
| `translation` | 前端 | `session_id` 匹配 → text 非空 | `saveTranslation` 写 DB | 无（MVP不转发，未来LLM阶段推 `sentence_final`） |
| `session_end` | 前端 | `payload.session_id` 严格匹配当前会话 → 不匹配返回 4004 | 停止假翻译 → `endSession` → `ws.close(1000)` | 无 |
| `ping` | 任意 | 无 | 重置 `isAlive` | `pong` |

**关键设计：session 恢复逻辑（对齐 `docs/interfaces.md` §3.2 与 §5.1）**

```ts
// session_start 分支内
// 1. 提取并验证 JWT（对齐 interfaces.md §5.1——WebSocket 认证通过 payload.token）
const token = payload.token as string | undefined;
if (!token) { sendError(ws, trace_id, 4003, '缺少认证 token'); return; }
const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
if (authErr || !user) { sendError(ws, trace_id, 4003, 'token 无效或已过期'); return; }
const userId: string = user.id;  // user.id = Supabase Auth 的 sub

// 2. 会话恢复/创建逻辑
const resumeId = payload.resume_session_id as string | undefined;
if (resumeId) {
  const existingSession = await getSession(resumeId);
  if (existingSession && existingSession.status === 'active' && existingSession.userId === userId) {
    sessionId = resumeId;  // 沿用旧会话（必须校验 userId 归属，防止越权恢复他人会话）
  } else {
    sessionId = crypto.randomUUID();  // 过期/不存在/非本人 → 创建新会话
    await createSession(sessionId, userId);
  }
} else {
  sessionId = crypto.randomUUID();
  await createSession(sessionId, userId);
}
// 返回 session_created（对齐 interfaces.md §3.2）
ws.send(JSON.stringify({
  type: 'session_created',
  payload: { session_id: sessionId },
  trace_id: crypto.randomUUID(),
  timestamp_ms: Date.now(),
}));
```

**translation 分支（MVP 只存储，LLM 插口预留注释，对齐 `docs/interfaces.md` §2.3.1 与 §3.2）：**

```ts
case 'translation': {
  // 前端本地推理结果 → 后端存储
  // 未来LLM阶段：此处插入句子缓冲 + LLM调用 → 推 sentence_final 回前端
  if (sessionId && payload.text && typeof payload.text === 'string') {
    await saveTranslation(
      sessionId,
      payload.frame_id as number,
      payload.text as string,
      payload.confidence as number ?? 0,
      payload.type as string ?? 'final',
      payload.gesture_label as string | undefined,
    );
  } else {
    sendError(ws, trace_id, 4001, 'translation 消息缺少 text 字段或 text 为空');
  }
  break;
}
```

### B3：帧验证器与关键点验证器

#### B3.1 帧消息验证器（`validateFrameMessage`）

依照 `docs/interfaces.md` §2.1.1 帧数据格式逐字段校验：

**必填字段（缺少任一 → error 4001）：**
- `session_id` — string，非空
- `frame_id` — number，从 0 递增的整数
- `image` — object
- `image.data` — string，非空，Base64 编码不含前缀，长度 **≤ 2MB**（`Buffer.byteLength(image.data, 'base64')`）
- `image.width` — number，正整数，推荐 256
- `image.height` — number，正整数，推荐 256
- `image.colorspace` — string，固定值 `"RGB"`

**告警但不拒绝：**
- `image.colorspace !== 'RGB'` → `logger.warn`（对齐 `docs/interfaces.md` §2.1.2 预处理参数表）
- `image.width !== 256 || image.height !== 256` → `logger.debug`（推荐值，非强制）

#### B3.2 关键点消息验证器（`validateKeypointsMessage`）

依照 `docs/interfaces.md` §2.2.1 逐字段校验：

**必填字段（缺少任一 → error 4001）：**
- `session_id` — string，非空
- `frame_id` — number
- `hands` — array，长度 ∈ **[0, 2]**（允许空数组表示当前帧未检测到手，对齐 `docs/interfaces.md` §2.2 约束）

**hands 数组内每个 hand 对象校验：**
- `handedness` — string，必须为 `"Left"` 或 `"Right"`
- `score` — number，∈ [0, 1]
- `keypoints` — array，长度固定为 **21**（对应 MediaPipe Hands 的 21 个关键点，对齐 `docs/interfaces.md` §2.2.2）
  - 每个 keypoint：`x` (number), `y` (number), `z` (number)
- `keypoints_3d` — array，长度固定为 **21**（世界坐标）
  - 每个点：`x` (number, 单位 mm), `y` (number, 单位 mm), `z` (number, 单位 mm)

**告警但不拒绝：**
- `score < 0.5` → `logger.warn`（低置信度检测）
- `hands.length === 0` → `logger.debug`（当前帧未检测到手，属于正常情况）

**通用错误回复：** `sendError(ws, trace_id, code, message)` 统一格式，对齐 `docs/interfaces.md` 附录A

---

## 四、阶段C：业务服务层（阶段B之后）

> **目标：** 1-2天。REST API、CORS配置、假翻译引擎替换为真实模式、错误处理、API文档。

### C1：REST API

依照 `docs/interfaces.md` §4.1 实现。三个接口，全部挂载 `authMiddleware`（此时正式启用，不再占位）：

**4.1.1 `GET /api/sessions?limit=20&offset=0`** — 我的会话列表

查询参数：
- `limit` — number，默认 20，最大 50
- `offset` — number，默认 0

成功响应 200：
```json
[
  {
    "id": "uuid",
    "status": "active | ended",
    "startedAt": "2026-05-14T10:30:00.000Z",
    "endedAt": "2026-05-14T10:35:00.000Z | null",
    "translationCount": 42,
    "lastTranslation": "很高兴认识你 | null"
  }
]
```
错误：401（未认证）、500（服务器错误）

**4.1.2 `GET /api/sessions/:id`** — 会话详情

成功响应 200：
```json
{
  "id": "uuid",
  "status": "active | ended",
  "startedAt": "2026-05-14T10:30:00.000Z",
  "endedAt": "2026-05-14T10:35:00.000Z | null",
  "translationCount": 42
}
```
错误：401（未认证）、404（不存在或不属于你）

**4.1.3 `GET /api/sessions/:id/history?limit=50`** — 会话翻译历史

查询参数：
- `limit` — number，默认 100，最大 500

成功响应 200：
```json
[
  {
    "text": "你好",
    "confidence": 0.95,
    "type": "final",
    "gestureLabel": "wave | null",
    "frameId": 128,
    "createdAt": "2026-05-14T10:30:05.000Z"
  }
]
```
错误：401（未认证）、404（不存在）、500（服务器错误）

**权限校验规则：**

- 所有接口必须带 `Authorization: Bearer <Supabase JWT>`
- 无 token → 401
- 查询时加 `userId` 过滤：`session.userId !== req.userId` → 404
- 不存在的 session → 404
- **有权限和不存在的错误统一返回 404**，不暴露"存在但不是你的"

**MVP 强制登录：** `authMiddleware` 从阶段C起严格校验，不存在 `userId` 为 null 的绕过路径。

### C2：CORS 及安全

依照 `docs/interfaces.md` §5.3-5.4 实现：

**CORS 配置（由环境变量驱动）：**
- 变量名：`CORS_ORIGIN`（建议与 `FRONTEND_DOMAIN` 等价，`.env.example` 中注明两者关系）
- `.env.example` 增加 `CORS_ORIGIN="http://localhost:5173"`（本地 Vite 默认端口）
- 开发环境：`http://localhost:5173`
- 生产环境：部署前替换为实际前端域名（如 `https://handchat.vercel.app`）
- 允许多域名：生产环境 `origin: ['https://handchat.vercel.app', /\.railway\.app$/]`

**请求体大小限制（对齐 `docs/interfaces.md` §5.4）：**
- `express.json({ limit: '1mb' })`
- 帧 Base64 数据 ≤ 2MB（`docs/interfaces.md` §2.1.1）

**安全增强（推荐实施）：**
- 添加 `helmet` 中间件设置安全 HTTP 头
- 添加速率限制（`express-rate-limit`）：每 IP 每秒最多 10 个 WS 帧消息，防止 DoS
- 生产环境 `NODE_ENV=production` 时禁用详细错误堆栈输出

### C3：假翻译 → 真实模式切换

`fakeTranslator.ts` 导出 `startFakeTranslation`，`wsRouter.ts` 中：
- 环境变量 `FAKE_TRANSLATION=true` → 启用假翻译
- 环境变量 `FAKE_TRANSLATION=false`（或缺失）→ 只收 `translation` 存 DB，不主动推送

### C4：全局错误处理中间件

在 `index.ts` 所有路由挂载之后增加 500 兜底。错误响应格式对齐 `docs/interfaces.md` 附录A：

```ts
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled API error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});
```

路由内的 `try/catch` 改为 `next(err)` 即可。

### C5：selfcheck 脚本填充

`scripts/selfcheck.mjs` 顺序执行：
1. `GET /health` → 200
2. Prisma 数据库连接检查（执行轻量查询验证连通性）
3. WebSocket ping/pong
4. 发送 `session_start`（带合法 token）→ 验证收到 `session_created` + 假翻译流（每 1.8s 一条）
5. 发送 `session_start`（不带 token）→ 验证收到 error 4003
6. 发送有效 `frame` 消息 → 验证无 error
7. 发送缺少 `image` 字段的 `frame` → 验证收到 error 4001
8. 发送有效 `keypoints` 消息（含 21 关键点）→ 验证无 error
9. 发送 `keypoints` 消息（`keypoints` 数组长度 ≠ 21）→ 验证收到 error 4001
10. 发送 `translation` 消息 → 验证无 error 且 DB 有新记录
11. 发送 `session_end` → 验证连接关闭（code 1000）
12. `GET /api/sessions/:id/history`（带合法 token）→ 返回数据
13. `GET /api/sessions/:id/history`（无 token）→ 401

### C6：API 文档产出

`backend/api-doc.md`：
- `GET /api/sessions` — 我的会话列表（需 Bearer Token）
- `GET /api/sessions/:id` — 会话详情
- `GET /api/sessions/:id/history?limit=50` — 会话翻译历史
- WebSocket `ws://<host>:3001` — 连接后需先发 `session_start` 带 token

### 阶段C完成标志

| # | 验证项 | 说明 |
|---|--------|------|
| 1 | `GET /api/sessions` 返回当前用户的会话列表 | 按 startedAt 倒序，含翻译条数和最后一条预览 |
| 2 | `GET /api/sessions/:id/history` 只能查自己的 | 非本人会话返回 404 |
| 3 | 不存在的 session 返回 404 | 无权限也是 404 |
| 4 | 未带 Token 的请求返回 401 | `authMiddleware` 生效 |
| 5 | CORS 跨域正常 | 前端能正常调用 API |
| 6 | API 文档已产出 | `backend/api-doc.md` |
| 7 | 全局错误处理不下线 | 未 catch 的错误返回 500 而非挂进程 |

---

## 五、阶段D：集成与部署

> **目标：** 2-3天。联调、Docker化、Railway上线。

### 架构原则：前端不直连数据库

前端与后端的数据交互仅通过 **REST API（`/api/sessions/*`）** 和 **WebSocket（`ws://`）** 进行。前端不使用 Supabase SDK 直连数据库。

### 关于模型侧连接方式的重要说明

**MVP 阶段不存在独立的"模型服务"。** 模型（MediaPipe Hands + DTW）跑在前端浏览器内，翻译结果由前端本地产出后通过 WebSocket `translation` 消息发给后端存储。不存在"模型侧作为一个独立进程连接后端"的场景。

**LLM 增强阶段（未来）** 才需要后端调用外部 LLM API 进行句子整合，接口待那时再定义。当前 `wsRouter.ts` 中 `translation` 分支已预留此插口。

---

### D1：假数据全链路跑通（本地）

后端提供 `ws://localhost:3001` → 前端连接 → `session_start` 带 token → 收到假翻译流 → 前端气泡弹出。

**你需要给 A 同学的两个地址（对齐 `docs/interfaces.md` §3.5 和 §4.0）：**

| 环境 | WebSocket | REST API |
|------|-----------|----------|
| 本地开发 | `ws://localhost:3001` | `http://localhost:3001/api` |
| 生产环境 | `wss://<app>.up.railway.app` | `https://<app>.up.railway.app/api` |

**部署后立即发生产地址给 A 同学，并确认他能连上。**

---

### D2：替换假翻译为真实模式

环境变量 `FAKE_TRANSLATION=false`（或缺失）→ 假翻译引擎不启动，`wsRouter` 只接收前端发来的 `translation` 并存入 DB，不做主动推送。

---

### D3：数据库迁移自动化

**必须确保每次部署时数据库 schema 都是最新的。** 两条路径都要覆盖：

**路径1 — `package.json` 的 `start` 脚本（源码部署时生效）：**
```json
"start": "npx prisma migrate deploy && node dist/index.js"
```

**路径2 — Dockerfile 的 CMD（容器部署时生效）：**
```dockerfile
CMD npx prisma migrate deploy && pnpm start
```

`prisma migrate deploy` 只执行未应用的迁移，不会触发危险的 reset。迁移失败导致容器/进程启动失败，是一种"失败即停止"的安全保护。

---

### D4：Docker 化（可选保留）

```dockerfile
FROM node:20-alpine
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY . .
RUN npx prisma generate
EXPOSE 3001
CMD npx prisma migrate deploy && pnpm start
```

**备注：** Railway 支持从 `Dockerfile` 或源码直接部署。MVP 推荐源码部署以降低复杂度，`Dockerfile` 和 `docker-compose.yml` 保留作为容器化备选。

---

### D5：Railway 部署清单

**部署步骤：**

1. `railway login` → `railway link`
2. Railway Dashboard → 设置以下环境变量（见下）
3. Railway Dashboard → Settings → **Health Check Path 设为 `/health`**（Railway 默认检查 `/`，需要手动改）
4. `railway up`

**生产环境变量清单（部署前逐项核对，对齐 `docs/interfaces.md` §5.2 和 §5.3）：**

| 变量名 | 说明 | 注意 |
|--------|------|------|
| `DATABASE_URL` | Supabase 生产数据库连接串（Session Pooler 端口 6543） | **不要用本地开发库** |
| `SUPABASE_URL` | `https://jgverskznikedselvshj.supabase.co` | 与客户端相同 |
| `SUPABASE_ANON_KEY` | Supabase 匿名密钥 | 用于验证 JWT（对齐 `docs/interfaces.md` §5.2） |
| `CORS_ORIGIN` | 前端部署后的域名 | 如 `https://handchat.vercel.app`（对齐 `docs/interfaces.md` §5.4） |
| `NODE_ENV` | `production` | 必须 |
| `FAKE_TRANSLATION` | `true` 或 `false` | 联调时 true，接入真实模型后 false |
| `PORT` | **不设** | Railway 自动注入 |

---

### D6：全链路集成测试

`scripts/integration-test.mjs` — 一键端到端验证：

1. `GET /health` → 确认 200
2. WS 连接 → 发送 `session_start` + JWT token → 验证收到 `session_created` 和假翻译流
3. 发送有效 `frame` 消息 → 验证无 error
4. 发送有效 `keypoints` 消息（含 21 关键点）→ 验证无 error
5. 发送 `translation` 消息（含 text/confidence/type）→ 验证 DB 有对应记录
6. `GET /api/sessions/:id/history` 带合法 token → 确认返回翻译记录
7. `GET /api/sessions/:id/history` 不带 token → 确认 401
8. 查询他人的 session → 确认 404（统一权限模型）
9. 发送缺少 `image` 字段的 `frame` → 确认返回 error 4001
10. 发送 `keypoints` 消息（keypoints 长度 ≠ 21）→ 确认返回 error 4001
11. 发送 `session_end` → 确认连接正常关闭（code 1000）
12. DB 检查 → Prisma Studio 中 Session 有 `endedAt`，Translation 记录完整

`package.json` 增加：`"test:integration": "node scripts/integration-test.mjs"`

**部署后用 `pnpm run test:integration` 一键验证，全绿才算"部署成功"。**

---

### 阶段D完成标志

| # | 验证项 | 方式 |
|---|--------|------|
| 1 | Railway 部署成功，`/health` 返回 200 | 浏览器访问 |
| 2 | 数据库迁移生效，Schema 与代码一致 | Prisma Studio 或 Supabase 面板 |
| 3 | WebSocket 连接正常，假翻译流可接收 | wscat 连 `wss://域名` 并认证 |
| 4 | 前端能跨域调用 REST API | A 同学反馈 |
| 5 | 集成测试脚本全绿 | `pnpm run test:integration` |
| 6 | 环境变量全部配置正确，无 FATAL 日志 | Railway 日志面板 |
| 7 | 生产地址已发给 A 同学并确认连通 | A 同学回复 |

---

## 六、关键决策记录

| 日期 | 决策 | 结论 |
|------|------|------|
| 2026-05-14 | JWT 验证方式 | 方案A：引入 `@supabase/supabase-js` 验证 |
| 2026-05-14 | 用户表设计 | 不建 User 表，userId 直接存 Supabase Auth sub |
| 2026-05-14 | sessionId 生成方 | 后端生成 UUID，通过 `session_created` 返回 |
| 2026-05-14 | 会话恢复 | 支持 `resume_session_id`，沿用 active 旧会话 |
| 2026-05-14 | LLM 句子整合 | 追加模式（原始词先显示，LLM润色版追加） |
| 2026-05-14 | translation 流向 | MVP：前端→后端（只存储）；LLM：后端→前端（推送sentence_final） |
| 2026-05-14 | 认证中间件 | 阶段A占位，阶段C正式启用 |
| 2026-05-14 | MVP 登录策略 | 强制登录，userId 不可为 null |
| 2026-05-14 | REST API 权限 | userId 过滤 + 统一404（不暴露"存在但不是你的"） |
| 2026-05-14 | CORS 域名 | 环境变量 `CORS_ORIGIN` 驱动，不硬编码（对齐 `docs/interfaces.md` §5.4） |
| 2026-05-14 | 前端数据访问 | 仅通过 REST API + WebSocket，不直连数据库 |
| 2026-05-14 | 数据库迁移 | `start` 和 Dockerfile 均自动跑 `prisma migrate deploy` |
| 2026-05-14 | Railway 健康检查 | Health Check Path 设为 `/health` |
| 2026-05-14 | 模型侧连接 | MVP 不存在独立模型服务，translation 由前端 WS 发送 |
| 2026-05-14 | Railway 部署方式 | MVP 推荐源码部署，Dockerfile 作为备选 |
| 2026-05-14 | 集成测试 | `scripts/integration-test.mjs` + `pnpm run test:integration` |
| 2026-05-14 | 前端对接交付 | 部署后立即发 WS 和 REST API 地址给 A 同学 |
| 2026-05-14 | 全局错误处理 | Express 统一 500 兜底中间件 |
| 2026-05-14 | 日志持久化 | MVP用 stdout，Docker/Railway 自动收集 |
| 2026-05-14 | selfcheck 脚本 | 预留声明，阶段C填充完整 |

---

## 七、后端自测方式（完全不依赖其他模块）

自测基准对齐 `docs/interfaces.md` 中的协议定义：

| 测试场景 | 命令/脚本 | 预期 |
|---------|----------|------|
| 服务启动 | `pnpm dev` | `Server running on port 3001` |
| 健康检查 | `curl localhost:3001/health` | `{"status":"ok"}` |
| WS ping/pong | wscat 发 `{"type":"ping","trace_id":"x","timestamp_ms":0}` | 收到 `{"type":"pong"}` |
| 会话启动 | wscat 发 `session_start` + token | 收到 `session_created` + 假翻译流（每 1.8s 一条） |
| 无效帧（缺 image） | wscat 发 `{"type":"frame","payload":{"session_id":"test"}}` | 收到 `{"type":"error","payload":{"code":4001}}` |
| 无效帧（缺 session_id） | wscat 发 `{"type":"frame","payload":{"frame_id":0}}` | 收到 error 4002（无活跃会话） |
| 有效关键点 | wscat 发 `keypoints`（hands[0].keypoints 长度=21） | 无 error，日志含 hands 数量 |
| 无效关键点（长度≠21） | wscat 发 `keypoints`（keypoints 长度=10） | 收到 error 4001 |
| 有效翻译 | wscat 发 `translation`（含 text/confidence/type） | 无 error，DB 新增记录 |
| 无效翻译（缺 text） | wscat 发 `translation`（payload 不含 text） | 收到 error 4001 |
| 缺 token 会话启动 | wscat 发 `{"type":"session_start","payload":{}}` | 收到 error 4003（认证失败） |
| 会话结束 | wscat 发 `{"type":"session_end","payload":{"session_id":"<id>"}}` | 连接关闭（code 1000），DB endedAt 更新 |
| 历史查询 | `curl .../api/sessions/:id/history` + Bearer token | JSON 数组，字段含 text/confidence/type/gestureLabel/frameId/createdAt |
| 无 token 查历史 | `curl .../api/sessions/:id/history`（无 Header） | 401 |
| 查他人会话 | `curl .../api/sessions/<other-id>/history` + token | 404 |
| 数据库 | `npx prisma studio` | Session、Translation 表有数据 |
| 全量自检 | `pnpm run selfcheck` | 全部 PASS |
| 集成测试 | `pnpm run test:integration` | 全部 PASS |
