# StudyPulse Cloud AI - SaaS 用户体系实现计划

## 一、摘要

为 StudyPulse Cloud AI 建立完整 SaaS 用户体系，支持邮箱验证码登录（Session Token）和 API Key（Beta/开发者）双鉴权系统，两套体系最终统一关联到 `user_id`，共享会员权限、额度检查和使用记录。

---

## 二、当前状态分析

### 2.1 现有架构

- **入口**：`src/index.js` — 域名路由（`spapi.chenkai.space` 公开 API，`admin.chenkai.space` 管理后台）
- **鉴权**：`src/auth.js` — 仅支持 `Authorization: Bearer <api_key>`，SHA-256 哈希匹配 D1 `api_keys` 表
- **Provider**：`src/providers/minimax.js` — MiniMax-M3，支持流式/非流式
- **管理后台**：`src/admin/` — Cloudflare Access + ADMIN_API_TOKEN 鉴权（入口层），CSRF 保护。仅此一个管理后台，部署在 `admin.chenkai.space`，统一管理 App 用户、Beta API Key 用户、会员、权限和使用情况
- **数据库**：D1（`StudyPulseDB`），当前有 3 张表：
  - `api_keys` — 已有 `user_id TEXT` 预留字段但未使用，无外键约束
  - `request_logs` — 仅关联 `api_key_id`，无 `user_id` 字段
  - （无 users/sessions/membership 等表）

### 2.2 关键约束

- wrangler.jsonc 不可修改（用户规则）
- 不破坏现有 `/v1/chat` API 兼容性
- API Key SHA-256 哈希存储策略保持不变
- 所有 D1 操作必须用 Prepared Statements
- API Key 鉴权函数 `authenticate()` 只读不写（额度自增分离）
- 管理后台 CSRF 机制保留
- 不重新创建数据库，继续使用现有 `StudyPulseDB`
- 不修改已有 migration 文件（0001、0002、0003 系列）

### 2.3 管理后台两层鉴权模型

管理后台仅有一个：`admin.chenkai.space`，统一管理所有用户和 API Key。不创建新的用户后台页面或新的域名。Users 功能作为现有 admin UI 的 Tab 增加。

两层权限控制：

```
第一层（入口安全层）：
  Cloudflare Access / ADMIN_API_TOKEN
  └─ 负责：是否允许进入 admin.chenkai.space

第二层（业务权限层，未来扩展）：
  users.role = 'admin'
  └─ 负责：细粒度管理员权限
```

- `authenticateAdmin()`（现有，不变）负责第一层入口认证
- `users.role` 作为业务权限扩展，不强制要求所有管理员必须有 users 表账号
- 如果当前管理员没有对应 users.id（仅通过 Cloudflare Access / ADMIN_API_TOKEN 进入）：
  - 管理操作仍可执行
  - `admin_logs.admin_user_id` 使用 `"admin_system"`
- 未来支持多管理员账号时，再绑定 users.id 实现细粒度权限

---

## 三、数据库设计

### 3.1 新增 Migration 文件

所有新 migration 使用 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` 保证幂等。

```
migrations/
├── 0001_create_api_keys.sql          (已有，不修改)
├── 0002_create_request_logs.sql      (已有，不修改)
├── 0003_add_limit_type.sql           (已有，不修改)
├── 0004_create_users.sql             (新增)
├── 0005_create_sessions.sql          (新增)
├── 0006_create_verification_codes.sql(新增)
├── 0007_create_membership_plans.sql  (新增)
├── 0008_alter_request_logs.sql       (新增：加 user_id 列)
├── 0009_create_usage_records.sql     (新增)
├── 0010_create_admin_logs.sql        (新增)
└── 0011_seed_membership_plans.sql    (新增：种子数据)
```

### 3.2 表结构详细设计

#### `users` 表（0004）

```sql
CREATE TABLE IF NOT EXISTS users (
    id                  TEXT PRIMARY KEY,              -- UUID
    email               TEXT UNIQUE NOT NULL,
    email_verified      INTEGER NOT NULL DEFAULT 0,    -- 0/1
    role                TEXT NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
    membership_type     TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'plus' | 'pro'
    membership_expires_at TEXT,                         -- NULL = 未设置到期时间
    github_id           TEXT UNIQUE,                   -- 预留
    username            TEXT,
    avatar_url          TEXT,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
```

**membership_expires_at 说明**：
- `NULL`：
  - free 用户：永久有效（free 本来就没有过期概念）
  - plus/pro 用户：管理员赠送永久会员
- 非 NULL：
  - 到期后运行时降级为 free（不修改数据库）
  - 管理员可通过后台续期

**注意**：`api_keys` 表已有 `user_id` 字段但需增加外键约束。由于 D1/SQLite 在 `CREATE TABLE IF NOT EXISTS` 中无法添加 ALTER 外键，且 api_keys 已存在大量数据，我们在应用层通过 JOIN 维护关联，不在 SQL 层加硬外键——这与现有 `request_logs.api_key_id` 的设计模式一致。

**邮箱规范化**：所有写入 `users.email` 的值必须先 `trim().toLowerCase()`，避免大小写和前后空格导致重复账号。

**GitHub OAuth**：`github_id`、`username`、`avatar_url` 仅预留数据库字段，本阶段不实现 GitHub OAuth 登录。

#### `sessions` 表（0005）

```sql
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,              -- UUID
    user_id     TEXT NOT NULL,                 -- FK users.id
    token_hash  TEXT NOT NULL UNIQUE,          -- SHA-256(session_token)
    expires_at  TEXT NOT NULL,                 -- ISO 8601
    last_used_at TEXT,                          -- 最近使用时间
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
```

Session Token 格式：`sp_sess_` + 64 位 hex（由 `crypto.getRandomValues(new Uint8Array(32))` 生成）。客户端使用 `Authorization: Bearer sp_sess_xxx`。

#### `email_verification_codes` 表（0006）

```sql
CREATE TABLE IF NOT EXISTS email_verification_codes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL,
    code            TEXT NOT NULL,                 -- 6 位数字
    used            INTEGER NOT NULL DEFAULT 0,   -- 0=未使用, 1=已使用
    attempts        INTEGER NOT NULL DEFAULT 0,   -- 验证码错误次数
    delivery_status TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'sent'|'failed'
    expires_at      TEXT NOT NULL,                 -- 10 分钟有效期
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_verification_email_code ON email_verification_codes(email, code);
CREATE INDEX IF NOT EXISTS idx_verification_created_at ON email_verification_codes(created_at);
```

delivery_status 状态：
- `pending`：验证码已生成，等待 Resend 发送
- `sent`：Resend 发送成功
- `failed`：Resend 发送失败（此时 used 同步设为 1）

验证码校验增加错误次数限制：
- 验证码校验失败 → attempts + 1
- attempts >= 5 → 验证码立即失效（等同 used=1）
- 继续保留：10 分钟过期、used=1 一次性使用、同邮箱发送频率限制

#### `membership_plans` 表（0007）

```sql
CREATE TABLE IF NOT EXISTS membership_plans (
    id                  TEXT PRIMARY KEY,      -- 'free' | 'plus' | 'pro'
    name                TEXT NOT NULL,
    daily_request_limit INTEGER,              -- NULL = 不限
    monthly_token_limit INTEGER,              -- NULL = 不限
    available_models    TEXT NOT NULL DEFAULT '["MiniMax-M3"]'  -- JSON array
);
```

#### `request_logs` 表修改（0008）

```sql
ALTER TABLE request_logs ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_request_logs_user_id ON request_logs(user_id);
```

三种记录情况（与 usage_records 一致）：

| 调用方式 | user_id | api_key_id |
|---------|---------|------------|
| Session Token（App 用户） | 有值 | NULL |
| API Key（已绑定用户） | 有值 | 有值 |
| 旧 API Key（未绑定用户） | NULL | 有值 |

#### `usage_records` 表（0009）

```sql
CREATE TABLE IF NOT EXISTS usage_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT,                       -- FK users.id（Session 调用和绑定用户的 API Key 调用时有值）
    api_key_id      INTEGER,                    -- 通过 API Key 调用时记录
    model           TEXT,
    input_tokens    INTEGER DEFAULT 0,
    output_tokens   INTEGER DEFAULT 0,
    total_tokens    INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_usage_records_user_id ON usage_records(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_created_at ON usage_records(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_records_user_created ON usage_records(user_id, created_at);
```

三种记录情况：

| 调用方式 | user_id | api_key_id |
|---------|---------|------------|
| Session Token（App 用户） | 有值 | NULL |
| API Key（已绑定用户） | 有值 | 有值 |
| 旧 API Key（未绑定用户，user_id=NULL） | NULL | 有值 |

#### `admin_logs` 表（0010）

```sql
CREATE TABLE IF NOT EXISTS admin_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id   TEXT NOT NULL,              -- users.id 或 "admin_system"（非严格外键）
    action          TEXT NOT NULL,              -- 如 'change_role', 'change_membership', 'create_api_key', 'disable_api_key', 'delete_api_key'
    target_user_id  TEXT,                       -- 可选：被操作的用户
    details         TEXT,                        -- JSON 详细信息
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at);
```

**admin_user_id 说明**：不作为严格外键，可保存 `users.id`（已登录管理员）或 `"admin_system"`（通过 Cloudflare Access / ADMIN_API_TOKEN 进入的无 Session 管理员）。

#### 种子数据（0011）

```sql
INSERT OR IGNORE INTO membership_plans (id, name, daily_request_limit, monthly_token_limit, available_models) VALUES
    ('free', 'Free', 50, 100000, '["MiniMax-M3"]'),
    ('plus', 'Plus', 500, 1000000, '["MiniMax-M3"]'),
    ('pro', 'Pro', NULL, NULL, '["MiniMax-M3"]');
```

---

## 四、代码结构

### 4.1 实现约束（必须遵守）

1. **不修改已有 migration**：0001、0002、0003 不做任何修改
2. **不修改 wrangler.jsonc**
3. **不改变 API 响应格式**：`POST /v1/chat` 保持 `{ success: true, data: { reply } }` 不变
4. **不引入生产依赖**：package.json 保持零生产依赖，所有功能用原生 Web API（fetch、crypto.subtle、crypto.getRandomValues、TextEncoder 等）
5. **所有 D1 查询使用 Prepared Statements**：参数化查询防止 SQL 注入
6. **Cloudflare Workers Runtime 兼容**：所有新增代码使用 Workers 兼容 API，无 Node.js 特有模块
7. **不重构 auth.js**：`src/auth.js` 保持不变，仅通过 `middleware.js` 包装调用其已有的 `authenticate()` 和 `sha256Hex()`
8. **每完成一个 Step 运行测试**，确认通过后再继续下一阶段

### 4.2 新增文件

```
src/
├── auth/
│   ├── email.js          (新增) — 邮箱验证码发送/校验逻辑
│   ├── session.js         (新增) — Session 创建/验证/销毁
│   └── middleware.js       (新增) — 统一鉴权中间件（Session + API Key 双鉴权）
│
├── users/
│   └── users.js           (新增) — 用户 CRUD 操作（D1）
│
├── membership/
│   └── membership.js      (新增) — 会员查询与额度检查
│
├── database/
│   ├── api_keys.js        (已有，需修改) — 增加 user_id 参数
│   └── usage.js           (新增) — usage_records 写入
│
├── admin/
│   ├── auth.js            (已有，保持不变)
│   ├── database.js        (已有，需修改) — 增加用户管理查询、admin_logs 写入
│   ├── routes.js          (已有，需修改) — 增加用户管理、API Key 管理增强路由
│   └── ui.js              (已有，需修改) — 管理后台 UI 增加用户管理页面
│
├── providers/
│   └── minimax.js         (已有，保持不变)
│
└── index.js               (已有，需修改) — 增加 auth 路由、双鉴权支持
```

### 4.3 各文件详细设计

---

#### `src/auth/email.js` — 邮箱验证码

```
函数：
  - sendVerificationCode(email, env) → { success: true/false, error?: string }
    1. 校验邮箱格式（简单正则）
    2. 检查 1 分钟内是否已发送 → 429 "Please wait before requesting a new code"
    3. 生成 6 位随机数字验证码（crypto.getRandomValues）
    4. INSERT INTO email_verification_codes (email, code, delivery_status='pending', expires_at)
       expires_at = now + 10 分钟
    5. 调用 sendEmail(email, code, env) 发送邮件
    6. Resend 成功 → UPDATE delivery_status='sent'，返回 { success: true }
    7. Resend 失败 → UPDATE delivery_status='failed', used=1，返回 { success: false, error: "Email delivery failed" }

  - verifyCode(email, code, env) → { success: true/false, error?: string, userId?: string }
    1. SELECT FROM email_verification_codes WHERE email=? ORDER BY created_at DESC LIMIT 1
       （按邮箱查最新一条记录，不按 code 筛选，否则错误验证码无法累计 attempts）
    2. 未找到记录 → "Invalid verification code"
    3. used=1 → "Verification code already used"
    4. attempts >= 5 → "Verification code locked due to too many attempts"
    5. expires_at < now → "Verification code expired"
    6. 记录中的 code 与用户输入的 code 不匹配 → UPDATE attempts = attempts + 1, 返回 "Invalid verification code"
    7. code 匹配 → UPDATE used=1（标记已使用）
    8. 查 users 表：SELECT FROM users WHERE email=?（email 已 trim + lowercase）
    9. 不存在 → INSERT INTO users (生成 UUID, email, email_verified=1)
    10. 存在 → UPDATE email_verified=1（如果之前未验证）
    11. 返回 userId

  - sendEmail(email, code, env) → { success: true/false }
    - 调用 Resend REST API：POST https://api.resend.com/emails
    - Authorization: Bearer ${env.RESEND_API_KEY}
    - Body: { from, to: email, subject, html }
    - 成功返回 { success: true }，失败返回 { success: false }
    - 仅通过 Resend REST API + Cloudflare Secret 实现，不使用 Cloudflare Email Routing

  所有验证码相关错误必须记录 console.error（发送失败、校验失败、attempts 超限等），方便 Cloudflare Workers 日志排查。
```

**Cloudflare Secret 新增**：`RESEND_API_KEY`

---

#### `src/auth/session.js` — Session 管理

```
函数：
  - createSession(userId, env) → { token: string }
    1. 生成 32 字节随机数据：crypto.getRandomValues(new Uint8Array(32))
    2. 转换为 hex（64 字符）：token = "sp_sess_" + hexString
    3. tokenHash = SHA-256(token)
    4. expires_at = now + 30 天
    5. INSERT INTO sessions (UUID, user_id, token_hash, expires_at)
    6. 返回 { token }（原始 token，仅此时可见）

  - validateSession(request, env) → { ok, userId?, response? }
    1. 从 Authorization header 提取 Bearer token
    2. 检查是否以 "sp_sess_" 开头 → 不是则返回 { ok: false }（让 middleware 回退到 API Key）
    3. SHA-256(token) → 查 sessions 表
    4. 检查 expires_at 是否过期
    5. 通过 → UPDATE last_used_at = CURRENT_TIMESTAMP, 返回 { ok: true, userId }

  - destroySession(token, env) → void
    1. SHA-256(token) → DELETE FROM sessions WHERE token_hash=?

  - cleanupExpiredSessions(env) → void
    1. DELETE FROM sessions WHERE expires_at < datetime('now')
    （可在管理员操作时附带调用，或定期 cron）
```

**Token 格式区分**：
- Session Token：`sp_sess_` + 64 hex（32 字节随机 → 64 hex 字符）
- API Key（Beta）：`sp_beta_` + 16-20 hex
- 通过前缀即可区分鉴权方式，无需额外字段

---

#### `src/auth/middleware.js` — 统一鉴权中间件

```
函数：
  - authenticateRequest(request, env) → { ok, userId?, apiKeyId?, response? }

  鉴权优先级（Session 用户身份优先）：
    第一优先：检查 Authorization: Bearer
       → 如果以 "sp_sess_" 开头 → 走 Session Token 鉴权
         调用 validateSession() → { ok, userId }
         返回 { userId, apiKeyId: null }

    第二优先：检查 X-API-Key header
       → 如果存在 → 走 API Key 鉴权
         调用现有 authenticate() → { ok, apiKey }
         返回 { userId: apiKey.user_id, apiKeyId: apiKey.id }

    第三优先（兼容旧版）：Authorization: Bearer 走 API Key 鉴权
       → 调用现有 authenticate() → { ok, apiKey }
         返回 { userId: apiKey.user_id, apiKeyId: apiKey.id }

  鉴权失败统一返回：
    { ok: false, response: Response }

  设计原因：
  - Session 用户身份优先：避免 App 用户请求同时携带 API Key 时身份冲突
  - X-API-Key 是推荐的 API Key 传递方式（语义清晰）
  - Authorization: Bearer 兼容旧版 API Key 用户
```

---

#### `src/users/users.js` — 用户操作

```
函数：
  - getUserById(userId, env) → user | null
  - getUserByEmail(email, env) → user | null
  - listAllUsers(env, filters?) → users[]
    支持按 role、membership_type、email 搜索
  - updateUserRole(userId, newRole, adminUserId, env) → boolean
  - updateUserMembership(userId, membershipType, expiresAt, adminUserId, env) → boolean
  - getUserStats(userId, env) → { totalRequests, totalTokens, apiKeysCount }
  - getUserSessions(userId, env) → sessions[]
  - getUserApiKeys(userId, env) → apiKeys[]

所有管理操作需写 admin_logs（在调用层而非此层实现）
```

---

#### `src/membership/membership.js` — 会员与额度

```
函数：
  - getMembershipPlan(planId, env) → plan | null
  - checkUserQuota(userId, env) → { allowed: true } | { allowed: false, reason: string }

    统一按 user_id 管理额度。两种入口统一流程：

    Session 用户：session → user_id → membership → quota
    API Key 用户（绑定用户）：api_key → user_id → membership → quota
    API Key 用户（未绑定用户）：走 api_keys 表自身 quota（不改动）

    避免双重额度限制：
    - authenticate() 仅负责 Key SHA-256 校验、是否存在、是否禁用、是否过期
    - 绑定用户的 API Key：设置 request_limit=NULL，额度由 checkUserQuota() 统一管理
    - 旧匿名 API Key：保留 request_limit 值，由 authenticate() 内部检查
    - 额度自增（incrementApiKeyUsage）行为不变，两类 Key 都正常累加

    具体步骤：
    1. SELECT role, membership_type, membership_expires_at FROM users WHERE id=?
    2. 如果 role='admin' → 直接通过（无限额度）
    3. 确定有效会员等级：如果 membership_expires_at 不为 NULL 且已过期 → 降为 'free'（运行时降级，不写库）
    4. 查 membership_plans 获取当前计划额度
    5. 查 usage_records 统计当日请求数（对比 daily_request_limit）
    6. 查 usage_records 统计当月 Token 消耗（对比 monthly_token_limit）
    7. 任一超限 → { allowed: false, reason: "Daily request limit exceeded" | "Monthly token limit exceeded" }
    8. 通过 → { allowed: true }

  - recordUsage(userId, apiKeyId, model, usage, env) → void

    写入 usage_records，三种情况：
    - Session 调用：user_id 有值, api_key_id=NULL
    - API Key 绑定用户：user_id 有值, api_key_id 有值
    - 旧 API Key 无用户：不写 usage_records（仅写 request_logs）

    INSERT INTO usage_records (user_id, api_key_id, model, input_tokens, output_tokens, total_tokens)
```

---

#### `src/database/api_keys.js` — 修改

**`incrementApiKeyUsage`**：保持不变（只操作 api_keys 表）。

**`createApiKey`（管理后台）**：增加必选 `user_id` 参数。

新创建的 API Key 必须绑定用户。后台创建 API Key 时支持选择绑定用户。

```diff
- export async function createApiKey(env, params) {
+ export async function createApiKey(env, params) {
    // params.user_id 必填（新 Key 强制绑定用户）
    // params.name 必填
    // params.limit_type, request_limit, notes, expires_at 可选
    // INSERT 时增加 user_id 绑定
```

**旧 API Key 兼容**：`api_keys` 表中已存在的 Key 允许 `user_id=NULL`，不改动。

---

#### `src/database/usage.js` — 新增

```
函数：
  - recordUsageRecord(env, { user_id, api_key_id, model, input_tokens, output_tokens, total_tokens }) → void
    仅在 user_id 存在时写入
    INSERT INTO usage_records (...)
```

---

#### `src/index.js` — 修改

**路由变更**：

```
handlePublicApi() 增加：
  POST /auth/email/send    → handleSendCode
  POST /auth/email/verify  → handleVerifyCode
  POST /auth/logout        → handleLogout
  POST /v1/chat            → handleChat（修改鉴权方式）

handleAdmin() 增加（管理后台用户 API）：
  GET  /api/admin/users             → 用户列表
  GET  /api/admin/users/:id         → 用户详情
  POST /api/admin/users/update      → 修改用户角色/会员
  GET  /api/admin/users/:id/stats   → 用户使用统计
  GET  /api/admin/users/:id/sessions → 用户 Session 列表
  GET  /api/admin/users/:id/keys    → 用户 API Key 列表
  POST /api/admin/logs              → 管理员操作日志查询
```

**handleChat 修改**：

```
修改前：authenticate(request, env) → apiKey
修改后：authenticateRequest(request, env) → { userId, apiKeyId }

流程变更：
  1. 鉴权 → { userId, apiKeyId }

  2. 额度检查（统一按 user_id）：
     有 userId →
       a. 查 users 表获取 role、membership_type、membership_expires_at
       b. role='admin' → 跳过额度检查
       c. 查 membership_plans 获取当前计划限额
       d. 查 usage_records 统计当日请求数 / 当月 Token 消耗
       e. 超限 → 返回 429
     无 userId（旧 API Key 未绑定用户） →
       额度由 authenticate() 在 api_keys.request_limit 检查（绑定用户 Key 设 request_limit=NULL 避免双重限制）

  3. 调用 AI Provider（同现有）

  4. 成功后记录：
     a. 有 apiKeyId → incrementApiKeyUsage()
     b. 有 userId → recordUsageRecord(userId, apiKeyId, model, usage)
     c. writeRequestLog({ user_id, api_key_id, ... })
```

**handleChatStream 同理修改**。

---

#### `src/admin/database.js` — 修改

新增函数：

```
- listUsers(env, filters?) → users[]
  支持按 email 搜索、按 role 筛选、按 membership_type 筛选
- getUserDetail(env, userId) → user + stats
- getUserSessions(env, userId) → sessions[]
- getUserApiKeys(env, userId) → apiKeys[]
- getUserUsageStats(env, userId) → { daily, monthly } 统计
- updateUser(env, userId, fields) → boolean
  fields: role?, membership_type?, membership_expires_at?
- writeAdminLog(env, { admin_user_id, action, target_user_id, details }) → void
- getAdminLogs(env, filters?) → logs[]
```

修改 `writeRequestLog`：增加 `user_id` 参数，与 `api_key_id` 按三种场景分别填写。

```diff
  export async function writeRequestLog(env, entry) {
+   // entry 新增: user_id (可选)
+   // Session 调用：user_id 有值, api_key_id=NULL
+   // API Key 绑定用户：user_id 有值, api_key_id 有值
+   // 旧 API Key：user_id=NULL, api_key_id 有值
+   INSERT ... (..., user_id) VALUES (..., ?)
```

修改 `writeRequestLog` SQL：

修改 Dashboard 统计 `getDashboardStats`：增加用户相关统计。
```diff
  - 返回 { totalKeys, enabledKeys, totalRequests, exceededQuotaKeys }
+ 返回 { totalKeys, enabledKeys, totalRequests, exceededQuotaKeys,
+         totalUsers, adminUsers, totalApiKeys }
```

---

#### `src/admin/routes.js` — 修改

**新增用户管理路由处理器**：

```
- handleListUsers(env, request)      — GET  /api/admin/users?search=&role=&membership=
- handleGetUser(env, userId)         — GET  /api/admin/users/:id
- handleUpdateUser(env, request)     — POST /api/admin/users/update  (fields: role?, membership_type?, membership_expires_at?)
- handleUserStats(env, userId)       — GET  /api/admin/users/:id/stats
- handleUserSessions(env, userId)    — GET  /api/admin/users/:id/sessions
- handleUserKeys(env, userId)        — GET  /api/admin/users/:id/keys
- handleAdminLogs(env, request)      — GET  /api/admin/logs
```

**修改 handleCreateKey**：增加必选 `user_id` 参数。

```diff
  const { name } = body;
+ const { user_id } = body;  // 必填，新 Key 必须绑定用户
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return error("name is required", 400);
  }
+ if (!user_id || typeof user_id !== "string") {
+   return error("user_id is required", 400);
+ }
```

所有修改用户/权限/API Key 的管理操作必须写 `admin_logs`。

**管理员身份传递**：写 `admin_logs` 时 `admin_user_id` 使用以下逻辑：
- 如果管理员已通过 Session 登录（能获取到 users.id），则使用该 ID
- 如果仅通过 Cloudflare Access / ADMIN_API_TOKEN 进入（无用户 Session），则 `admin_user_id` = `"admin_system"`

---

#### `src/admin/ui.js` — 管理后台 UI 扩展

在现有管理后台单页应用中增加 **Users Tab**（不创建新页面），与其他 Tab（仪表盘、API Keys、请求日志）并列。

分两个阶段实施：

**Phase 1（本次实现）**：
- 用户列表表格：ID、邮箱、验证状态、注册时间、角色、会员类型、到期时间
- 搜索框：按邮箱搜索
- 筛选器：按角色、会员类型
- 行内编辑：角色、会员类型、到期时间
- API Keys 管理（在用户详情中）：查看/创建/禁用/删除

**Phase 2（后续实现）**：
- Session 管理页面
- Usage 图表
- Admin Logs 页面

UI 保持现有纯 HTML/CSS/JS 风格，不引入额外框架。

---

## 五、/v1/chat 双鉴权完整流程

```
POST /v1/chat
│
├─ 1. authenticateRequest(request, env)
│     │
│     ├─ 第一优先：Authorization: Bearer 以 "sp_sess_" 开头？
│     │   └─ YES → validateSession() → { ok, userId }
│     │          → { userId, apiKeyId: null }
│     │
│     ├─ 第二优先：X-API-Key header 存在？
│     │   └─ YES → 现有 authenticate() → { ok, apiKey }
│     │          → { userId: apiKey.user_id, apiKeyId: apiKey.id }
│     │
│     └─ 第三优先（兼容）：Authorization: Bearer 走 API Key
│         └─ 现有 authenticate() → { ok, apiKey }
│            → { userId: apiKey.user_id, apiKeyId: apiKey.id }
│
├─ 2. 额度检查（统一按 user_id）：
│     ├─ 有 userId → checkUserQuota(userId)
│     │     ├─ role=admin → 跳过额度（无限）
│     │     ├─ membership → 查 membership_plans 获取限额
│     │     ├─ 查 usage_records 统计当日/当月用量
│     │     └─ 超限 → 返回 429
│     │
│     └─ 无 userId（旧 API Key 未绑定用户）：
           └─ 额度由 authenticate() 在 api_keys.request_limit 检查（request_limit 非 NULL 时）
│
├─ 3. AI Provider 调用（同现有，不变）
│
├─ 4. 成功后记录：
│     ├─ 有 apiKeyId → incrementApiKeyUsage(apiKeyId, tokens)
│     ├─ 有 userId → recordUsageRecord(userId, apiKeyId, model, usage)
│     └─ writeRequestLog({ user_id, api_key_id, ... })
│
└─ 5. 返回 { success: true, data: { reply } }
```

---

## 六、安全设计

| 层面 | 措施 |
|------|------|
| 验证码 | 6位随机数字，10分钟过期，最多5次错误尝试后锁定，使用后立即标记 used=1，防重放 |
| 发送限制 | 同一邮箱 1 分钟内不可重复发送 |
| Token 存储 | Session Token 仅存 SHA-256 哈希，原始 token 不存库 |
| API Key 存储 | 仅存 SHA-256 哈希（已有），不存原文 |
| Session 有效期 | 30 天自动过期 |
| 权限控制 | requireAdmin() 检查 role='admin'，用户只能操作自己的资源 |
| 额度检查 | 写入 usage_records 前检查，防止超额 |
| SQL 注入 | 100% 参数化 Prepared Statements |
| 密钥 | RESEND_API_KEY 存 Cloudflare Secret |

---

## 七、实施步骤

### Step 1：创建 Migration 文件（0004-0011）

按顺序创建 8 个新 migration SQL 文件。

### Step 2：实现 auth 模块

- `src/auth/email.js` — 验证码发送与校验
- `src/auth/session.js` — Session 管理
- `src/auth/middleware.js` — 双鉴权中间件

### Step 3：实现 users 与 membership 模块

- `src/users/users.js` — 用户 CRUD
- `src/membership/membership.js` — 会员与额度
- `src/database/usage.js` — usage_records 写入

### Step 4：修改现有文件

- `src/index.js` — 增加 auth 路由，修改 handleChat 双鉴权
- `src/admin/database.js` — 增加用户管理函数，修改 writeRequestLog
- `src/admin/routes.js` — 增加用户管理 API 路由
- `src/database/api_keys.js` — createApiKey 增加 user_id 参数
- `src/auth.js` — 导出 sha256Hex 供 session.js 复用（已导出）

### Step 5：管理后台 UI（Phase 1）

- `src/admin/ui.js` — 增加 Users Tab：用户列表、搜索、筛选、角色/会员编辑、API Key 管理

### Step 6：测试

- `test/setup.js` — 应用新 migration，种子 membership_plans
- `test/index.spec.js` — 增加 auth 路由测试、双鉴权测试
- `test/admin.spec.js` — 增加用户管理 API 测试

### Step 7：部署

1. 应用 D1 migrations：`wrangler d1 migrations apply StudyPulseDB --remote`
2. 设置 Secret：`wrangler secret put RESEND_API_KEY`
3. 部署 Worker：`npm run deploy`（由 CI/CD 执行）
4. 验证：
   - 邮件验证码登录流程
   - Session Token 调用 /v1/chat
   - API Key 调用 /v1/chat（向后兼容）
   - 管理员后台用户管理功能

---

## 八、兼容性保证

1. **现有 API Key 用户不受影响**：`Authorization: Bearer sp_beta_xxx` 继续工作，走原有 API Key 鉴权路径
2. **旧 API Key 数据保留**：`api_keys` 表中 `user_id=NULL` 的匿名 Key 继续可用，不删除、不迁移
3. **新 API Key 强制绑定用户**：通过后台创建的新 Key 必须关联 user_id
4. **现有管理后台不受影响**：Cloudflare Access + ADMIN_API_TOKEN 鉴权不变
5. **API 响应格式不变**：`POST /v1/chat` 返回 `{ success: true, data: { reply } }`
6. **现有 D1 数据不丢失**：所有 migration 只新增表/列，不修改已有数据结构
7. **wrangler.jsonc 不作修改**

---

## 九、Cloudflare Secrets & Variables

| 名称 | 类型 | 说明 |
|------|------|------|
| `MINIMAX_API_KEY` | Secret | (已有) MiniMax 上游 API Key |
| `ADMIN_API_TOKEN` | Secret | (已有) 管理后台降级 Token |
| `RESEND_API_KEY` | Secret | (新增) Resend 邮件服务 API Key |

无需新增 wrangler.jsonc vars 或 bindings。

---

## 十、API 调用示例

### 10.1 发送验证码

```bash
curl -X POST https://spapi.chenkai.space/auth/email/send \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

### 10.2 验证码登录

```bash
curl -X POST https://spapi.chenkai.space/auth/email/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","code":"123456"}'
# 返回: { "success": true, "data": { "token": "sp_sess_..." } }
```

### 10.3 App 用户调用 AI（Session Token）

```bash
curl -X POST https://spapi.chenkai.space/v1/chat \
  -H "Authorization: Bearer sp_sess_xxx" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

### 10.4 Beta 用户调用 AI（API Key）

```bash
# 新方式（推荐）
curl -X POST https://spapi.chenkai.space/v1/chat \
  -H "X-API-Key: sp_beta_xxx" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'

# 旧方式（兼容）
curl -X POST https://spapi.chenkai.space/v1/chat \
  -H "Authorization: Bearer sp_beta_xxx" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

### 10.5 退出登录

```bash
curl -X POST https://spapi.chenkai.space/auth/logout \
  -H "Authorization: Bearer sp_sess_xxx"
```

---

## 十一、注意事项

1. **数据库**：继续使用现有 `StudyPulseDB`（database_id: `df8b3261-ee9f-401d-9f07-cc3cbfa970e1`），不重新创建数据库
2. **wrangler.jsonc**：不做任何修改
3. **已有 migration**：0001、0002、0003 系列文件不做任何修改，仅新增 0004-0011
4. **API Key SHA-256 存储**：保持现有逻辑不变
5. **API 响应格式**：`POST /v1/chat` 返回 `{ success: true, data: { reply } }` 不变
6. **管理后台安全机制**：Cloudflare Access、ADMIN_API_TOKEN、CSRF 全部保留不变
7. **API Key user_id 关联**：新建 Key 必须绑定 user_id；旧 Key 允许 user_id=NULL，不删除、不迁移
8. **Resend 发送失败**：先写 DB 后发邮件，失败时标记验证码 used=1 使其失效，返回 "Email delivery failed"，保证 DB 与邮件状态一致
9. **双鉴权体系**：Session Token + API Key 保留，App 用户通过 Session 调用、Beta 用户通过 API Key 调用，两者统一关联 user_id
10. **每日限制重置**：按 UTC+8（Asia/Shanghai）自然日计算，查询 `usage_records` 时比较 `created_at` 日期
11. **不引入外部依赖**：保持 package.json 零生产依赖（当前只有 devDependencies），邮件发送用原生 fetch
12. **Session 清理**：每次鉴权时不主动清理过期 Session（避免增加热路径延迟），过期 Session 查询时自动忽略
