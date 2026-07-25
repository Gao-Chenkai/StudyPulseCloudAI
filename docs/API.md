# StudyPulse Cloud AI — API Documentation

**Version:** `0.4-beta`
**Runtime:** Cloudflare Workers
**AI Provider:** MiniMax-M3 (OpenAI-compatible endpoint)
**Last Updated:** 2026-07-25

---

## 1. 概述

StudyPulse Cloud AI 是 StudyPulse iOS App 的 AI 后端网关。iOS 客户端不直接持有第三方 AI 服务密钥,统一通过本服务发起 AI 请求。

**架构:**

```
iOS App
    │  HTTPS  Authorization: Bearer sp_xxx
    ▼
Cloudflare Worker  ──►  D1 (StudyPulseDB)  校验 key_hash
    │
    │  Bearer ${MINIMAX_API_KEY}
    ▼
MiniMax OpenAI-compatible API  (api.minimaxi.com)
    │
    ▼
返回模型回复
```

**设计原则:**

- 客户端永远不接触第三方 AI Key,只持有 StudyPulse 自有的 `sp_` 前缀 Key
- 数据库只存 API Key 的 SHA-256 哈希,绝不存原始 Key
- 上游 AI Key 通过 Cloudflare Worker Secret 注入,不进代码、不进仓库
- 错误响应统一为 `{ "error": "..." }`,成功响应统一为 `{ "success": true, ... }`

---

## 2. 基础信息

| 项 | 值 |
|---|---|
| 协议 | HTTPS |
| 字符集 | UTF-8 |
| 请求体 | `application/json` |
| 响应体 | `application/json` |
| 时间格式 | ISO 8601 (UTC) |
| Base URL | 部署后由 Cloudflare Worker 域名决定,本地开发为 `http://localhost:8787` |

---

## 3. 鉴权

### 3.1 鉴权方式

所有需要鉴权的接口必须携带 `Authorization` Header,使用 Bearer scheme:

```
Authorization: Bearer <API_KEY>
```

### 3.2 API Key 规范

- 前缀:`sp_`(所有正式 Key 必须以此开头)
- 示例:`sp_beta_test001`
- 存储:服务端只存 `SHA-256(key)` 的 hex 摘要,即便数据库泄露也无法还原 Key

### 3.3 校验流程

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Header 是否存在?           否 → 401 Missing API Key      │
├──────────────────────────────────────────────────────────────┤
│ 2. 是否 Bearer scheme?        否 → 403 Invalid API Key      │
├──────────────────────────────────────────────────────────────┤
│ 3. D1 查 sha256(key) 命中?   否 → 403 Invalid API Key      │
│    且 enabled = 1?             否 → 403 API Key disabled     │
├──────────────────────────────────────────────────────────────┤
│ 4. request_count < limit?    否 → 429 API quota exceeded    │
│    (limit 为 NULL 时跳过)                                    │
├──────────────────────────────────────────────────────────────┤
│ 5. 通过 → 返回 { ok: true, apiKey }                         │
└──────────────────────────────────────────────────────────────┘
```

> **额度计数规则**:`request_count` 仅在 MiniMax 调用成功后自增。鉴权失败、上游 AI 失败、Worker 内部错误均不计次。

---

## 4. 错误码总表

| HTTP | error 字段 | 触发条件 |
|---|---|---|
| `400` | `Invalid JSON Body` | POST 请求体非合法 JSON |
| `401` | `Missing API Key` | 未携带 `Authorization` Header |
| `403` | `Invalid API Key` | Key 格式错误 / D1 中无此哈希 |
| `403` | `API Key disabled` | Key 已被管理员禁用 |
| `404` | `Not Found` | 请求了未定义的路径 |
| `429` | `API quota exceeded` | 累计请求次数达到 `request_limit` 上限 |
| `500` | `Server not configured: MINIMAX_API_KEY missing` | 服务端未配置上游 AI Key |
| `502` | `AI request failed` | 上游 MiniMax 调用失败(网络/限流/鉴权等) |

**错误响应统一格式:**

```json
{
  "error": "错误描述"
}
```

---

## 5. 接口列表

### 5.1 健康检查

#### `GET /`

不需要鉴权。用于监控、负载均衡探活。

**请求示例:**

```bash
curl https://<worker-domain>/
```

**成功响应 `200 OK`:**

```json
{
  "success": true,
  "service": "StudyPulse Cloud AI",
  "version": "0.4-beta",
  "status": "online"
}
```

**字段说明:**

| 字段 | 类型 | 说明 |
|---|---|---|
| `success` | boolean | 固定 `true` |
| `service` | string | 服务名 |
| `version` | string | 服务版本,语义化版本 + `-beta` 后缀 |
| `status` | string | `"online"` / 未来可能扩展 `"degraded"` 等 |

---

### 5.2 AI 对话

#### `POST /v1/chat`

需要鉴权。调用 MiniMax-M3 模型生成回复。

**请求头:**

| Header | 必填 | 说明 |
|---|---|---|
| `Authorization` | 是 | `Bearer <API_KEY>` |
| `Content-Type` | 是 | `application/json` |

**请求体(两种形态,二选一):**

#### 形态 A:纯文本(向后兼容)

```json
{
  "message": "你好"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message` | string | 否 | 用户输入文本。缺省视为空字符串 |

#### 形态 B:多模态数组(MiniMax-M3 原生支持)

```json
{
  "content": [
    { "type": "text", "text": "描述这张图" },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://example.com/photo.jpg",
        "detail": "default"
      }
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `content` | array | 否 | OpenAI 风格 content 数组,支持 `text` / `image_url` / `video_url` |

> **优先级**:`content` 数组优先于 `message`。两者同时存在时以 `content` 为准;两者都缺则视为空文本。

**content 数组元素类型:**

| type | 字段 | 说明 |
|---|---|---|
| `text` | `text: string` | 文本输入 |
| `image_url` | `image_url: { url, detail }` | 图片输入。`detail` 可选 `low` / `default` / `high`,默认 `default` |
| `video_url` | `video_url: { url, detail }` | 视频输入。`detail` 同上 |

**支持的图片格式:** JPEG、PNG、GIF、WEBP(单张 ≤ 10 MB)
**支持的视频格式:** MP4、AVI、MOV、MKV(URL 或 base64 ≤ 50 MB)

**请求示例:**

```bash
# 纯文本
curl -X POST https://<worker-domain>/v1/chat \
  -H "Authorization: Bearer sp_beta_test001" \
  -H "Content-Type: application/json" \
  -d '{"message":"你好"}'

# 多模态(图片理解)
curl -X POST https://<worker-domain>/v1/chat \
  -H "Authorization: Bearer sp_beta_test001" \
  -H "Content-Type: application/json" \
  -d '{
    "content": [
      {"type":"text","text":"这张图里有什么?"},
      {"type":"image_url","image_url":{"url":"https://example.com/photo.jpg","detail":"default"}}
    ]
  }'
```

**成功响应 `200 OK`:**

```json
{
  "success": true,
  "data": {
    "reply": "你好!我是 StudyPulse AI 助手,有什么可以帮你的吗?"
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `success` | boolean | 固定 `true` |
| `data.reply` | string | 模型生成的回复文本 |

---

## 6. 上游模型配置

当前固定调用以下配置(客户端不可覆盖):

| 项 | 值 | 说明 |
|---|---|---|
| Provider | `minimax` | 通过 MiniMax OpenAI 兼容协议 |
| Endpoint | `https://api.minimaxi.com/v1/chat/completions` | 国内版 |
| Model | `MiniMax-M3` | 原生多模态,1M 上下文 |
| Thinking | `disabled` | 关闭思考过程,直接返回最终回复 |
| Stream | 否 | 非流式,客户端需等待完整回复 |

> 如需切换模型或开启 streaming,联系服务端管理员。

---

## 7. 速率限制

当前基于 `api_keys` 表的 `request_count` 与 `request_limit` 字段实现单 Key 配额控制:

- 每个 API Key 设有累计请求上限 `request_limit`(INTEGER),`NULL` 表示不限量
- 每次 MiniMax 调用成功后 `request_count` 自增 1
- 当 `request_count >= request_limit`(limit 不为 NULL 时),返回 `429 API quota exceeded`
- 鉴权失败、上游 AI 失败、Worker 内部错误均不计次

管理员可通过管理后台或脚本重置配额(`request_count = 0`)或修改 `request_limit`。

> 未来版本计划增加基于时间窗口(如每分钟/每小时)的速率限制。

---

## 8. 完整调用示例

### 8.1 健康检查 + 鉴权测试 + 对话(Shell)

```bash
#!/bin/bash
BASE="http://localhost:8787"   # 本地开发;线上替换为 Worker 域名
KEY="sp_beta_test001"

# 1. 健康检查
echo "=== Health ==="
curl -s -w "\nHTTP %{http_code}\n" "$BASE/"

# 2. 鉴权失败:无 Key
echo "=== No Key (expect 401) ==="
curl -s -w "\nHTTP %{http_code}\n" -X POST "$BASE/v1/chat"

# 3. 鉴权失败:错误 Key
echo "=== Bad Key (expect 403) ==="
curl -s -w "\nHTTP %{http_code}\n" -X POST "$BASE/v1/chat" \
  -H "Authorization: Bearer wrong_key"

# 4. 对话成功
echo "=== Chat (expect 200) ==="
curl -s -w "\nHTTP %{http_code}\n" -X POST "$BASE/v1/chat" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"用一句话介绍 StudyPulse"}'
```

### 8.2 iOS Swift 调用示例

```swift
import Foundation

func chat(message: String, apiKey: String) async throws -> String {
    var request = URLRequest(url: URL(string: "https://<worker-domain>/v1/chat")!)
    request.httpMethod = "POST"
    request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let body: [String: Any] = ["message": message]
    request.httpBody = try JSONSerialization.data(withJSONObject: body)

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse,
          http.statusCode == 200,
          let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let dataObj = json["data"] as? [String: Any],
          let reply = dataObj["reply"] as? String else {
        throw URLError(.badServerResponse)
    }
    return reply
}

// 调用
let reply = try await chat(
    message: "你好",
    apiKey: "sp_beta_test001"   // iOS 端硬编码或安全存储
)
print(reply)
```

---

## 9. 版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| `0.1-beta` | 2026-07-25 | 基础 API Gateway,内存数组鉴权,`/v1/chat` 仅回显 |
| `0.2-beta` | 2026-07-25 | 接入 MiniMax-M3,真实 AI 调用;支持多模态输入;Thinking 关闭 |
| `0.3-beta` | 2026-07-25 | 鉴权切换到 D1 持久化,只存 SHA-256 哈希 |
| `0.4-beta` | 2026-07-25 | 启用请求额度控制(`request_limit`/`429`);启用请求日志(`request_logs`);支持 Key 启用/禁用 |

---

## 10. 安全说明

### 10.1 客户端 API Key (`sp_xxx`)

- 由服务端通过 D1 管理,仅存 SHA-256 哈希
- 客户端 iOS App 内置或通过安全渠道下发
- **不要**在日志、错误响应、URL query 中输出原始 Key

### 10.2 上游 AI Key (`MINIMAX_API_KEY`)

- 通过 `wrangler secret put` 注入 Cloudflare Worker
- 加密存储于 Cloudflare,仅运行时注入 `env.MINIMAX_API_KEY`
- **绝不**写入代码、`.env`、`wrangler.jsonc`、Git 仓库

### 10.3 数据隐私

- **不记录** Prompt(用户输入)与 Reply(AI 回复)的文本内容
- 请求日志(`request_logs`)记录每次请求的元数据:关联的 API Key ID、模型名、Provider、HTTP 状态码、延迟(ms)、Token 用量(prompt/completion/total)、客户端 IP、User-Agent、错误信息
- 所有日志通过 `ctx.waitUntil()` 异步写入,不阻塞 AI 响应

---

## 11. 本地开发

```bash
# 安装依赖
npm install

# 启动本地 dev server(端口见启动日志,通常 8787)
npm run dev

# 运行测试
npm test -- --run

# 应用 D1 migration 到本地
npx wrangler d1 migrations apply studypulse-cloud-ai-db --local

# 种子 Beta Key 到本地 D1
HASH=$(node -e "console.log(require('crypto').createHash('sha256').update('sp_beta_test001','utf8').digest('hex'))")
npx wrangler d1 execute studypulse-cloud-ai-db --local \
  --command "INSERT OR IGNORE INTO api_keys (key_hash, name, enabled) VALUES ('$HASH', 'Beta Test Key 001', 1);"
```

---

## 12. 后续扩展路线

- [ ] **流式响应**:支持 `stream: true`,SSE 透传 MiniMax 流式输出
- [x] **额度控制**:启用 `request_limit` / `request_count`,超额返回 `429` — 已实现(v0.4-beta)
- [x] **请求日志**:`request_logs` 表记录 token 用量、延迟、状态 — 已实现(v0.4-beta)
- [ ] **多 Provider 路由**:`providers/` 下新增 `openai.js` / `kimi.js` / `glm.js`,body 增加 `provider` 字段
- [ ] **过期校验**:启用 `expires_at`,鉴权时检查 Key 是否过期
- [x] **管理 API**:增删改查 API Key 的管理端接口(需更高权限的 Admin Key) — 已实现(v0.4-beta)
