# StudyPulse Cloud AI

Cloudflare Workers 驱动的 AI 后端网关，为 StudyPulse iOS App 提供 MiniMax-M3 多模态 AI 调用服务，含完整的管理后台。

**版本：** 0.5-beta-github  
**许可证：** Apache 2.0

---

## 目录

- [功能特性](#功能特性)
- [架构](#架构)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [部署指南](#部署指南)
- [公开 API](#公开-api)
- [管理后台](#管理后台)
- [数据库设计](#数据库设计)
- [API Key 管理](#api-key-管理)
- [安全模型](#安全模型)
- [测试](#测试)
- [技术栈](#技术栈)
- [版本历史](#版本历史)
- [后续规划](#后续规划)

---

## 功能特性

- **AI 网关** — iOS 客户端不直接持有第三方 AI Key，统一通过本服务代理调用
- **多模态支持** — MiniMax-M3 原生支持文本、图片（JPEG/PNG/GIF/WEBP）、视频（MP4/AVI/MOV/MKV）输入
- **API Key 鉴权** — D1 数据库持久化，SHA-256 哈希存储，支持启用/禁用/过期/配额控制
- **请求额度控制** — 每 Key 独立 `request_limit`，超额返回 429；仅在 AI 调用成功后计数
- **请求日志** — 记录每次请求的元数据（不存 prompt/reply 内容），支持按 Key/状态筛选
- **管理后台** — 内置 WebUI + RESTful API，支持 Key CRUD、配额管理、仪表盘统计
- **域名隔离** — 公开 API 与管理后台绑定不同子域名（spapi.chenkai.space / admin.chenkai.space）
- **多层安全** — Cloudflare Access SSO、CSRF 保护、常量时间比较、参数化查询防注入

---

## 架构

```
                         ┌──────────────────────┐
                         │   StudyPulse iOS App  │
                         └──────────┬───────────┘
                                    │  HTTPS  Authorization: Bearer sp_xxx
                                    ▼
┌──────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                          │
│                                                              │
│  spapi.chenkai.space (公开 API)     admin.chenkai.space (管理) │
│  ┌─────────────────────────────┐   ┌──────────────────────┐  │
│  │ GET  /         健康检查      │   │ GET  /admin   WebUI   │  │
│  │ POST /v1/chat  AI 对话      │   │ /api/admin/* 管理API  │  │
│  └─────────┬───────────────────┘   └──────────┬───────────┘  │
│            │                                  │               │
└────────────┼──────────────────────────────────┼───────────────┘
             │                                  │
             ▼                                  ▼
┌────────────────────────┐          ┌──────────────────────────┐
│   Cloudflare D1         │          │  Cloudflare Access        │
│   (StudyPulseDB)        │          │  (管理员 SSO 认证)         │
│                         │          └──────────────────────────┘
│  ┌───────────────────┐  │
│  │ api_keys          │  │
│  │ request_logs      │  │
│  └───────────────────┘  │
└────────────────────────┘
             │
             │  Bearer ${MINIMAX_API_KEY}
             ▼
┌─────────────────────────────┐
│  MiniMax OpenAI-compatible   │
│  api.minimaxi.com            │
│  Model: MiniMax-M3           │
└─────────────────────────────┘
```

### 请求处理流程

```
POST /v1/chat
    │
    ├─ 1. 提取 Authorization: Bearer <rawKey>
    ├─ 2. SHA-256(rawKey) → 查 D1 api_keys WHERE key_hash = ?
    ├─ 3. 校验 enabled = 1
    ├─ 4. 校验 request_count < request_limit（limit 为 NULL 时跳过）
    ├─ 5. 解析 Body（支持纯文本 message / 多模态 content 数组）
    ├─ 6. POST MiniMax /v1/chat/completions
    │      ├─ 成功 → reply
    │      └─ 失败 → 502（异步写失败日志）
    ├─ 7. UPDATE api_keys SET request_count+1, last_used_at=NOW()
    ├─ 8. INSERT INTO request_logs（异步，不阻塞响应）
    └─ 9. 返回 { success: true, data: { reply } }
```

---

## 目录结构

```
studypulse-cloud-ai/
├── src/                          # Worker 源码
│   ├── index.js                  # 入口：域名路由 + 请求处理
│   ├── auth.js                   # API Key 鉴权（SHA-256 哈希 + D1 查询）
│   ├── providers/
│   │   └── minimax.js            # MiniMax-M3 AI Provider（OpenAI 兼容协议）
│   ├── database/
│   │   └── api_keys.js           # 额度自增写操作（仅 AI 成功后调用）
│   └── admin/
│       ├── auth.js               # 管理员鉴权（Cloudflare Access / ADMIN_API_TOKEN）
│       ├── database.js           # 管理后台 D1 操作（统计/CRUD/日志）
│       ├── routes.js             # 管理 API 路由 + CSRF 保护 + 安全响应头
│       └── ui.js                 # 管理后台 WebUI（原生 HTML/CSS/JS）
├── migrations/                   # D1 数据库迁移
│   ├── 0001_create_api_keys.sql  # api_keys 表 + 索引
│   └── 0002_create_request_logs.sql  # request_logs 表 + 索引
├── scripts/                      # 管理脚本（通过 wrangler d1 execute 操作 D1）
│   ├── _common.js                # 共用工具：SHA-256、D1 执行、参数解析
│   ├── create-api-key.js         # 创建 API Key（仅显示一次原始 Key）
│   ├── list-api-keys.js          # 列出所有 Key
│   ├── update-quota.js           # 修改请求额度
│   ├── disable-api-key.js        # 禁用 Key
│   └── delete-api-key.js         # 删除 Key 及关联日志（CASCADE）
├── test/                         # 测试
│   ├── setup.js                  # 测试环境初始化（环境变量、测试数据）
│   ├── index.spec.js             # 公开 API 测试（健康检查/鉴权/对话）
│   └── admin.spec.js             # 管理后台测试（鉴权/CRUD/CSRF）
├── docs/
│   └── API.md                    # 公开 API 完整文档
├── wrangler.jsonc                # Cloudflare Workers 配置
├── vitest.config.js              # Vitest 测试配置
├── package.json
└── AGENTS.md                     # Cloudflare Workers 开发参考
```

### 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| **入口/路由** | `src/index.js` | 域名路由分发、请求生命周期编排、错误统一处理 |
| **鉴权** | `src/auth.js` | 公开 API 的 API Key 鉴权（Hash→D1→enabled→quota） |
| **AI Provider** | `src/providers/minimax.js` | MiniMax-M3 调用封装，thinking 关闭，错误处理 |
| **额度管理** | `src/database/api_keys.js` | request_count 自增 + last_used_at 更新 |
| **管理鉴权** | `src/admin/auth.js` | Cloudflare Access / ADMIN_API_TOKEN 双通道鉴权 |
| **管理数据** | `src/admin/database.js` | 仪表盘统计、Key CRUD、配额重置、日志查询 |
| **管理路由** | `src/admin/routes.js` | RESTful 路由分发、CSRF 保护、安全头注入 |
| **管理 UI** | `src/admin/ui.js` | 内置 WebUI 页面渲染 |

---

## 快速开始

### 前置要求

- Node.js 18+
- Cloudflare 账号（已开通 Workers & D1）

### 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 应用 D1 迁移（本地 SQLite）
npx wrangler d1 migrations apply studypulse-cloud-ai-db --local

# 3. 配置环境变量
cat > .dev.vars << 'EOF'
MINIMAX_API_KEY=sk-your-minimax-api-key
ADMIN_API_TOKEN=your-admin-token
EOF

# 4. 种子测试 API Key（本地）
HASH=$(node -e "
  const c = require('crypto');
  console.log(c.createHash('sha256').update('sp_beta_test001','utf8').digest('hex'));
")
npx wrangler d1 execute studypulse-cloud-ai-db --local --command \
  "INSERT OR IGNORE INTO api_keys (key_hash, name, enabled)
   VALUES ('$HASH', 'Beta Test Key 001', 1);"

# 5. 启动开发服务器
npm run dev
# → http://localhost:8787
```

### 验证本地服务

```bash
# 健康检查
curl http://localhost:8787/

# AI 对话
curl -X POST http://localhost:8787/v1/chat \
  -H "Authorization: Bearer sp_beta_test001" \
  -H "Content-Type: application/json" \
  -d '{"message":"你好"}'

# 管理后台
open http://localhost:8787/admin
```

---

## 部署指南

### 1. 设置 Secrets

```bash
# MiniMax AI 上游 Key（必需）
npx wrangler secret put MINIMAX_API_KEY

# 管理后台降级认证 Token（推荐配置）
npx wrangler secret put ADMIN_API_TOKEN
```

> Secrets 由 Cloudflare 加密存储，仅运行时通过 `env` 注入，绝不写入代码或配置文件。

### 2. 应用 D1 Migrations

```bash
# 生产环境（远程 D1）
npx wrangler d1 migrations apply studypulse-cloud-ai-db --remote
```

### 3. 种子初始 API Key

```bash
# 通过管理后台 UI 创建（部署后访问 admin.chenkai.space/admin）
# 或通过脚本创建
node scripts/create-api-key.js "iOS Beta 001" --remote
```

> 脚本创建的原始 Key 仅显示一次，请立即安全保存并交付给客户端。

### 4. 配置自定义域名

在 Cloudflare Dashboard 中为 Worker 绑定两个自定义域名：

| 域名 | 用途 | DNS 记录类型 |
|------|------|-------------|
| `spapi.chenkai.space` | 公开 AI API | CNAME → Worker `*.workers.dev` |
| `admin.chenkai.space` | 管理后台 | CNAME → Worker `*.workers.dev` |

### 5. （可选）配置 Cloudflare Access

1. 进入 Cloudflare Zero Trust Dashboard
2. 创建 Self-hosted Application，Domain 设为 `admin.chenkai.space`
3. 添加 Identity Provider（GitHub / Google / 邮箱 OTP）
4. 配置 Access Policy，限定管理员访问
5. Workers 端无需额外配置 — 自动读取 `Cf-Access-Jwt-Assertion` header

### 6. 部署 Worker

```bash
# 注意：根据项目规则，部署应由 CI/CD 或手动在远程执行
npm run deploy
```

---

## 公开 API

完整 API 文档见 [docs/API.md](docs/API.md)。

### 端点

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| `GET` | `/` | 无 | 健康检查 |
| `POST` | `/v1/chat` | Bearer API Key | AI 对话（文本/多模态） |

### 请求格式

**纯文本：**

```json
{
  "message": "你好，请介绍一下自己"
}
```

**多模态（图片理解）：**

```json
{
  "content": [
    { "type": "text", "text": "这张图里有什么？" },
    {
      "type": "image_url",
      "image_url": { "url": "https://example.com/photo.jpg", "detail": "default" }
    }
  ]
}
```

> `content` 数组优先级高于 `message`。两者同时存在时以 `content` 为准。

### 成功响应

```json
{
  "success": true,
  "data": {
    "reply": "你好！我是 StudyPulse AI 助手..."
  }
}
```

### 错误码

| HTTP | `error` 字段 | 触发条件 |
|------|-------------|---------|
| 400 | `Invalid JSON Body` | 请求体非合法 JSON |
| 401 | `Missing API Key` | 未携带 Authorization Header |
| 403 | `Invalid API Key` | Key 不存在或格式错误 |
| 403 | `API Key disabled` | Key 已被管理员禁用 |
| 404 | `Not Found` | 未定义的路径 |
| 429 | `API quota exceeded` | 请求次数达到 `request_limit` |
| 500 | `Server not configured` | 未配置 `MINIMAX_API_KEY` |
| 502 | `AI request failed` | 上游 MiniMax 调用失败 |

### 上游模型配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| Provider | `minimax` | MiniMax OpenAI 兼容协议 |
| Endpoint | `https://api.minimaxi.com/v1/chat/completions` | 国内版 |
| Model | `MiniMax-M3` | 原生多模态，1M 上下文 |
| Thinking | `disabled` | 关闭思考过程，直接返回最终回复 |
| Streaming | 否 | 当前非流式（v0.6 计划支持） |

---

## 管理后台

### 访问方式

| 域名 | 路径 | 说明 |
|------|------|------|
| `admin.chenkai.space` | `/admin` | 管理后台 WebUI |
| `admin.chenkai.space` | `/api/admin/*` | 管理后台 RESTful API |
| `localhost:8787` | `/admin` | 本地开发（路径路由兼容） |

### 认证方式

管理后台支持两种认证方式，短路求值，任一通过即可：

1. **Cloudflare Access（推荐）** — 到达 Worker 时 `Cf-Access-Jwt-Assertion` header 存在即通过，无需额外配置
2. **ADMIN_API_TOKEN（降级）** — 本地开发或未配置 Access 时使用 Bearer Token

### 管理 API

所有管理 API 需管理员认证。状态变更接口（POST）额外需要 CSRF Token。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/stats` | 仪表盘统计（Key 总数、请求总量、超配额数） |
| `GET` | `/api/admin/keys` | 列出所有 API Key |
| `POST` | `/api/admin/keys/create` | 创建 Key（返回仅一次的 rawKey） |
| `POST` | `/api/admin/keys/update` | 更新 Key（名称/状态/配额/备注/过期） |
| `POST` | `/api/admin/keys/delete` | 删除 Key（CASCADE 删除关联日志） |
| `POST` | `/api/admin/keys/reset-quota` | 重置请求计数为 0 |
| `GET` | `/api/admin/logs` | 查询请求日志（可按 api_key_id / status 筛选） |

### CSRF 保护

- 管理页面加载时生成随机 CSRF Token，通过 `Set-Cookie` 写入（`SameSite=Strict; HttpOnly; Path=/api/admin`）
- Token 同时注入页面 `<meta>` 标签供前端 JS 读取
- 状态变更请求需携带 `X-CSRF-Token` header，服务端常量时间比较 Cookie 与 Header 值
- 安全响应头：`X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`

---

## 数据库设计

### api_keys 表

```sql
CREATE TABLE api_keys (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash        TEXT NOT NULL UNIQUE,        -- SHA-256(原始 Key)，绝不存原文
    name            TEXT NOT NULL,               -- 人类可读名称
    enabled         INTEGER NOT NULL DEFAULT 1,  -- 0=禁用, 1=启用
    request_count   INTEGER NOT NULL DEFAULT 0,  -- 累计请求次数
    request_limit   INTEGER,                     -- 请求上限，NULL=不限量
    user_id         TEXT,                         -- 预留用户标识
    notes           TEXT,                         -- 备注
    expires_at      TEXT,                         -- ISO 8601 过期时间，NULL=永不过期
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at    TEXT                          -- 最后使用时间
);
```

### request_logs 表

```sql
CREATE TABLE request_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id        INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    request_time      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    model             TEXT,           -- MiniMax-M3
    provider          TEXT,           -- minimax
    status            INTEGER NOT NULL, -- 200=成功, 502=失败
    latency_ms        INTEGER,        -- 请求延迟（毫秒）
    prompt_tokens     INTEGER,        -- 输入 token 数（预留）
    completion_tokens INTEGER,        -- 输出 token 数（预留）
    total_tokens      INTEGER,        -- 总 token 数（预留）
    ip                TEXT,           -- CF-Connecting-IP
    user_agent        TEXT,           -- 客户端 User-Agent
    error_message     TEXT            -- 错误信息，截断至 500 字符
);
```

> **隐私设计：** 日志表不存储 prompt 和 reply 内容。key_hash 不通过管理 API 返回。删除 Key 时 CASCADE 清理关联日志。

---

## API Key 管理

### Key 生命周期

```
创建（仅一次显示 rawKey）
  │  node scripts/create-api-key.js "Name" --remote
  │  或管理后台 UI → 创建 Key
  ▼
启用（enabled = 1，默认）
  │  客户端携带 Key 发起请求
  ▼
使用中（request_count 递增）
  │  管理员可随时：
  │  - 禁用 (enabled = 0)
  │  - 调整配额 (request_limit)
  │  - 重置计数 (request_count = 0)
  ▼
过期/禁用/删除
```

### 命令行管理

```bash
# 创建 Key
node scripts/create-api-key.js "iOS Beta 001" --remote

# 列出所有 Key
node scripts/list-api-keys.js --remote

# 修改配额（0=不限量，正整数=上限）
node scripts/update-quota.js <key_id> <limit> --remote

# 禁用 Key
node scripts/disable-api-key.js <key_id> --remote

# 删除 Key
node scripts/delete-api-key.js <key_id> --remote
```

### 额度计数规则

- `request_count` **仅在 MiniMax 调用成功（HTTP 200）后**自增
- 鉴权失败、上游 AI 失败、Worker 内部错误**一律不计次**
- 单条 `UPDATE ... SET request_count = request_count + 1, last_used_at = CURRENT_TIMESTAMP` 原子完成
- `request_limit` 为 `NULL` 时表示不限量，跳过额度校验

---

## 安全模型

### 数据保护

| 数据 | 存储方式 | 访问控制 |
|------|---------|---------|
| 客户端 API Key 原文 | 不存储（仅创建时显示一次） | — |
| 客户端 API Key 哈希 | D1 `key_hash`（SHA-256） | 管理 API 不返回此字段 |
| MiniMax 上游 Key | Cloudflare Secret | 仅运行时 `env.MINIMAX_API_KEY` |
| 管理员 Token | Cloudflare Secret | 仅运行时 `env.ADMIN_API_TOKEN` |
| 用户 Prompt / AI Reply | 不存储 | — |

### 防御措施

| 威胁 | 措施 |
|------|------|
| SQL 注入 | 所有 D1 查询使用参数化 prepared statements |
| 时序攻击 | Token 比较使用常量时间算法 |
| CSRF | 状态变更 API 校验 SameSite=Strict Cookie + 自定义 Header |
| XSS | 安全响应头（CSP、X-XSS-Protection、X-Content-Type-Options） |
| Clickjacking | `X-Frame-Options: DENY` |
| 信息泄露 | 错误响应统一格式，不暴露内部细节 |
| 密钥泄露 | Secrets 不进代码/Git，D1 不存原文，日志不存内容 |

### 密钥层级

```
客户端持有      sp_beta_xxx  ──SHA-256──►  D1 api_keys.key_hash
                                                   │
Worker 持有      MINIMAX_API_KEY  ──Bearer──►  MiniMax API
(Cloudflare Secret)
```

客户端永远不接触 MiniMax Key，Worker 永远不存储客户端 Key 原文。

---

## 测试

```bash
# 运行所有测试（watch 模式）
npm test

# 单次运行
npm test -- --run

# 运行特定测试文件
npx vitest run test/index.spec.js
```

### 测试覆盖

| 测试文件 | 覆盖内容 |
|---------|---------|
| `test/index.spec.js` | 健康检查（200）、无 Key（401）、错误 Key（403）、正常对话（200）、Key 禁用（403）、配额超限（429）、无效 JSON（400）、未配置 Key（500）、上游失败（502）、request_count 自增、request_logs 写入 |
| `test/admin.spec.js` | 管理员鉴权（Access JWT / Token）、未授权（401）、Key 列表、创建 Key、更新 Key、删除 Key、重置配额、日志查询、CSRF 校验（403）|

### 测试环境

- 使用 `@cloudflare/vitest-pool-workers` 在本地模拟 Workers 运行时
- D1 使用 wrangler 本地 SQLite（`.wrangler/state/v3/d1/`）
- Secrets 通过 `test/setup.js` 注入测试环境变量
- 测试数据隔离，每次测试前重新应用 migration

---

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| **Runtime** | Cloudflare Workers | 全球边缘计算，零冷启动 |
| **Database** | Cloudflare D1 (SQLite) | 边缘 SQL 数据库，与 Workers 零延迟 |
| **AI Provider** | MiniMax-M3 | OpenAI 兼容协议，原生多模态 |
| **Admin UI** | 原生 HTML/CSS/JS | 零框架，零构建步骤 |
| **Auth** | Web Crypto API (SHA-256) | 无外部依赖的哈希计算 |
| **CLI** | wrangler | Cloudflare 官方 CLI |
| **Test** | Vitest + cloudflare/vitest-pool-workers | Workers 本地模拟测试 |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| `0.1-beta` | 2026-07 | 基础 API Gateway，内存数组鉴权，`/v1/chat` 回显 |
| `0.2-beta` | 2026-07 | 接入 MiniMax-M3，真实 AI 调用，多模态输入，Thinking 关闭 |
| `0.3-beta` | 2026-07 | 鉴权切换到 D1 持久化，SHA-256 哈希存储，请求日志表 |
| `0.4-beta` | 2026-07 | 请求额度控制（request_limit/429），Key 启用/禁用，管理脚本 |
| `0.5-beta` | 2026-07 | 管理后台 WebUI + API，域名隔离路由，CSRF 保护，Cloudflare Access |

---

## 后续规划

- [ ] **流式响应 (SSE)** — 支持 `stream: true`，透传 MiniMax 流式输出
- [ ] **多 Provider 路由** — `providers/` 新增 openai/kimi/glm，body 增加 `provider` 字段
- [ ] **过期校验** — 鉴权时检查 `expires_at`，过期 Key 返回特定错误码
- [ ] **时间窗口限流** — 基于 D1 的每分钟/每小时速率限制
- [ ] **Token 用量统计** — 从 MiniMax 响应中提取 `usage` 写入 `request_logs`
- [ ] **CI/CD** — GitHub Actions 自动化测试 + 部署
