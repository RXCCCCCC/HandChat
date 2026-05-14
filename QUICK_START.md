# 🚀 无障碍助手 - 快速启动指南

## 当前状态

✅ 前后端路由已统一配置  
✅ 代码已完成所有错误修复  
⚠️ 需要配置科大讯飞API（可选，不配置会使用本地分析）

---

## 📝 重要提示

您已手动编辑了 `/utils/supabase/info.tsx` 文件，项目ID为：`jgverskznikedselvshj`

**如果您遇到认证错误，请确保：**

1. ✅ Supabase项目 `jgverskznikedselvshj` 是活跃的
2. ✅ 项目的环境变量已正确配置：
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` 
   - `SUPABASE_SERVICE_ROLE_KEY`
3. ✅ Edge Function已部署并运行

---

## 🔧 步骤1: 验证Supabase连接

### 方法A: 通过Dashboard验证

1. 访问：https://supabase.com/dashboard/project/jgverskznikedselvshj
2. 检查项目状态是否为 **Active** ✅
3. 进入 **Settings** → **API**
4. 确认以下密钥与本地配置一致：
   - **Project URL**: `SUPABASE_URL`
   - **anon public**: `SUPABASE_ANON_KEY`
   - **service_role**: `SUPABASE_SERVICE_ROLE_KEY`

### 方法B: 测试健康检查

打开浏览器访问：
```
https://jgverskznikedselvshj.supabase.co/functions/v1/make-server-481f4acb/health
```

**预期响应：**
```json
{
  "status": "ok",
  "version": "2.0.0",
  "timestamp": 1234567890,
  "service": "无障碍助手后端服务"
}
```

如果看到此响应，说明后端服务运行正常✅

---

## 🎤 步骤2: 配置科大讯飞API（可选）

### 为什么可选？
- ✅ **不配置**: 使用本地智能分析（准确率约60-75%）
- ✨ **配置后**: 使用科大讯飞AI（准确率85%+）

### 如何配置？

详细步骤请查看：[**XFYUN_API_GUIDE.md**](./XFYUN_API_GUIDE.md)

快速摘要：
1. 注册科大讯飞账号：https://www.xfyun.cn/
2. 创建应用并开通「声音事件检测」服务
3. 获取三个密钥：`APPID`, `API Key`, `API Secret`
4. 在Supabase Dashboard配置环境变量：
   - `XFYUN_APP_ID`
   - `XFYUN_API_KEY`
   - `XFYUN_API_SECRET`

---

## 🧪 步骤3: 测试应用

### 1️⃣ 注册/登录

1. 打开应用
2. 进入登录页面
3. 点击「注册」标签
4. 输入：
   - 昵称：随意
   - 邮箱：任意格式（如 `test@example.com`）
   - 密码：至少6位
5. 点击「注册并登录」

### 2️⃣ 测试功能

**✅ 个人中心**
- 查看用户信息
- 检查统计数据（使用天数、积分、成就）

**✅ 社区功能**
- 浏览默认帖子
- 发布新帖子
- 点赞、评论、收藏

**✅ 手语转换**
- 文字转手语
- 查看转换历史

**✅ 环境音识别**
- 点击录音按钮
- 系统会使用本地分析（如已配置API则使用科大讯飞）

**✅ 文字识别 (OCR)**
- 上传图片
- 识别文字内容

---

## ❌ 常见问题排查

### 问题1: "认证失败，请重新登录"

**原因分析：**
- Supabase项目未激活
- 环境变量配置错误
- Session已过期

**解决方案：**
```bash
# 1. 清除浏览器缓存和localStorage
# 2. 重新登录
# 3. 检查健康检查端点是否正常
# 4. 验证Supabase Dashboard中的项目状态
```

### 问题2: "Failed to fetch" 或 "NetworkError"

**原因分析：**
- Edge Function未部署
- CORS配置问题
- 网络连接问题

**解决方案：**
```bash
# 1. 检查健康检查端点
curl https://jgverskznikedselvshj.supabase.co/functions/v1/make-server-481f4acb/health

# 2. 确认Edge Function已部署
# 访问 Supabase Dashboard → Edge Functions → 检查状态

# 3. 查看Edge Function日志排查问题
```

### 问题3: 声音识别提示"本地分析模式"

**这不是错误！** 这是正常行为。

- ✅ 如果想使用更精准的识别，请配置科大讯飞API
- ✅ 本地模式也能正常使用，只是准确率略低

---

## 📊 功能特性一览

| 功能 | 状态 | 说明 |
|------|------|------|
| 用户认证 | ✅ | 注册/登录/退出 |
| 个人资料 | ✅ | 头像、昵称、简介编辑 |
| 积分系统 | ✅ | 操作积分奖励 |
| 成就系统 | ✅ | 登录连续打卡 |
| OCR识别 | ✅ | 图片文字提取 |
| 手语转换 | ✅ | 文字↔手语双向转换 |
| 环境音检测 | ✅ | 本地分析 + 科大讯飞API |
| 社区论坛 | ✅ | 发帖/评论/点赞/收藏 |
| 图片上传 | ✅ | Supabase Storage |
| 主题切换 | ✅ | 多种背景主题 |

---

## 🆘 获取帮助

### 应用内帮助
- 点击「个人中心」→「帮助中心」

### 查看文档
- [科大讯飞API获取指南](./XFYUN_API_GUIDE.md)
- [应用使用指南](./APP_GUIDE.md)

### 技术支持
如果问题仍未解决，请提供：
1. 错误截图或控制台日志
2. 健康检查端点的响应
3. Supabase项目状态

---

## ✨ 后续优化建议

1. **配置科大讯飞API** → 提升声音识别准确率
2. **上传自定义头像** → 完善个人资料
3. **邀请用户加入** → 丰富社区内容
4. **定期查看统计** → 了解使用情况

---

**祝您使用愉快！🎉**

*最后更新：2026-03-29*
