# StudyPulse Cloud AI — API Documentation

**Version:** `0.6-beta`
**Runtime:** Cloudflare Workers
**AI Provider:** MiniMax-M3 (OpenAI-compatible endpoint)
**Last Updated:** 2026-07-25

---

## 1. 概述

StudyPulse Cloud AI 是 StudyPulse 的 AI 后端网关，支持两种调用方式：

- **App 用户**：通过邮箱验证码登录获取 Session Token 调用 AI
- **Beta/开发者用户**：通过 API Key 调用 AI

两套体系最终统一关联到 `user_id`，共享会员权限和额度检查。

**架构:**

```
iOS App / 第三方客户端
    │  HTTPS
    ├─ Authorization: Bearer sp_sess_xxx  (Session Token)
    │  或
    ├─ X-API-Key: sp_beta_xxx            (API Key, 推荐)
    │  或
    └─ Authorization: Bearer sp_beta_xxx  (API Key, 兼容旧版)
    ▼
Cloudflare Worker  ──►  D1 (StudyPulseDB)
    │                     ├─ users / sessions / api_keys
    │                     ├─ membership_plans / usage_records
    │                     └─ request_logs / admin_logs
    │
    │  Bearer ${MINIMAX_API_KEY}
    ▼
MiniMax OpenAI-compatible API  (api.minimaxi.com)
```

---

## 2. 基础信息

| 项 | 值 |
|---|---|
| 协议 | HTTPS |
| 字符集 | UTF-8 |
| 请求体 | `application/json` |
| 响应体 | `application/json` |
| 时间格式 | ISO 8601 (UTC) |
| Base URL | `https://spapi.chenkai.space` (公开 API) / `https://admin.chenkai.space` (管理后台) |

---

## 3. 鉴权

### 3.1 App 用户鉴权（Session Token）

App 用户通过邮箱验证码登录获取 Session Token，使用 `Authorization: Bearer` 传递。

```
Authorization: Bearer sp_sess_<64位hex>
```

Session Token 有效期 30 天，支持多设备登录。

### 3.2 Beta/开发者鉴权（API Key）

API Key 通过 `X-API-Key` Header 传递（推荐），也兼容旧版 `Authorization: Bearer` 方式。

```
X-API-Key: sp_beta_<hex>
```

### 3.3 鉴权优先级

`/v1/chat` 接口的鉴权优先级：

1. `Authorization: Bearer sp_sess_xxx` → Session Token（App 用户）
2. `X-API-Key: sp_beta_xxx` → API Key（推荐方式）
3. `Authorization: Bearer sp_beta_xxx` → API Key（兼容旧版）

---

## 4. 用户认证接口

### 4.1 发送验证码

#### `POST /auth/email/send`

**请求体:**

```json
{
  "email": "user@example.com"
}
```

**成功响应 `200 OK`:**

```json
{
  "success": true
}
```

**错误响应:**

| HTTP | error | 说明 |
|---|---|---|
| 400 | `Invalid email format` | 邮箱格式不合法 |
| 429 | `Please wait before requesting a new code` | 1 分钟内重复发送 |
| 502 | `Email delivery failed` | 邮件发送失败 |

### 4.2 验证码登录

#### `POST /auth/email/verify`

**请求体:**

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**成功响应 `200 OK`:**

```json
{
  "success": true,
  "data": {
    "token": "sp_sess_a81f92..."
  }
}
```

**错误响应:**

| HTTP | error | 说明 |
|---|---|---|
| 400 | `Invalid verification code` | 验证码错误 |
| 400 | `Verification code already used` | 验证码已使用 |
| 400 | `Verification code expired` | 验证码过期（10 分钟） |
| 429 | `Verification code locked due to too many attempts` | 5 次错误尝试后锁定 |

> 新用户首次登录自动创建账号（role=user, membership=free）。

### 4.3 退出登录

#### `POST /auth/logout`

需要携带 Session Token。

```
Authorization: Bearer sp_sess_xxx
```

**成功响应 `200 OK`:**

```json
{
  "success": true
}
```

---

## 5. 错误码总表

| HTTP | error 字段 | 触发条件 |
|---|---|---|
| `400` | `Invalid JSON Body` | POST 请求体非合法 JSON |
| `401` | `Missing API Key or Session Token` | 未携带任何鉴权信息 |
| `401` | `Invalid or expired session` | Session Token 无效或过期 |
| `403` | `Invalid API Key` | Key 格式错误 / D1 中无此哈希 |
| `403` | `API Key disabled` | Key 已被管理员禁用 |
| `403` | `API Key expired` | Key 已超过 `expires_at` 有效期 |
| `404` | `Not Found` | 请求了未定义的路径 |
| `429` | `API quota exceeded` | API Key 额度用尽 |
| `429` | `Daily request limit exceeded` | 会员每日请求数用尽 |
| `429` | `Monthly token limit exceeded` | 会员月 Token 额度用尽 |
| `500` | `Server not configured: MINIMAX_API_KEY missing` | 服务端未配置上游 AI Key |
| `502` | `AI request failed` | 上游 MiniMax 调用失败 |

---

## 6. AI 对话接口

### `POST /v1/chat`

支持 Session Token 和 API Key 两种鉴权方式。

**请求头:**

| Header | 必填 | 说明 |
|---|---|---|
| `Authorization` | 二选一 | `Bearer sp_sess_xxx`（Session Token） |
| `X-API-Key` | 二选一 | `sp_beta_xxx`（API Key，推荐） |
| `Content-Type` | 是 | `application/json` |

**请求体（两种形态，二选一）:**

#### 形态 A：纯文本

```json
{
  "message": "你好"
}
```

#### 形态 B：多模态数组

```json
{
  "content": [
    { "type": "text", "text": "描述这张图" },
    {
      "type": "image_url",
      "image_url": { "url": "https://example.com/photo.jpg" }
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message` | string | 否 | 用户输入文本 |
| `content` | array | 否 | OpenAI 风格 content 数组（优先级高于 message） |
| `stream` | boolean | 否 | 是否启用 SSE 流式传输，默认 false |

**成功响应 `200 OK`:**

```json
{
  "success": true,
  "data": {
    "reply": "你好！有什么可以帮你的吗？"
  }
}
```

#### 流式响应 (`stream: true`)

响应切换为 SSE 格式（`Content-Type: text/event-stream`），透传 MiniMax 原始格式：

```
data: {"choices":[{"index":0,"delta":{"content":"你"},"finish_reason":null}]}
data: {"choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}
data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":15}}
data: [DONE]
```

**请求示例:**

```bash
# App 用户（Session Token）
curl -X POST https://spapi.chenkai.space/v1/chat \
  -H "Authorization: Bearer sp_sess_xxx" \
  -H "Content-Type: application/json" \
  -d '{"message":"你好"}'

# Beta 用户（API Key，推荐）
curl -X POST https://spapi.chenkai.space/v1/chat \
  -H "X-API-Key: sp_beta_xxx" \
  -H "Content-Type: application/json" \
  -d '{"message":"你好"}'

# Beta 用户（兼容旧版）
curl -X POST https://spapi.chenkai.space/v1/chat \
  -H "Authorization: Bearer sp_beta_xxx" \
  -H "Content-Type: application/json" \
  -d '{"message":"你好"}'

# 流式调用
curl -X POST https://spapi.chenkai.space/v1/chat \
  -H "X-API-Key: sp_beta_xxx" \
  -H "Content-Type: application/json" \
  -N \
  -d '{"message":"你好","stream":true}'
```

---

## 7. 会员与额度

App 用户和绑定用户的 API Key 共享统一的会员额度体系：

| 会员等级 | 每日请求数 | 月 Token 上限 |
|---|---|---|
| Free | 50 | 100,000 |
| Plus | 500 | 1,000,000 |
| Pro | 不限 | 不限 |

管理员（role=admin）调用 AI 不受额度限制。

旧版匿名 API Key（无 user_id 关联）继续使用 `api_keys` 表自身的 `request_limit` 控制。

---

## 8. 上游模型配置

| 项 | 值 |
|---|---|
| Provider | `minimax` |
| Endpoint | `https://api.minimaxi.com/v1/chat/completions` |
| Model | `MiniMax-M3` |
| Thinking | `disabled` |

---

## 9. 安全说明

- **Session Token**：仅存 SHA-256 哈希，原始 Token 登录时返回一次
- **API Key**：仅存 SHA-256 哈希，创建时返回一次原始 Key
- **邮箱验证码**：6 位数字，10 分钟过期，最多 5 次错误尝试
- **不记录** Prompt/Reply 文本内容
- 上游 AI Key 通过 Cloudflare Secret 注入

---

## 10. 版本历史

| 版本 | 变更 |
|---|---|
| `0.1-beta` | 基础 API Gateway, `/v1/chat` 回显 |
| `0.2-beta` | 接入 MiniMax-M3, 多模态支持 |
| `0.3-beta` | D1 鉴权, SHA-256 哈希存储 |
| `0.4-beta` | 额度控制, 请求日志, Key 管理 |
| `0.5-beta` | SSE 流式传输, 过期校验, Token 配额 |
| `0.6-beta` | SaaS 用户体系（邮箱登录 + Session Token + 会员系统 + 双鉴权） |
