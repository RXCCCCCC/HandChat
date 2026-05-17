# HandChat：Demo → MVP 重构变更总结

## 定位变化

| | 旧（Demo） | 新（MVP） |
|------|-----------|-----------|
| **产品定位** | 多功能无障碍助手 | 聚焦**实时手语→文字翻译** |
| **辅助功能** | OCR识别、环境音检测、社区、积分、成就、用户协议、帮助中心 | 前端保留页面（假数据），后端接口已预留 |

---

## 技术架构变化

| 方面 | 旧（Demo） | 新（MVP） |
|------|-----------|-----------|
| **手部检测** | `@tensorflow-models/hand-pose-detection`（TensorFlow.js，体积大、不稳定） | `@mediapipe/hands` WASM（更准、更快、离线可用） |
| **手势分类器** | 启发式 if-else 规则（8个手势硬编码） | DTW 模板匹配（新增手势只需录制模板，不写代码） |
| **后端** | 无——Supabase SDK 前端直连数据库 | **Express + WebSocket + Prisma ORM** |
| **数据库** | 无 Schema 设计，localStorage 假数据 | Session + Translation 两张表，Prisma 自动迁移 |
| **通信方式** | REST 假调用 | **WebSocket 实时双向** + REST API |
| **认证** | 前端 localStorage 假登录 | **Supabase JWT**（WS + REST 双重校验，强制登录） |
| **架构策略** | 各模块松散耦合，无联调 | **接口先行 → 并行开发 → 分步集成** |

---

## 新增后端体系

| 能力 | 说明 |
|------|------|
| WebSocket 服务器 | 9 种消息类型（session_start/frame/keypoints/translation/session_end/ping/pong/error/session_created） |
| REST API | `GET /api/sessions`、`GET /api/sessions/:id`、`GET /api/sessions/:id/history` |
| 假翻译引擎 | 不依赖模型侧，5条预定义翻译循环推送，`safeSend` 异常保护 |
| 帧验证器 | 必填字段校验、Base64 ≤ 2MB、colorspace 告警、session_id 匹配 |
| 认证中间件 | Supabase JWT 验证，阶段A占位、阶段C启用 |
| 会话管理 | 后端生成 UUID、支持 resume 恢复、30s 心跳僵尸连接检测 |
| 数据库迁移 | `prisma migrate deploy` 自动执行（Dockerfile + package.json start 脚本均覆盖） |
| 自测体系 | `pnpm run selfcheck`（阶段C）+ `pnpm run test:integration`（阶段D） |

---

## 后端四阶段开发计划

| 阶段 | 内容 | 耗时 | 依赖 |
|------|------|------|------|
| **A: 基础设施** | 项目骨架、Prisma+DB、认证占位、日志、WS心跳 | 1-2天 | 无 |
| **B: WS协议层** | 假翻译引擎、消息路由、帧验证器 | 2-3天 | 接口文档冻结 |
| **C: 业务服务层** | REST API+权限、CORS、全局错误处理、API文档 | 1-2天 | 阶段B |
| **D: 集成部署** | 联调、Docker、Railway上线、集成测试 | 2-3天 | 前端就绪 |

---

## 保留不变

- React 18 + Vite + Tailwind CSS + shadcn/ui 前端技术栈
- Supabase 项目及 Auth 复用（`jgverskznikedselvshj`）
- 社区、成就、积分等页面前端保留，接口已在文档预留
- LoginPage 保留，接入 Supabase 真实验证

---

## 产出文档

| 文档 | 路径 | 用途 |
|------|------|------|
| 后端技术文档 | `.trae/documents/backend-development-plan.md` | 唯一开发参考源，含 22 项关键决策 |
| 全项目接口文档 | `docs/interfaces.md` | 三端共同遵守的数据协议，🔒冻结 |
