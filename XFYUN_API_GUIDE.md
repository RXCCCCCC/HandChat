# 科大讯飞 API 获取指南

## 📋 概述

本应用使用科大讯飞的**声音事件检测**服务来识别环境声音（门铃、警报、敲门等）。以下是详细的API获取步骤。

---

## 🚀 步骤1: 注册科大讯飞账号

1. 访问科大讯飞开放平台：**https://www.xfyun.cn/**
2. 点击右上角「注册」按钮
3. 使用手机号或邮箱完成注册
4. 完成实名认证（需要上传身份证照片）

> 💡 提示：实名认证通过后才能使用API服务

---

## 🎯 步骤2: 创建应用

1. 登录后进入「控制台」：https://console.xfyun.cn/
2. 点击「我的应用」
3. 点击右上角「创建应用」按钮
4. 填写应用信息：
   - **应用名称**：填写"无障碍助手"或任意名称
   - **应用平台**：选择"WebAPI"
   - **应用领域**：选择"智能硬件"或"其他"
5. 点击「提交」完成创建

---

## 🔧 步骤3: 开通声音事件检测服务

1. 在「我的应用」页面，点击刚创建的应用
2. 找到「添加服务」按钮
3. 在服务列表中搜索「声音事件检测」
4. 点击「添加」或「开通」按钮

**服务路径**：
- 控制台 → 我的应用 → 选择应用 → 添加服务 → 语音听写/声音事件检测

**官方文档**：https://www.xfyun.cn/doc/asr/sound-event/API.html

---

## 🔑 步骤4: 获取API密钥

在应用详情页面，您会看到以下三个关键参数：

```
APPID:       12345678
API Key:     abcdef1234567890abcdef1234567890
API Secret:  1234567890abcdef1234567890abcdef
```

> ⚠️ **重要**：这些密钥非常重要，请妥善保管，不要泄露！

---

## 💰 步骤5: 了解计费方式

### 免费额度
- 新注册用户可获得 **500次** 免费调用（具体额度以官网为准）
- 免费额度有效期通常为 **1-3个月**

### 付费套餐
- **按量计费**：约 0.01-0.03 元/次
- **资源包**：可购买套餐包，价格更优惠
  - 1000次：约 20 元
  - 5000次：约 90 元
  - 10000次：约 160 元

> 💡 提示：开发测试阶段免费额度基本够用

---

## 📝 步骤6: 配置到应用中

### 方法1: 通过Supabase Dashboard配置（推荐）

1. 打开您的Supabase项目：https://supabase.com/dashboard/project/jgverskznikedselvshj
2. 进入左侧菜单「Settings」→「Edge Functions」
3. 点击「Secrets」选项卡
4. 添加以下三个环境变量：

```
名称: XFYUN_APP_ID
值: (您的APPID)

名称: XFYUN_API_KEY
值: (您的API Key)

名称: XFYUN_API_SECRET
值: (您的API Secret)
```

### 方法2: 通过Supabase CLI配置

```bash
# 安装Supabase CLI
npm install -g supabase

# 登录
supabase login

# 设置secrets
supabase secrets set XFYUN_APP_ID=你的APPID
supabase secrets set XFYUN_API_KEY=你的APIKey
supabase secrets set XFYUN_API_SECRET=你的APISecret
```

---

## ✅ 步骤7: 测试验证

配置完成后：

1. 重新部署Edge Function（如果需要）
2. 在应用中进入「环境音识别」页面
3. 点击「开始录音」按钮测试
4. 如果配置正确，您将看到识别结果

---

## 🔍 常见问题

### Q1: 如果不配置API会怎样？
A: 应用会自动降级到**本地分析模式**，使用基础算法进行声音分类，准确率较低但无需费用。

### Q2: API调用失败怎么办？
A: 检查以下几点：
- ✅ 密钥是否正确配置
- ✅ 免费额度是否用完
- ✅ 服务是否已开通
- ✅ 网络连接是否正常

### Q3: 如何查看调用量？
A: 登录科大讯飞控制台 → 数据统计 → 查看调用明细

### Q4: 支持哪些声音类型？
A: 常见类型包括：
- 🚪 敲门声
- 🔔 门铃声
- 📞 电话铃声
- 👶 婴儿哭声
- 🐕 狗叫声
- 🚨 警报声
- 🚗 汽车喇叭
- 🔨 玻璃破碎

---

## 📚 相关链接

- 科大讯飞官网：https://www.xfyun.cn/
- 控制台：https://console.xfyun.cn/
- 声音事件检测文档：https://www.xfyun.cn/doc/asr/sound-event/API.html
- 定价详情：https://www.xfyun.cn/services/sound-event

---

## 💬 需要帮助？

如果您在配置过程中遇到任何问题，可以：
1. 查看科大讯飞官方文档
2. 联系科大讯飞客服：400-9696-968
3. 查看应用内的帮助中心

---

**祝您使用愉快！🎉**
