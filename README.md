# StudyPulse Cloud AI

Cloudflare Workers 驱动的 AI 后端网关，为 StudyPulse iOS App 提供 MiniMax-M3 AI 调用服务。

**版本：** 0.4-beta

## 架构

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

管理后台
    │  HTTPS  Cloudflare Access / ADMIN_API_TOKEN
    ▼
Cloudflare Worker  ──►  D1 (StudyPulseDB)  管理 CRUD
```

## 目录结构

```
src/
├── index.js              路由 + 请求处理
├── auth.js               API Key 鉴权（公开 API）
├── providers/
│   └── minimax.js        AI 调用（MiniMax-M3）
├── database/
│   └── api_keys.js       额度自增
└── admin/
    ├── auth.js           管理员鉴权
    ├── database.js       管理后台 D1 操作
    ├── routes.js         管理后台 API 路由
    └── ui.js             管理后台 WebUI
migrations/
├── 0001_create_api_keys.sql
└── 0002_create_request_logs.sql
scripts/                  管理脚本
test/                     测试
```

## 快速开始

```bash
npm install
npm run dev           # 本地开发 http://localhost:8787
npm test              # 运行测试
```

### 本地开发环境变量

创建 `.dev.vars`（已 gitignore）：

```
MINIMAX_API_KEY=sk-your-minimax-key
ADMIN_API_TOKEN=your-admin-token
```

## 部署

### 1. 设置 Secrets

```bash
# MiniMax AI 上游 Key
npx wrangler secret put MINIMAX_API_KEY

# 管理后台 Token（Cloudflare Access 降级方案）
npx wrangler secret put ADMIN_API_TOKEN
```

### 2. 应用 D1 Migrations

```bash
# 本地
npx wrangler d1 migrations apply studypulse-cloud-ai-db --local

# 生产
npx wrangler d1 migrations apply studypulse-cloud-ai-db --remote
```

### 3. 种子初始 API Key

```bash
# 通过管理后台 UI 创建
# 或使用脚本
node scripts/create-api-key.js "iOS Beta 001" --remote
```

### 4. 部署 Worker

```bash
npm run deploy
```

## 管理后台

### 访问

管理后台通过以下方式访问：

- **域名：** `admin.chenkai.space`（需在 Cloudflare Dashboard 添加 DNS 记录指向 Worker）
- **路径：** `/admin`（任意绑定到 Worker 的域名均可）

### 认证方式

#### 方式 1：Cloudflare Access（推荐）

1. 在 Cloudflare Zero Trust Dashboard 中创建 Application
2. 选择 `Self-hosted` 类型
3. 设置 Application Domain 为 `admin.chenkai.space`
4. 添加 Identity Provider（如 GitHub、Google、邮箱 OTP）
5. 配置 Access Policy 允许管理员访问
6. Worker 自动读取 `Cf-Access-Jwt-Assertion` header 完成认证

> 无需在 Worker 代码或前端配置任何 Access 相关 Secret。

#### 方式 2：ADMIN_API_TOKEN（降级方案）

1. 生成强随机 Token：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. 注入 Secret：

```bash
npx wrangler secret put ADMIN_API_TOKEN
```

3. 访问管理后台时输入此 Token 登录

### admin.chenkai.space 域名绑定

在 Cloudflare Dashboard 中：

1. 确保 `chenkai.space` 的 DNS 由 Cloudflare 管理
2. 添加 `CNAME` 记录：`admin` → Worker 的 `*.workers.dev` 子域名
3. 或在 Workers Routes 中添加路由：`admin.chenkai.space/*`

### 管理后台 API

所有管理 API 都需要管理员认证。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/stats` | 仪表盘统计 |
| GET | `/api/admin/keys` | 列出所有 Key |
| POST | `/api/admin/keys/create` | 创建 Key |
| POST | `/api/admin/keys/update` | 更新 Key |
| POST | `/api/admin/keys/delete` | 删除 Key |
| POST | `/api/admin/keys/reset-quota` | 重置配额 |
| GET | `/api/admin/logs` | 请求日志 |

状态变更接口（POST）需要 CSRF Token：
- 管理页面加载时自动注入 CSRF Token 到 `<meta>` 标签
- 前端 JS 自动发送 `X-CSRF-Token` header
- 服务端验证 Cookie 中的 Token 与 Header 一致

## 公开 API

详见 [docs/API.md](docs/API.md)。

### 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 健康检查 |
| POST | `/v1/chat` | AI 对话（需 API Key 鉴权）|

### 错误码

| HTTP | error | 触发条件 |
|------|-------|---------|
| 400 | `Invalid JSON Body` | 请求体非合法 JSON |
| 401 | `Missing API Key` | 未携带 Authorization |
| 403 | `Invalid API Key` | Key 无效或已禁用 |
| 404 | `Not Found` | 未定义路径 |
| 429 | `API quota exceeded` | 超出请求额度 |
| 500 | `Server not configured` | 未配置上游 AI Key |
| 502 | `AI request failed` | 上游 AI 调用失败 |

## API Key 管理

### 创建 Key（管理后台）

通过管理后台 UI 或管理 API 创建。Key 格式：`sp_beta_` + 随机 hex。

### 创建 Key（脚本）

```bash
node scripts/create-api-key.js "Key Name" --remote
```

原始 Key 仅在创建时显示一次。

### 其他管理脚本

```bash
node scripts/list-api-keys.js --remote
node scripts/update-quota.js <id> <limit> --remote
node scripts/disable-api-key.js <id> --remote
node scripts/delete-api-key.js <id> --remote
```

## 安全说明

### API Key 存储

- D1 `api_keys` 表只存 `key_hash`（SHA-256），绝不存原始 Key
- 原始 Key 仅在创建时展示一次，之后无法恢复
- 管理后台 API 绝不返回 `key_hash` 字段

### Secret 管理

| Secret | 用途 | 注入方式 |
|--------|------|---------|
| `MINIMAX_API_KEY` | 上游 AI 调用 | `wrangler secret put` |
| `ADMIN_API_TOKEN` | 管理后台降级认证 | `wrangler secret put` |

- 绝不写入代码、`wrangler.jsonc`、Git 仓库
- Cloudflare 加密存储，仅运行时注入 `env`
- 不在任何 API 响应或前端 JS 中暴露

### 管理后台安全

- 优先使用 Cloudflare Access（企业级 SSO + MFA）
- ADMIN_API_TOKEN 作为降级方案
- 状态变更 API 需要 CSRF Token（SameSite=Strict Cookie + 自定义 Header）
- 安全响应头：`X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`
- CORS：不设置 `Access-Control-Allow-Origin`，仅同源访问
- 所有 D1 查询使用参数化 prepared statements，防止 SQL 注入
- 管理员鉴权使用常量时间字符串比较，防止时序攻击

### 请求日志

- `request_logs` 表记录每次 AI 请求的元数据
- 不记录 prompt、reply 内容
- 日志字段：api_key_id, model, provider, status, latency_ms, tokens, client info
- 通过管理后台 UI 可查看和筛选
- 删除 API Key 时 CASCADE 删除关联日志

## 测试

```bash
npm test              # 运行所有测试
npm test -- --run     # 单次运行（非 watch 模式）
```

测试覆盖：
- 公开 API：健康检查、鉴权失败、上游调用
- 管理 API：鉴权、Key CRUD、配额重置、CSRF 保护
- 安全性：key_hash 绝不暴露、rawKey 仅创建时返回

## 技术栈

- **Runtime:** Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite)
- **AI Provider:** MiniMax-M3 (OpenAI 兼容接口)
- **前端:** 原生 HTML/CSS/JS（无框架）
- **测试:** Vitest + `@cloudflare/vitest-pool-workers`
