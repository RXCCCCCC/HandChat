# HandChat 前后端联调交接文档

## 1. 文档目的

这份文档不再是前端阶段任务清单，而是当前 HandChat 手语模块的联调交接说明，准备直接交给后端同事开始接入真实服务。

当前前端已经完成 `P0 + P1 + P1.5 + P2` 范围内的主要工作，页面、协议层、会话层、历史页、详情页都已经接好，接下来进入“真实后端联调”阶段。

---

## 2. 唯一联调规范

- 唯一冻结规范：`interfaces.md`
- 前后端联调必须以 `interfaces.md` 中的字段名、类型、必填/可选、错误码定义为准
- 前端已经按该规范实现主要消息类型与状态流，后端不要再自行发明新的字段命名
- 如果后端确实需要改协议，必须先更新 `interfaces.md`，再同步改前端

---

## 3. 当前前端已完成情况

### 3.1 主流程能力

前端已经具备以下能力：

- 手语识别页面支持两种实时模式：
  - `browser`：浏览器本地识别模式
  - `server`：真实服务模式
- 摄像头帧已经按规范处理为 `256x256`
- JPEG/Base64 输出格式已经统一
- 关键点结果已经转换为 `KeypointsPayload`
- 翻译结果展示已经对齐：
  - `partial`
  - `final`
  - `sentence_end`
  - `sentence_final`
- 会话生命周期已经接入页面状态流：
  - 创建
  - 恢复
  - 结束

### 3.2 协议与运行时能力

前端协议层已经具备：

- `WebSocket` 客户端
  - 连接
  - 首包认证
  - 心跳 `ping`
  - 自动重连
  - `session_created` 解析
  - `session_end` 发送
- REST 会话查询客户端
  - 会话列表
  - 会话详情
  - 会话历史
- 错误码映射与可读错误提示
- 网络断开/恢复提示
- 会话历史数据源切换：
  - `browser`
  - `mock`
  - `server`

### 3.3 页面交付情况

当前手语模块页面已经具备：

- `SignLanguagePage`
  - 实时识别主页面
  - 运行模式切换
  - 服务连接状态展示
  - 最近会话展示
- `SignLanguageHistoryPage`
  - 会话历史列表页
  - `browser/mock/server` 数据源切换
- `SignLanguageSessionDetailPage`
  - 单个会话详情页
  - 会话历史明细查看

对应路由：

- `/sign-language`
- `/sign-language/history`
- `/sign-language/history/:sessionId`

### 3.4 当前验证情况

已经完成的验证：

- 前端构建通过
- 主要修改文件无明显 TypeScript 诊断问题
- 登录鉴权流程可进入受保护页面
- 历史页、详情页、mock 数据切换可正常工作

尚未被完整自动化验证的部分：

- 真实摄像头 + 真实 `WebSocket` 服务 + 实时推理链路

原因不是前端代码未接，而是当前仓库内真实后端服务尚未与前端新协议链路完全对上，因此这一部分需要接下来由后端同事配合完成联调。

---

## 4. 当前前端代码入口

后端同事如果要快速理解前端依赖，优先看这些文件：

### 4.1 协议与运行时

- `src/app/lib/handchat/types.ts`
  - `interfaces.md` 对应的前端类型定义
- `src/app/lib/handchat/wsClient.ts`
  - 实时连接、认证、心跳、重连、会话创建
- `src/app/lib/handchat/sessionApi.ts`
  - REST 会话接口调用
- `src/app/lib/handchat/runtime.ts`
  - `WS` / `REST` 服务地址来源
- `src/app/lib/handchat/errorMapping.ts`
  - 错误码到用户提示的映射
- `src/app/lib/handchat/sessionDataSource.ts`
  - `browser/mock/server` 数据源统一入口

### 4.2 页面

- `src/app/pages/SignLanguagePage.tsx`
  - 实时识别主流程入口
- `src/app/pages/SignLanguageHistoryPage.tsx`
  - 会话历史列表
- `src/app/pages/SignLanguageSessionDetailPage.tsx`
  - 会话详情和翻译历史

---

## 5. 前端当前依赖的后端能力

### 5.1 WebSocket 地址

前端读取：

- `VITE_HANDCHAT_WS_URL`

默认值：

- `ws://localhost:3001`

也就是说，后端只要先提供一个本地可连的 `WS` 服务，前端切到 `server` 模式就可以开始联调。

### 5.2 REST 地址

前端读取：

- `VITE_HANDCHAT_API_URL`

默认值：

- `https://jgverskznikedselvshj.supabase.co/functions/v1/api`

注意：

- 当前仓库中已有的老接口主要是 `/make-server-481f4acb/...`
- 但新的 HandChat 会话页联调用的是 `/api/sessions...`
- 这意味着后端现在需要补齐新的会话接口，而不是只复用旧的 `sign-language/history`

### 5.3 认证方式

前端 REST 请求会带：

- `Authorization: Bearer <supabase access token>`
- `apikey: <public anon key>`

前端 `WebSocket` 首条消息会发送：

- `session_start.payload.token`

也就是说，后端需要基于 Supabase JWT 做用户鉴权，并把会话归属到当前用户。

---

## 6. 前端已按协议实现的数据结构

### 6.1 WebSocket 客户端消息

前端已经会发送：

- `session_start`
- `frame`
- `keypoints`
- `translation`
- `session_end`
- `ping`

其中关键字段约定如下：

#### `session_start`

```ts
{
  type: "session_start",
  payload: {
    token: string,
    resume_session_id?: string
  },
  trace_id: string,
  timestamp_ms: number
}
```

#### `frame`

```ts
{
  type: "frame",
  payload: {
    session_id: string,
    frame_id: number,
    timestamp_ms: number,
    image: {
      data: string,
      width: number,
      height: number,
      colorspace: "RGB",
      crop?: { x?: number, y?: number, width?: number, height?: number }
    },
    client_metadata?: {
      fps_actual?: number,
      device_pixel_ratio?: number
    }
  }
}
```

#### `keypoints`

```ts
{
  type: "keypoints",
  payload: {
    session_id: string,
    frame_id: number,
    hands: [
      {
        handedness: "Left" | "Right",
        score: number,
        keypoints: { x: number, y: number, z: number }[],
        keypoints_3d: { x: number, y: number, z: number }[]
      }
    ]
  }
}
```

#### `translation`

```ts
{
  type: "translation",
  payload: {
    session_id: string,
    frame_id: number,
    type: "partial" | "final" | "sentence_end" | "sentence_final",
    text: string,
    confidence: number,
    gesture_label?: string
  }
}
```

### 6.2 WebSocket 服务端消息

前端当前会处理：

- `session_created`
- `translation`
- `pong`
- `error`

其中 `session_created` 是当前主流程的关键返回：

```ts
{
  type: "session_created",
  payload: {
    id: string,
    status: "active" | "ended"
  }
}
```

---

## 7. 后端现在必须完成的任务

下面这些是给后端同事的明确任务清单，按优先级从高到低排序。

### 7.1 必须完成：真实 WebSocket 服务

后端需要提供真实 `WS` 服务，至少满足以下行为：

1. 连接建立后，前端发送第一条 `session_start`
2. 后端校验 `payload.token`
3. 如果 `resume_session_id` 有值：
   - 会话存在且仍是 `active`，则恢复该会话
   - 否则创建新会话
4. 返回 `session_created`
5. 接收后续消息：
   - `frame`
   - `keypoints`
   - `translation`
   - `ping`
   - `session_end`
6. `session_end` 时关闭会话并正常断开连接
7. 非正常断开时，允许前端自动重连并继续恢复会话

### 7.2 必须完成：真实 REST 会话接口

前端已经按下面接口写死调用方式，后端需要落地：

#### `GET /api/sessions?limit=20&offset=0`

返回：

```ts
type SessionSummary = {
  id: string;
  status: "active" | "ended";
  startedAt: string;
  endedAt: string | null;
  translationCount: number;
  lastTranslation: string | null;
}[];
```

#### `GET /api/sessions/:id`

返回：

```ts
type SessionDetail = {
  id: string;
  status: "active" | "ended";
  startedAt: string;
  endedAt: string | null;
  translationCount: number;
};
```

#### `GET /api/sessions/:id/history?limit=100`

返回：

```ts
type SessionHistoryItem = {
  text: string;
  confidence: number;
  type: "partial" | "final" | "sentence_end" | "sentence_final";
  gestureLabel: string | null;
  frameId: number;
  createdAt: string;
}[];
```

### 7.3 必须完成：错误码与异常返回

后端需要严格对齐这些错误码：

- `4001`：消息格式错误
- `4002`：无活跃会话
- `4003`：认证失败
- `4004`：`session_id` 不匹配
- `5001`：推理超时
- `5002`：服务器过载

前端已经写好这些错误码的提示映射，后端只要稳定返回即可。

### 7.4 必须完成：会话数据持久化

后端需要保证至少以下数据能被持久化并可查询：

- 会话主表
  - `id`
  - `user_id`
  - `status`
  - `started_at`
  - `ended_at`
- 翻译历史表
  - `session_id`
  - `frame_id`
  - `text`
  - `confidence`
  - `type`
  - `gesture_label`
  - `created_at`

如果会话历史没有落库，前端的历史页和详情页在 `server` 模式下就无法真正可用。

### 7.5 必须完成：鉴权与归属校验

后端需要确保：

- REST 只能读到当前登录用户自己的会话
- `WS` 建立后，会话归属绑定到当前 JWT 对应用户
- 查询 `session_id` 时要校验是否属于当前用户
- 恢复会话时不能恢复到别人的会话

---

## 8. 当前仓库里的后端现状判断

结合当前仓库代码，可以明确看到：

- 已有旧接口：
  - `/make-server-481f4acb/sign-language/history`
- 但前端新联调链路依赖的是：
  - `/api/sessions`
  - `/api/sessions/:id`
  - `/api/sessions/:id/history`
  - 真实 `WebSocket` 会话服务

也就是说，当前后端仓库里“旧手语历史接口”并不能直接满足这次新的 HandChat 联调要求。

当前联调阻塞项主要有两个：

1. 缺少前端新会话体系对应的 REST 接口
2. 缺少与 `interfaces.md` 对齐的真实 `WebSocket` 服务

---

## 9. 建议后端联调顺序

建议后端按下面顺序推进，这样最省时间：

1. 先实现 `WS session_start -> session_created`
2. 再实现 `GET /api/sessions`
3. 再实现 `GET /api/sessions/:id`
4. 再实现 `GET /api/sessions/:id/history`
5. 再接入真实推理或假翻译流
6. 最后补齐错误码、超时、过载、恢复会话边界场景

原因：

- 前端主页面先需要真实拿到 `session_id`
- 历史页和详情页需要 REST 数据落地
- 只要上述两段打通，前后端就能进入完整联调循环

---

## 10. 联调验收标准

后端完成后，至少要一起走通下面这组验收：

### 10.1 实时链路

- 登录后进入 `/sign-language`
- 切到 `server` 模式
- 成功建立 `WS` 连接
- 返回 `session_created`
- 前端持续发送 `frame / keypoints / translation`
- 后端可正常接收并落库
- 点击停止后发送 `session_end`

### 10.2 历史链路

- 进入 `/sign-language/history`
- 切换到 `server`
- 能看到真实会话列表
- 点进任意会话能看到详情
- 能看到对应翻译历史

### 10.3 异常链路

- token 失效时返回 `4003`
- session 失效时返回 `4002`
- session 不匹配时返回 `4004`
- 服务过载时返回 `5002`
- 网络中断后前端可看到重连提示

---

## 11. 给后端同事的一句话结论

前端现在已经不是“等着继续开发页面”，而是已经把真实联调入口准备好了。后端接下来最重要的是：

- 按 `interfaces.md` 落地真实 `WebSocket`
- 补齐 `/api/sessions` 系列接口
- 做好 Supabase JWT 鉴权和会话归属

只要这三块完成，前端现有页面就能直接进入真正的联调与验收。
