# StudyPulse Cloud AI — 技术实现文档

**版本:** `0.5-beta-github`
**运行时:** Cloudflare Workers
**数据库:** Cloudflare D1 (边缘 SQLite)
**AI Provider:** MiniMax-M3 (OpenAI 兼容协议)
**最后更新:** 2026-07-25

---

## 1. 架构概览

StudyPulse Cloud AI 是一个部署在 Cloudflare Workers 上的 LLM API 转发网关，为 StudyPulse iOS App 提供 AI 调用能力。核心设计原则：客户端不直接持有第三方 AI 服务密钥，所有 AI 请求通过网关统一鉴权、转发、计费。

```
                         ┌─────────────────────────────┐
                         │    Cloudflare Workers        │
                         │                              │
  iOS App ──HTTPS──►     │  ┌───────────────────────┐  │     ┌──────────────┐
  (持有 sp_xxx)          │  │   Hostname Router      │  │     │  MiniMax API │
                         │  │                        │  │     │              │
                         │  │ spapi.chenkai.space ───┼──┼────►│ /v1/chat/    │
                         │  │    → Public API        │  │     │ completions  │
                         │  │                        │  │     │              │
  管理员 ──HTTPS──►      │  │ admin.chenkai.space ───┼──┼─┐   │ Model:       │
                         │  │    → Admin Panel       │  │ │   │ MiniMax-M3   │
                         │  └───────────────────────┘  │ │   └──────────────┘
                         │                              │ │
                         │  ┌───────────────────────┐  │ │
                         │  │   D1 (StudyPulseDB)    │◄─┼─┘
                         │  │   - api_keys           │  │
                         │  │   - request_logs       │  │
                         │  └───────────────────────┘  │
                         └─────────────────────────────┘
```

### 目录结构

```
src/
├── index.js                 # Worker 入口：主机名路由、请求生命周期
├── auth.js                  # API Key 鉴权（SHA-256 + D1 查询）
├── providers/
│   └── minimax.js           # MiniMax-M3 Provider（流式/非流式）
├── database/
│   └── api_keys.js          # 额度自增写操作
└── admin/
    ├── auth.js              # 管理员鉴权（Cloudflare Access + Token）
    ├── database.js          # 管理后台 D1 操作
    ├── routes.js            # 管理 API 路由 + CSRF
    └── ui.js                # 管理后台 WebUI（纯 HTML/CSS/JS）

migrations/
├── 0001_create_api_keys.sql
├── 0002_create_request_logs.sql
└── 0002_add_limit_type.sql

scripts/
├── _common.js               # 共用工具
├── create-api-key.js        # 生成 API Key
├── list-api-keys.js         # 列出所有 Key
├── update-quota.js          # 修改配额
├── disable-api-key.js       # 禁用 Key
└── delete-api-key.js        # 删除 Key
```

---

## 2. 路由设计

Worker 使用**主机名路由**实现公开 API 与管理后台的域名隔离：

| 主机名 | 用途 | 路由 |
|--------|------|------|
| `spapi.chenkai.space` | 公开 API | `GET /` 健康检查, `POST /v1/chat` AI 对话 |
| `admin.chenkai.space` | 管理后台 | `GET /admin` WebUI, `/api/admin/*` 管理 API |
| `localhost` | 本地开发 | 路径路由：`/admin/*` 走管理后台，其余走公开 API |
| `*.workers.dev` | Worker 调试/预览 | 管理后台路径禁用，其余路径走公开 API |

```javascript
// src/index.js — 路由分发核心逻辑
export default {
    async fetch(request, env, ctx) {
        const hostname = new URL(request.url).hostname;

        if (hostname === "admin.chenkai.space") {
            return handleAdmin(request, env, ctx, pathname, method);
        }
        if (hostname === "spapi.chenkai.space") {
            return handlePublicApi(request, env, ctx, pathname, method);
        }
        // 本地开发：路径路由兼容
        if (hostname === "localhost" || hostname.endsWith(".workers.dev")) {
            if (pathname.startsWith("/api/admin/") || pathname.startsWith("/admin")) {
                return handleAdmin(...);
            }
            return handlePublicApi(...);
        }
        return Response.json({ error: "Not Found" }, { status: 404 });
    },
};
```

---

## 3. 鉴权体系

系统有三层鉴权，各司其职：

### 3.1 公开 API 鉴权（客户端 API Key）

**文件:** [src/auth.js](file:///Users/chenkaigao/Documents/Program/Web/studypulse-cloud-ai/src/auth.js)

校验流程为 7 步短路返回，越靠前的步骤越早拦截，节省 D1 查询：

```
Authorization Header 存在?      否 → 401 "Missing API Key"
Bearer scheme?                   否 → 403 "Invalid API Key"
SHA-256(rawKey) 命中 D1?         否 → 403 "Invalid API Key"
enabled == 1?                    否 → 403 "API Key disabled"
expires_at 未过期?               否 → 403 "API Key expired"
额度未超限?                      否 → 429 "API quota exceeded"
全部通过                          → { ok: true, apiKey }
```

**关键设计:**

- API Key 格式：`sp_beta_` + 16 位随机 hex（如 `sp_beta_a1b2c3d4e5f6g7h8`）
- 数据库**永远不存储原始 Key**，仅存 `SHA-256(原始Key)` 的 64 字符 hex 摘要
- Key 创建时仅显示一次原文，之后无法找回
- 管理后台 API **绝不返回 `key_hash` 字段**

**SHA-256 计算使用 Web Crypto API：**

```javascript
export async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(hashBuffer);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex;
}
```

### 3.2 管理后台鉴权

**文件:** [src/admin/auth.js](file:///Users/chenkaigao/Documents/Program/Web/studypulse-cloud-ai/src/admin/auth.js)

支持双通道鉴权（短路求值，任一通过即可）：

**通道 1 — Cloudflare Access（推荐）：**
- 检查 `Cf-Access-Jwt-Assertion` header
- 使用 `CF_ACCESS_TEAM_DOMAIN` 对应团队的 `/cdn-cgi/access/certs` JWKS 校验 RS256 签名
- 同时校验 `iss`（团队域名）和 `aud`（`CF_ACCESS_AUDIENCE` 应用 AUD tag）
- 未配置校验参数或校验失败时不通过

**通道 2 — ADMIN_API_TOKEN 降级：**
- `Authorization: Bearer <ADMIN_API_TOKEN>`
- Token 通过 `wrangler secret put` 注入，不进代码
- 常量时间字符串比较防时序攻击：

```javascript
function timingSafeEqual(a, b) {
    let result = a.length ^ b.length;
    for (let i = 0; i < a.length && i < b.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}
```

### 3.3 密钥层级总结

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                    │
│  客户端持有  sp_beta_xxx  ──SHA-256──►  D1 api_keys.key_hash     │
│                                                                    │
│  Worker 持有  MINIMAX_API_KEY  ──Bearer──►  MiniMax API          │
│  (Cloudflare Secret 加密存储)                                      │
│                                                                    │
│  管理员持有  ADMIN_API_TOKEN  ──常量比较──►  管理后台             │
│  (Cloudflare Secret 加密存储)                                      │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

- 客户端永远不接触 MiniMax Key
- Worker 永远不存储客户端 Key 原文
- 管理员 Token 不进代码、不进仓库

### 3.4 CSRF 保护

**文件:** [src/admin/routes.js](file:///Users/chenkaigao/Documents/Program/Web/studypulse-cloud-ai/src/admin/routes.js) (第 29-71 行)

所有管理后台状态变更接口（POST/PUT/DELETE）受 CSRF 保护：

- 管理页面加载时生成 32 字节随机 Token
- 通过 `Set-Cookie: admin_csrf=<token>; Path=/api/admin; SameSite=Strict; HttpOnly` 写入
- Token 同时嵌入页面 `<meta name="csrf-token">` 供前端 JS 读取
- 状态变更请求需携带 `X-CSRF-Token` header
- 服务端常量时间比较 Cookie 与 Header 的值

### 3.5 安全响应头

所有管理 API 响应统一注入：

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

---

### 3.6 密码认证与统一身份上下文

`migrations/0014_add_password_auth.sql` 为已有 D1 数据库增加：

- `users.email_normalized` 唯一索引，所有邮箱入口使用 `trim().toLowerCase()`；原始 `email` 保留用于展示。
- `user_credentials`，以 `user_id` 为主键，保存 PBKDF2-HMAC-SHA-256 派生结果、随机 salt、算法、迭代次数、失败次数和短期锁定时间。
- `email_verification_codes.purpose` 与 `email_normalized`，支持 `register`、`login`、`reset_password`、`change_email`。
- `sessions.revoked_at`、设备信息、用户代理和脱敏 IP 哈希；旧 Session 通过 `revoked_at` 撤销而不是删除。
- `auth_rate_limits`，只保存作用域化 key 的 SHA-256，不保存原始 IP 或邮箱。

密码验证由 `src/security/password.js` 使用 Workers Web Crypto PBKDF2 实现，派生结果至少 32 bytes，salt 为 16 bytes，并使用恒定时间字节比较。成功登录发现迭代次数过低时自动重新哈希。

所有公开 AI 请求继续进入同一个 `authenticateRequest()`，返回统一上下文：

```js
{
  userId,
  authType: "session" | "api_key",
  sessionId: null,
  apiKeyId: null
}
```

账号管理接口通过 `requireSessionAuth()` 拒绝 API Key；AI 额度、会员和 `usage_records` 仍只按 `userId` 处理。密码修改会撤销用户全部旧 Session 并签发一个新 Session；密码重置会撤销全部 Session 但不自动登录。API Key 不因密码重置而撤销。

## 4. LLM 转发实现

### 4.1 Provider 架构

**文件:** [src/providers/minimax.js](file:///Users/chenkaigao/Documents/Program/Web/studypulse-cloud-ai/src/providers/minimax.js)

当前仅实现 MiniMax-M3 Provider，但 `providers/` 目录结构预留了多 Provider 扩展空间。Provider 职责：封装上游 API 调用细节，对外暴露统一的 `chat()` 和 `chatStream()` 接口。

**固定配置（客户端不可覆盖）：**

| 配置项 | 值 | 说明 |
|--------|-----|------|
| Endpoint | `https://api.minimaxi.com/v1/chat/completions` | MiniMax OpenAI 兼容接口 |
| Model | `MiniMax-M3` | 原生多模态，1M 上下文 |
| Thinking | `disabled` | 关闭思考过程，直接返回最终回复 |
| Stream | 可选 | `stream: true` 启用 SSE 流式输出 |

### 4.2 非流式请求流程

```
POST /v1/chat (stream: false)
│
├─ 1. authenticate() → apiKey 记录
├─ 2. 校验 env.MINIMAX_API_KEY 存在
├─ 3. 解析 JSON Body (content[] 优先于 message)
├─ 4. 组装 messages: [{ role: "user", content }]
├─ 5. minimaxChat(messages, env)
│     ├─ fetch MiniMax API (POST JSON)
│     ├─ 成功 → { reply, usage }
│     └─ 失败 → throw Error → 502
├─ 6. incrementApiKeyUsage(env, apiKey.id, usage.total_tokens)
│     └─ UPDATE request_count+1, token_count+N, last_used_at
├─ 7. ctx.waitUntil(writeRequestLog(...))  // 异步写日志
└─ 8. Response.json({ success: true, data: { reply } })
```

**消息组装规则:**

```javascript
// content[] 多模态数组优先，其次 message 纯文本，都缺则空字符串
let userContent;
if (Array.isArray(body?.content)) {
    userContent = body.content;       // 形态 A: [{ type: "text", text: "..." }, { type: "image_url", ... }]
} else {
    userContent = typeof body?.message === "string" ? body.message : "";  // 形态 B: "你好"
}
const messages = [{ role: "user", content: userContent }];
```

### 4.3 流式请求流程

流式请求的核心挑战：需要将上游 SSE 流原样返回给客户端，同时从中提取 token 用量用于计费和日志。

**文件:** [src/index.js](file:///Users/chenkaigao/Documents/Program/Web/studypulse-cloud-ai/src/index.js) (第 295-452 行)

```
POST /v1/chat (stream: true)
│
├─ 1-4. 同非流式（鉴权、Secret 校验、Body 解析、消息组装）
├─ 5. minimaxChatStream(messages, env) → upstreamResponse
├─ 6. upstreamResponse.body.tee() 将流一分为二
│     ├─ clientStream → 零包装直接返回给客户端
│     └─ usageStream → 异步 reader 扫描 SSE 提取 usage
├─ 7. ctx.waitUntil(异步处理 usageStream)
│     ├─ 逐块读取 SSE，"data: " 行解析 JSON
│     ├─ 收集最后一个含 usage 字段的 chunk
│     ├─ 流结束后: incrementApiKeyUsage() + writeRequestLog()
│     ├─ 监听 request.signal "abort" → reader.cancel()
│     └─ usage 缺失时 error_message = "usage_missing"
└─ 8. new Response(clientStream, { Content-Type: text/event-stream })
```

**零包装透传设计：**

```javascript
// tee() 将上游 SSE ReadableStream 一分为二
const [clientStream, usageStream] = upstreamResponse.body.tee();

// 客户端分支：不做任何修改，字节级完整透传
return new Response(clientStream, {
    headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    },
});
```

**客户端断开检测：**

```javascript
request.signal.addEventListener("abort", () => {
    reader.cancel().catch(() => {});
});
```

### 4.4 Provider 实现细节

**非流式调用：**

```javascript
export async function chat(messages, env) {
    const response = await fetch("https://api.minimaxi.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.MINIMAX_API_KEY}`,
        },
        body: JSON.stringify({
            model: "MiniMax-M3",
            messages,
            thinking: { type: "disabled" },
        }),
    });
    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`MiniMax API error ${response.status}: ${errText.slice(0, 200)}`);
    }
    const data = await response.json();
    return {
        reply: data?.choices?.[0]?.message?.content,
        usage: data?.usage ?? null,
    };
}
```

**流式调用：**

```javascript
export async function chatStream(messages, env) {
    const response = await fetch("https://api.minimaxi.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.MINIMAX_API_KEY}`,
        },
        body: JSON.stringify({
            model: "MiniMax-M3",
            messages,
            stream: true,
            stream_options: { include_usage: true },  // 请求在流中返回 token 用量
            thinking: { type: "disabled" },
        }),
    });
    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`MiniMax API error ${response.status}: ${errText.slice(0, 200)}`);
    }
    return response;  // 返回原始 Response，body 是 ReadableStream
}
```

---

## 5. 数据库设计

### 5.1 技术选型

使用 **Cloudflare D1**（边缘 SQLite），Worker 通过 `StudyPulseDB` binding 访问。所有查询使用参数化 Prepared Statements 防 SQL 注入。数据库 Migration 通过 `wrangler d1 migrations apply` 管理。

### 5.2 api_keys 表

**文件:** [migrations/0001_create_api_keys.sql](file:///Users/chenkaigao/Documents/Program/Web/studypulse-cloud-ai/migrations/0001_create_api_keys.sql)

```sql
CREATE TABLE api_keys (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash        TEXT NOT NULL UNIQUE,        -- SHA-256 哈希，绝不存原文
    name            TEXT NOT NULL,               -- 人类可读名称
    enabled         INTEGER NOT NULL DEFAULT 1,  -- 0=禁用, 1=启用
    request_count   INTEGER NOT NULL DEFAULT 0,  -- 累计请求次数
    request_limit   INTEGER,                     -- 上限，NULL=不限量
    limit_type      TEXT NOT NULL DEFAULT 'count', -- 'count' 或 'tokens'
    token_count     INTEGER NOT NULL DEFAULT 0,  -- 累计 Token 消耗
    user_id         TEXT,                         -- 预留用户标识
    notes           TEXT,                         -- 备注
    expires_at      TEXT,                         -- ISO 8601，NULL=永不过期
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at    TEXT
);
```

索引：
- `idx_api_keys_key_hash` — 鉴权热路径，每次请求都按 hash 单点查询
- `idx_api_keys_enabled` — 管理后台"列出启用 Key"查询

### 5.3 request_logs 表

**文件:** [migrations/0002_create_request_logs.sql](file:///Users/chenkaigao/Documents/Program/Web/studypulse-cloud-ai/migrations/0002_create_request_logs.sql)

```sql
CREATE TABLE request_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id        INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    request_time      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    model             TEXT,           -- MiniMax-M3
    provider          TEXT,           -- minimax
    status            INTEGER NOT NULL, -- 200/502/500
    latency_ms        INTEGER,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    total_tokens      INTEGER,
    ip                TEXT,           -- CF-Connecting-IP
    user_agent        TEXT,
    error_message     TEXT            -- 截断至 500 字符
);
```

索引：
- `idx_request_logs_api_key_id` — 按 Key 聚合查询
- `idx_request_logs_request_time` — 按时间倒序查询最近日志
- `idx_request_logs_status` — 按成功/失败筛选

**隐私设计：**
- 日志表**不存储 prompt 和 reply 文本内容**
- 删除 Key 时 `ON DELETE CASCADE` 自动清理关联日志
- `error_message` 截断至 500 字符防止日志膨胀

### 5.4 额度自增写操作

**文件:** [src/database/api_keys.js](file:///Users/chenkaigao/Documents/Program/Web/studypulse-cloud-ai/src/database/api_keys.js)

仅在 AI 调用成功后调用，单条 UPDATE 原子完成防止并发计数丢失：

```javascript
export async function incrementApiKeyUsage(env, apiKeyId, tokenUsage) {
    const tokenCountSQL = tokenUsage != null
        ? ", token_count = token_count + ?"
        : "";

    await env.StudyPulseDB.prepare(
        `UPDATE api_keys
            SET request_count = request_count + 1${tokenCountSQL},
                last_used_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
    )
        .bind(...bindings)
        .run();
}
```

### 5.5 Migration 管理

三个 migration 文件按时间顺序执行：

| 编号 | 文件 | 内容 |
|------|------|------|
| 0001 | `create_api_keys` | 建立 `api_keys` 表及索引 |
| 0002 | `create_request_logs` | 建立 `request_logs` 表及索引 |
| 0002 | `add_limit_type` | ALTER 增加 `limit_type` 和 `token_count` 列 |

```bash
# 应用到本地 D1
npx wrangler d1 migrations apply studypulse-cloud-ai-db --local

# 应用到远程 D1
npx wrangler d1 migrations apply studypulse-cloud-ai-db --remote
```

---

## 6. 额度控制

### 6.1 两种限制方式

| 方式 | `limit_type` | 对比维度 | 触发条件 |
|------|-------------|----------|---------|
| 按请求次数 | `"count"`（默认）| `request_count >= request_limit` | 返回 429 |
| 按 Token 用量 | `"tokens"` | `token_count >= request_limit` | 返回 429 |

### 6.2 计数规则

- **仅在 AI 调用成功后**才自增计数。鉴权失败、上游失败、Worker 内部错误一律不计次
- 非流式：从 MiniMax 响应 `usage.total_tokens` 获取 token 用量
- 流式：从 SSE 最后一个包含 `usage` 的 chunk 提取
- Token 用量缺失时不累加 `token_count`，但请求次数仍 +1

**额度校验代码（[src/auth.js](file:///Users/chenkaigao/Documents/Program/Web/studypulse-cloud-ai/src/auth.js) 第 139-157 行）：**

```javascript
if (apiKey.request_limit !== null) {
    const limitType = apiKey.limit_type || "count";
    const currentUsage = limitType === "tokens"
        ? (apiKey.token_count ?? 0)
        : (apiKey.request_count ?? 0);

    if (currentUsage >= apiKey.request_limit) {
        return {
            ok: false,
            response: Response.json(
                { error: "API quota exceeded" },
                { status: 429 },
            ),
        };
    }
}
```

---

## 7. 请求日志

### 7.1 写入策略

日志写入使用 `ctx.waitUntil()` 异步执行，不阻塞 AI 响应返回。内层 `.catch()` 防止未处理的 Promise rejection 导致 Worker 异常。

**成功日志（非流式）：**

```javascript
const latency = Date.now() - startTime;
ctx.waitUntil(
    writeRequestLog(env, {
        api_key_id: apiKey.id, model, provider,
        status: 200, latency_ms: latency,
        ip: clientIp, user_agent: clientUa,
        prompt_tokens: usage?.prompt_tokens ?? null,
        completion_tokens: usage?.completion_tokens ?? null,
        total_tokens: usage?.total_tokens ?? null,
    }).catch((e) => console.error("Failed to write request log:", e?.message || e)),
);
```

**失败日志（上游调用异常）：**

```javascript
ctx.waitUntil(
    writeRequestLog(env, {
        api_key_id: apiKey.id, model, provider,
        status: 502, latency_ms: latency,
        ip: clientIp, user_agent: clientUa,
        error_message: (err?.message || "Unknown error").slice(0, 500),
    }).catch((e) => console.error("Failed to write error log:", e?.message || e)),
);
```

### 7.2 日志查询

管理后台提供按 `api_key_id` 和 `status` 筛选的日志查询，最近 200 条按时间倒序。

**文件:** [src/admin/database.js](file:///Users/chenkaigao/Documents/Program/Web/studypulse-cloud-ai/src/admin/database.js) (第 191-224 行)

```javascript
export async function getRequestLogs(env, filters = {}) {
    // 动态组装 WHERE 条件（参数化查询）
    const conditions = [];
    const bindings = [];

    if (filters.api_key_id) {
        conditions.push("rl.api_key_id = ?");
        bindings.push(filters.api_key_id);
    }
    if (filters.status !== undefined && filters.status !== null) {
        conditions.push("rl.status = ?");
        bindings.push(Number(filters.status));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const { results } = await env.StudyPulseDB.prepare(
        `SELECT rl.id, rl.api_key_id, ak.name AS key_name,
                rl.request_time, rl.model, rl.provider,
                rl.status, rl.latency_ms,
                rl.prompt_tokens, rl.completion_tokens, rl.total_tokens,
                rl.user_agent, rl.error_message
           FROM request_logs rl
           LEFT JOIN api_keys ak ON ak.id = rl.api_key_id
           ${where}
          ORDER BY rl.request_time DESC
          LIMIT 200`,
    ).bind(...bindings).all();

    return results;
}
```

---

## 8. 错误处理

### 8.1 错误码总表

| HTTP | `error` 字段 | 触发条件 |
|------|-------------|---------|
| 400 | `Invalid JSON Body` | POST Body 非合法 JSON |
| 401 | `Missing API Key` | 未携带 Authorization Header |
| 403 | `Invalid API Key` | Key 不存在/hash 不匹配 |
| 403 | `API Key disabled` | enabled=0 |
| 403 | `API Key expired` | expires_at 已过期 |
| 429 | `API quota exceeded` | 请求次数/Token 用量达上限 |
| 500 | `Server not configured: MINIMAX_API_KEY missing` | 未配置上游 AI Key |
| 502 | `AI request failed` | MiniMax 调用失败（网络/限流/鉴权等） |

**错误响应统一格式：** `{ "error": "描述" }`，不暴露内部细节。

### 8.2 错误处理模式

**上游失败不扣额度：** catch 块先写日志再返回 502，不调用 `incrementApiKeyUsage()`。

**异步日志容错：**

```javascript
ctx.waitUntil(
    writeRequestLog(env, {...})
        .catch((e) => console.error("Failed to write log:", e?.message || e))
);
```

**额度自增保护：**

```javascript
try {
    await incrementApiKeyUsage(env, apiKey.id, usage?.total_tokens);
} catch (err) {
    console.error("Failed to increment API key usage:", err?.message || err);
}
```

---

## 9. 管理后台

### 9.1 WebUI

**文件:** [src/admin/ui.js](file:///Users/chenkaigao/Documents/Program/Web/studypulse-cloud-ai/src/admin/ui.js)

纯 HTML/CSS/JS，零框架依赖。包含三个 Tab：
- **仪表盘：** 总 Key 数、启用 Key 数、总请求数、超额 Key 数
- **Key 管理：** 创建/编辑/删除/重置配额，创建时一次性显示 rawKey
- **请求日志：** 按 Key ID 和状态筛选

### 9.2 RESTful 管理 API

| 方法 | 路径 | 说明 | CSRF |
|------|------|------|------|
| GET | `/api/admin/stats` | 仪表盘统计 | - |
| GET | `/api/admin/keys` | 列出所有 Key（不含 hash） | - |
| POST | `/api/admin/keys/create` | 创建 Key，返回仅一次的 rawKey | 是 |
| POST | `/api/admin/keys/update` | 更新 Key 字段 | 是 |
| POST | `/api/admin/keys/delete` | 删除 Key（CASCADE 日志） | 是 |
| POST | `/api/admin/keys/reset-quota` | 重置 request_count=0, token_count=0 | 是 |
| GET | `/api/admin/logs` | 查询日志（api_key_id/status 筛选） | - |

### 9.3 仪表盘统计

**文件:** [src/admin/database.js](file:///Users/chenkaigao/Documents/Program/Web/studypulse-cloud-ai/src/admin/database.js) (第 19-46 行)

四个统计指标并行查询：

```javascript
export async function getDashboardStats(env) {
    const [totalKeys, enabledKeys, totalRequests, exceededQuotaKeys] =
        await Promise.all([
            db.prepare("SELECT COUNT(*) AS count FROM api_keys").first("count"),
            db.prepare("SELECT COUNT(*) AS count FROM api_keys WHERE enabled = 1").first("count"),
            db.prepare("SELECT COALESCE(SUM(request_count), 0) AS count FROM api_keys").first("count"),
            db.prepare(
                "SELECT COUNT(*) AS count FROM api_keys WHERE request_limit IS NOT NULL AND ((limit_type = 'tokens' AND token_count >= request_limit) OR ((limit_type IS NULL OR limit_type = 'count') AND request_count >= request_limit))"
            ).first("count"),
        ]);
    return { totalKeys, enabledKeys, totalRequests, exceededQuotaKeys };
}
```

---

## 10. 部署与配置

### 10.1 wrangler.jsonc 配置

```jsonc
{
    "name": "studypulse-cloud-ai",
    "main": "src/index.js",
    "compatibility_date": "2026-07-25",
    "compatibility_flags": ["nodejs_compat"],
    "observability": { "enabled": true },
    "d1_databases": [{
        "binding": "StudyPulseDB",
        "database_name": "studypulse-cloud-ai-db",
        "database_id": "df8b3261-ee9f-401d-9f07-cc3cbfa970e1"
    }],
    "routes": [
        { "pattern": "spapi.chenkai.space", "custom_domain": true },
        { "pattern": "admin.chenkai.space", "custom_domain": true }
    ]
}
```

### 10.2 Secrets 管理

| Secret | 用途 | 注入方式 |
|--------|------|---------|
| `MINIMAX_API_KEY` | 上游 MiniMax API 鉴权 Key | `wrangler secret put MINIMAX_API_KEY` |
| `ADMIN_API_TOKEN` | 管理后台降级认证 Token | `wrangler secret put ADMIN_API_TOKEN` |
| `CF_ACCESS_TEAM_DOMAIN` | Cloudflare Access 团队域名 | Worker 环境变量，例如 `https://team.cloudflareaccess.com` |
| `CF_ACCESS_AUDIENCE` | 管理后台 Access Application AUD tag | Worker 环境变量 |

本地开发通过 `.dev.vars` 注入假值（不提交到 Git）：

```
MINIMAX_API_KEY=demo_key_for_local_dev
ADMIN_API_TOKEN=dev_admin_token
```

### 10.3 部署命令

```bash
# 部署 Worker
npx wrangler deploy

# 应用数据库迁移（远程）
npx wrangler d1 migrations apply studypulse-cloud-ai-db --remote

# 创建 API Key
node scripts/create-api-key.js "iOS Beta 内测"
```

---

## 11. CLI 管理脚本

`scripts/` 目录下 6 个 Node.js 脚本，通过 `wrangler d1 execute` CLI 操作 D1：

| 脚本 | 功能 | 用法 |
|------|------|------|
| `create-api-key.js` | 生成 `sp_beta_` + 随机 hex Key，写 D1 | `node scripts/create-api-key.js "Key名称"` |
| `list-api-keys.js` | 列出所有 Key（Markdown 表格） | `node scripts/list-api-keys.js` |
| `update-quota.js` | 修改 request_limit | `node scripts/update-quota.js <raw-key> <limit>` |
| `disable-api-key.js` | 软禁用（enabled=0） | `node scripts/disable-api-key.js <raw-key>` |
| `delete-api-key.js` | 硬删除 + CASCADE 日志 | `node scripts/delete-api-key.js <raw-key>` |

所有脚本通过 `--local` 参数切换本地/远程 D1。

---

## 12. 测试体系

使用 **Vitest + @cloudflare/vitest-pool-workers** 在本地模拟 Workers 运行时。

**文件结构：**

| 文件 | 覆盖范围 |
|------|---------|
| `test/setup.js` | 应用 migration、种子测试 Key |
| `test/index.spec.js` | 公开 API：健康检查、鉴权错误 Key、真实对话（502 假 Key）、流式分支 |
| `test/admin.spec.js` | 管理后台：鉴权、仪表盘、Key CRUD、禁用/重置/删除、CSRF、日志查询、rawKey 安全性 |

```bash
# 运行测试
npm test -- --run
```

---

## 13. 安全设计总结

| 层面 | 措施 |
|------|------|
| 密钥存储 | API Key 仅存 SHA-256 哈希，上游 AI Key 存 Cloudflare Secret 加密存储 |
| 传输安全 | 全链路 HTTPS |
| SQL 注入 | 100% 参数化 Prepared Statements |
| 时序攻击 | 管理员 Token 和 CSRF Token 均使用常量时间比较 |
| CSRF | SameSite=Strict Cookie + X-CSRF-Token header 双重校验 |
| 响应头 | X-Content-Type-Options / X-Frame-Options / XSS-Protection / Referrer-Policy / Permissions-Policy |
| 数据隐私 | 不记录 prompt/reply 文本，IP 可选记录，删除 Key 时 CASCADE 清理日志 |
| 错误信息 | 对外仅返回通用错误描述，内部细节写入 console.error / 日志 |

---

## 14. 后续扩展

- [x] SSE 流式传输（v0.5-beta）
- [x] 额度控制：按次数 + 按 Token（v0.4 / v0.5-beta）
- [x] 请求日志（v0.4-beta）
- [x] 管理后台 WebUI（v0.4-beta）
- [ ] 多 Provider 路由：`providers/` 下新增 `openai.js` / `kimi.js` / `glm.js`
- [ ] 基于时间窗口的速率限制（每分钟/每小时）
- [ ] 用户账号系统对接（`api_keys.user_id`）
