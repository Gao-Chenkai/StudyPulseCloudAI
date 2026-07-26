/**
 * StudyPulse Cloud AI - 管理后台 UI
 *
 * 纯 HTML/CSS/JS 实现，无框架依赖。
 * 中文界面，桌面优先的响应式设计。
 */

import { generateCsrfToken, applySecurityHeaders } from "./routes.js";

/**
 * 提供管理后台 HTML 页面。
 * 生成 CSRF Token 并嵌入页面。
 *
 * @param {Request} request
 * @param {{ ADMIN_API_TOKEN?: string }} env
 * @returns {Response}
 */
export function serveAdminPage(request, env) {
	const csrfToken = generateCsrfToken();
	const url = new URL(request.url);
	const secure = url.protocol === "https:";

	const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
	applySecurityHeaders(headers);

	// CSRF Cookie（SameSite=Strict，JS 可通过 document.cookie 读取）
	headers.append(
		"Set-Cookie",
		`admin_csrf=${csrfToken}; Path=/api/admin; SameSite=Strict; Max-Age=3600${secure ? "; Secure" : ""}`,
	);

	// 检测认证方式
	const hasCfAccess = !!request.headers.get("Cf-Access-Jwt-Assertion");

	return new Response(getAdminHtml(csrfToken, hasCfAccess), {
		status: 200,
		headers,
	});
}

function getAdminHtml(csrfToken, hasCfAccess) {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>StudyPulse Cloud AI - 管理后台</title>
<meta name="csrf-token" content="${csrfToken}">
<meta name="has-cf-access" content="${hasCfAccess ? "1" : "0"}">
<style>${CSS}</style>
</head>
<body>
<div class="app-shell">
  <aside class="sidebar" id="sidebar">
    <div class="brand-lockup">
      <div class="brand-mark">S</div>
      <div>
        <strong>StudyPulse</strong>
        <span>Cloud AI</span>
      </div>
    </div>
    <div class="sidebar-label">管理中心</div>
    <nav class="tabs" style="display:none" id="mainNav" aria-label="主导航">
      <button class="tab active" data-tab="dashboard"><span class="nav-icon">⌂</span><span>仪表盘</span></button>
      <button class="tab" data-tab="keys"><span class="nav-icon">⌁</span><span>Key 管理</span></button>
      <button class="tab" data-tab="users"><span class="nav-icon">◎</span><span>用户管理</span></button>
      <button class="tab" data-tab="blacklist"><span class="nav-icon">⊘</span><span>封禁用户</span></button>
      <button class="tab" data-tab="appeals"><span class="nav-icon">✉</span><span>申诉管理</span></button>
      <button class="tab" data-tab="logs"><span class="nav-icon">≡</span><span>请求日志</span></button>
    </nav>
    <div class="sidebar-footer">
      <span class="status-dot"></span>
      <span id="loginStatus">未连接</span>
      <button id="btnLogout" class="btn btn-sm btn-ghost" style="display:none" onclick="doLogout()">退出</button>
    </div>
  </aside>

  <main id="app" class="main-content">
    <header class="topbar">
      <button class="mobile-menu" type="button" onclick="toggleSidebar()" aria-label="打开导航">☰</button>
      <div>
        <div class="eyebrow">StudyPulse Cloud AI <span class="badge">管理后台</span></div>
        <h1 id="pageTitle">仪表盘</h1>
      </div>
      <div class="topbar-actions">
        <span class="topbar-status"><span class="status-dot"></span><span id="topbarStatus">安全连接</span></span>
      </div>
    </header>
  <!-- 登录遮罩 -->
  <div id="loginOverlay" class="login-overlay" style="display:none">
    <div class="login-container">
      <div class="login-brand"><div class="brand-mark">S</div><span>StudyPulse Admin</span></div>
      <h2>欢迎回来</h2>
      <p class="text-muted">请输入管理员凭证以访问控制台</p>
      <input type="password" id="loginToken" class="input" placeholder="ADMIN_API_TOKEN">
      <button class="btn btn-primary btn-block" onclick="doLogin()">登录控制台</button>
      <p id="loginError" class="error-text" style="display:none"></p>
    </div>
  </div>

  <!-- 加载中 -->
  <div id="loadingOverlay" class="login-overlay">
    <div class="login-container">
      <p class="text-muted">连接中...</p>
    </div>
  </div>

  <section id="tab-dashboard" class="tab-content active">
    <div class="page-heading">
      <div><h2>概览</h2><p>查看当前 API 资源和用户运行状态。</p></div>
      <button class="btn btn-outline" onclick="loadDashboard()">↻ 刷新数据</button>
    </div>
    <div class="stats-grid" id="statsGrid">
      <div class="stat-card"><div class="stat-card-top"><span class="stat-icon blue">⌁</span><span class="stat-trend">资源</span></div><div class="stat-label">总 Key 数</div><div class="stat-value skeleton">-</div><div class="stat-foot">全部 API 访问凭证</div></div>
      <div class="stat-card"><div class="stat-card-top"><span class="stat-icon green">✓</span><span class="stat-trend positive" id="enabledRate">--</span></div><div class="stat-label">启用 Key 数</div><div class="stat-value skeleton">-</div><div class="stat-foot">当前可用的访问凭证</div></div>
      <div class="stat-card"><div class="stat-card-top"><span class="stat-icon violet">↗</span><span class="stat-trend">累计</span></div><div class="stat-label">总请求数</div><div class="stat-value skeleton">-</div><div class="stat-foot">所有 API 请求总量</div></div>
      <div class="stat-card"><div class="stat-card-top"><span class="stat-icon orange">◎</span><span class="stat-trend">成员</span></div><div class="stat-label">用户数</div><div class="stat-value skeleton">-</div><div class="stat-foot">已注册的用户账户</div></div>
    </div>
    <div class="dashboard-grid">
      <div class="panel health-panel"><div class="panel-heading"><div><h3>系统健康</h3><p>根据当前 Key 状态计算</p></div><span class="health-pill" id="healthPill">检查中</span></div><div class="health-meter"><span id="healthMeterFill"></span></div><div class="health-copy"><strong id="healthHeadline">正在读取状态</strong><span id="healthDetail">请稍候...</span></div></div>
      <div class="panel quick-panel"><div class="panel-heading"><div><h3>快速操作</h3><p>常用管理动作</p></div></div><div class="quick-actions"><button class="quick-action" onclick="showCreateModal()"><span>＋</span><div><strong>创建 API Key</strong><small>为用户发放新凭证</small></div></button><button class="quick-action" onclick="showCreateUserModal()"><span>◎</span><div><strong>新建用户</strong><small>创建已认证账户</small></div></button><button class="quick-action" onclick="switchTab('logs')"><span>≡</span><div><strong>查看请求日志</strong><small>排查调用与错误</small></div></button></div></div>
    </div>
  </section>

  <section id="tab-keys" class="tab-content">
    <div class="page-heading"><div><h2>Key 管理</h2><p>创建和维护 API 访问凭证，实时查看用量与状态。</p></div><div class="heading-actions">
      <button class="btn btn-primary" onclick="showCreateModal()">+ 创建新 Key</button>
      <button class="btn btn-outline" onclick="loadKeys()">刷新</button>
    </div></div>
    <div class="toolbar filter-toolbar">
      <span class="filter-summary">API Keys</span><span class="filter-hint">按创建时间倒序排列</span>
    </div>
    <div id="keysTableContainer" class="table-container">
      <p class="empty-state">加载中...</p>
    </div>
  </section>

  <section id="tab-users" class="tab-content">
    <div class="page-heading"><div><h2>用户管理</h2><p>管理用户身份、会员等级和关联 API Key。</p></div><div class="heading-actions"><button class="btn btn-primary" onclick="showCreateUserModal()">+ 新建用户</button></div></div>
    <div class="toolbar filter-toolbar">
      <input type="text" id="userSearch" class="input-sm" placeholder="搜索邮箱..." style="width:200px">
      <select id="userRoleFilter" class="input-sm">
        <option value="">全部角色</option>
        <option value="user">用户</option>
        <option value="admin">管理员</option>
      </select>
      <select id="userMemberFilter" class="input-sm">
        <option value="">全部会员</option>
        <option value="free">Free</option>
        <option value="plus">Plus</option>
        <option value="pro">Pro</option>
      </select>
      <button class="btn btn-outline" onclick="loadUsers()">查询</button>
    </div>
    <div id="usersTableContainer" class="table-container">
      <p class="empty-state">点击查询加载用户</p>
    </div>
  </section>

  <section id="tab-blacklist" class="tab-content">
    <div class="page-heading"><div><h2>封禁用户</h2><p>阻止指定邮箱访问服务，并保留封禁原因。</p></div></div>
    <div class="toolbar filter-toolbar">
      <input type="email" id="blacklistEmail" class="input-sm" placeholder="输入邮箱地址..." style="width:280px">
      <input type="text" id="blacklistReason" class="input-sm" placeholder="封禁原因（可选）" style="width:200px">
      <button class="btn btn-danger" onclick="addBlacklist()">封禁</button>
      <button class="btn btn-outline" onclick="loadBlacklist()">刷新</button>
    </div>
    <div id="blacklistTableContainer" class="table-container">
      <p class="empty-state">点击刷新加载封禁用户</p>
    </div>
  </section>
  <section id="tab-appeals" class="tab-content">
    <div class="page-heading"><div><h2>申诉管理</h2><p>查看并处理用户的账号封禁申诉。</p></div></div>
    <div class="toolbar"><button class="btn btn-outline" onclick="loadAppeals()">刷新工单</button><select id="appealStatusFilter" class="input-sm" onchange="loadAppeals()"><option value="">全部状态</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已拒绝</option></select></div>
    <div id="appealsTableContainer" class="table-container"><p class="empty-state">点击刷新加载申诉工单</p></div>
  </section>

  <section id="tab-logs" class="tab-content">
    <div class="page-heading"><div><h2>请求日志</h2><p>筛选最近的 API 调用、响应状态和性能信息。</p></div></div>
    <div class="toolbar filter-toolbar">
      <label>Key ID: <input type="number" id="logFilterKeyId" placeholder="全部" class="input-sm"></label>
      <label>用户ID: <input type="text" id="logFilterUserId" placeholder="全部" class="input-sm"></label>
      <label>方式: <select id="logFilterCallMethod" class="input-sm">
        <option value="">全部</option>
        <option value="api_key">API Key</option>
        <option value="session">Session</option>
      </select></label>
      <label>状态: <select id="logFilterStatus" class="input-sm">
        <option value="">全部</option>
        <option value="200">200 成功</option>
        <option value="502">502 失败</option>
        <option value="500">500 错误</option>
      </select></label>
      <button class="btn btn-outline" onclick="loadLogs()">查询</button>
    </div>
    <div id="logsTableContainer" class="table-container">
      <p class="empty-state">点击查询加载日志</p>
    </div>
  </section>
</main>
</div>

<!-- 创建 Key 模态框 -->
<div id="modal-create" class="modal-overlay" style="display:none">
  <div class="modal">
    <h3>创建新 API Key</h3>
    <form id="formCreate" onsubmit="handleCreate(event)">
      <label>名称 *</label>
      <input type="text" name="name" class="input" required placeholder="例如：iOS Beta 内测 2">
      <label>用户 ID *</label>
      <input type="text" name="user_id" class="input" required placeholder="从用户管理页面复制用户 ID">
      <label>限制方式</label>
      <select name="limit_type" class="input">
        <option value="count">按请求次数</option>
        <option value="tokens">按 Token 用量</option>
      </select>
      <label>上限值</label>
      <input type="number" name="request_limit" class="input" placeholder="留空=不限量" min="0">
      <label>备注</label>
      <input type="text" name="notes" class="input" placeholder="发放渠道、用途说明等">
      <label>过期时间</label>
      <input type="datetime-local" name="expires_at" class="input">
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">创建</button>
        <button type="button" class="btn btn-outline" onclick="closeModal('modal-create')">取消</button>
      </div>
    </form>
    <div id="createResult" style="display:none"></div>
  </div>
</div>

<!-- 编辑 Key 模态框 -->
<div id="modal-edit" class="modal-overlay" style="display:none">
  <div class="modal">
    <h3>编辑 API Key</h3>
    <form id="formEdit" onsubmit="handleEdit(event)">
      <input type="hidden" name="id">
      <label>名称</label>
      <input type="text" name="name" class="input" required>
      <label>启用</label>
      <select name="enabled" class="input">
        <option value="1">是</option>
        <option value="0">否</option>
      </select>
      <label>限制方式</label>
      <select name="limit_type" class="input">
        <option value="count">按请求次数</option>
        <option value="tokens">按 Token 用量</option>
      </select>
      <label>上限值</label>
      <input type="number" name="request_limit" class="input" placeholder="留空=不限量" min="0">
      <label>备注</label>
      <input type="text" name="notes" class="input">
      <label>过期时间</label>
      <input type="datetime-local" name="expires_at" class="input">
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">保存</button>
        <button type="button" class="btn btn-outline" onclick="closeModal('modal-edit')">取消</button>
      </div>
    </form>
  </div>
</div>

<!-- 确认对话框 -->
<div id="modal-confirm" class="modal-overlay" style="display:none">
  <div class="modal modal-sm">
    <h3 id="confirmTitle">确认操作</h3>
    <p id="confirmMessage"></p>
    <div class="modal-actions">
      <button id="confirmOk" class="btn btn-danger">确认</button>
      <button class="btn btn-outline" onclick="closeModal('modal-confirm')">取消</button>
    </div>
  </div>
</div>

<!-- 用户详情模态框 -->
<div id="modal-user" class="modal-overlay" style="display:none">
  <div class="modal modal-lg">
    <h3>用户详情</h3>
    <div id="userDetailContent"></div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-outline" onclick="closeModal('modal-user')">关闭</button>
    </div>
  </div>
</div>

<!-- 用户 Key 创建模态框 -->
<div id="modal-user-key" class="modal-overlay" style="display:none">
  <div class="modal">
    <h3>为用户创建 API Key</h3>
    <form id="formUserKey" onsubmit="handleUserKeyCreate(event)">
      <input type="hidden" name="user_id">
      <label>名称 *</label>
      <input type="text" name="name" class="input" required>
      <label>限制方式</label>
      <select name="limit_type" class="input">
        <option value="count">按请求次数</option>
        <option value="tokens">按 Token 用量</option>
      </select>
      <label>上限值</label>
      <input type="number" name="request_limit" class="input" placeholder="留空=不限量" min="0">
      <label>备注</label>
      <input type="text" name="notes" class="input">
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">创建</button>
        <button type="button" class="btn btn-outline" onclick="closeModal('modal-user-key')">取消</button>
      </div>
    </form>
    <div id="userKeyResult" style="display:none"></div>
  </div>
</div>

<!-- 创建用户模态框 -->
<div id="modal-create-user" class="modal-overlay" style="display:none">
  <div class="modal">
    <h3>新建用户</h3>
    <form id="formCreateUser" onsubmit="handleCreateUserSubmit(event)">
      <label>邮箱 *</label>
      <input type="email" name="email" class="input" required placeholder="user@example.com">
      <label>角色</label>
      <select name="role" class="input">
        <option value="user">用户</option>
        <option value="admin">管理员</option>
      </select>
      <label>会员等级</label>
      <select name="membership_type" class="input">
        <option value="free">Free</option>
        <option value="plus">Plus</option>
        <option value="pro">Pro</option>
      </select>
      <p class="text-muted" style="font-size:12px; margin-top:8px;">管理后台创建的用户默认已完成邮箱认证。</p>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">创建</button>
        <button type="button" class="btn btn-outline" onclick="closeModal('modal-create-user')">取消</button>
      </div>
    </form>
    <div id="createUserResult" style="display:none"></div>
  </div>
</div>

<!-- Toast -->
<div id="toast" class="toast" style="display:none"></div>

<script>${JS}</script>
</body>
</html>`;
}

const CSS = `
:root { --primary:#2563eb; --primary-hover:#1d4ed8; --danger:#dc2626; --danger-hover:#b91c1c; --success:#16a34a; --warning:#d97706; --violet:#7c3aed; --bg:#fff; --surface:#fff; --surface-soft:#f8fafc; --border:#e5e7eb; --border-strong:#d1d5db; --text:#111827; --text-muted:#6b7280; --text-soft:#9ca3af; --radius:12px; --shadow:0 8px 24px rgba(15,23,42,.05); }
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{background:#fff} body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:#fff;color:var(--text);line-height:1.55;min-height:100vh;font-size:14px}
button,input,select{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid rgba(37,99,235,.2);outline-offset:2px}
.app-shell{min-height:100vh;display:flex;background:#fff}.sidebar{position:fixed;inset:0 auto 0 0;width:240px;background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column;padding:24px 14px 16px;z-index:110}.brand-lockup{display:flex;align-items:center;gap:10px;padding:0 12px 34px}.brand-lockup strong{display:block;font-size:15px;letter-spacing:-.02em}.brand-lockup span{display:block;color:var(--text-soft);font-size:11px;margin-top:1px}.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#2563eb,#60a5fa);color:#fff;font-weight:800;box-shadow:0 5px 12px rgba(37,99,235,.22)}.sidebar-label{color:var(--text-soft);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:0 12px 9px}.tabs{display:flex;flex-direction:column;gap:4px}.tab{width:100%;display:flex;align-items:center;gap:11px;padding:11px 12px;border:0;border-radius:9px;background:transparent;color:var(--text-muted);font-size:14px;text-align:left;transition:background .18s ease,color .18s ease,transform .18s ease;font-weight:500}.tab:hover{background:#f3f6fb;color:var(--text)}.tab:active{transform:scale(.98)}.tab.active{background:#eff6ff;color:var(--primary);font-weight:650}.nav-icon{width:18px;text-align:center;font-size:19px;line-height:1;color:currentColor}.sidebar-footer{margin-top:auto;border-top:1px solid var(--border);padding:16px 12px 2px;display:flex;align-items:center;gap:7px;color:var(--text-muted);font-size:12px}.sidebar-footer .btn{margin-left:auto}.status-dot{width:7px;height:7px;border-radius:50%;background:var(--success);box-shadow:0 0 0 3px #dcfce7;display:inline-block;flex:none}.main-content{width:calc(100% - 240px);margin-left:240px;min-width:0}.topbar{height:92px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 clamp(24px,4vw,56px);background:#fff;position:sticky;top:0;z-index:80}.eyebrow{color:var(--text-soft);font-size:12px;margin-bottom:3px}.badge{font-size:11px;color:var(--primary);background:#eff6ff;padding:3px 8px;border-radius:999px;margin-left:6px;font-weight:600}.topbar h1{font-size:23px;line-height:1.2;letter-spacing:-.03em}.topbar-status{display:flex;align-items:center;gap:9px;color:var(--text-muted);font-size:12px}.mobile-menu{display:none;border:1px solid var(--border);background:#fff;border-radius:8px;padding:7px 10px;color:var(--text);margin-right:12px}.main-content>section,.main-content>.login-overlay,.main-content>.login-overlay+*{margin-left:auto;margin-right:auto}.tab-content{display:none;padding:34px clamp(24px,4vw,56px) 56px;max-width:1440px}.tab-content.active{display:block}.page-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:26px}.page-heading h2{font-size:25px;line-height:1.2;letter-spacing:-.03em}.page-heading p{color:var(--text-muted);margin-top:6px}.heading-actions{display:flex;gap:9px;flex-wrap:wrap}.stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.stat-card,.panel{background:#fff;border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}.stat-card{padding:20px 21px;min-height:157px}.stat-card-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.stat-icon{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;font-size:17px;font-weight:700}.stat-icon.blue{background:#eff6ff;color:#2563eb}.stat-icon.green{background:#f0fdf4;color:#16a34a}.stat-icon.violet{background:#f5f3ff;color:#7c3aed}.stat-icon.orange{background:#fff7ed;color:#ea580c}.stat-trend{font-size:11px;color:var(--text-soft)}.stat-trend.positive{color:var(--success);font-weight:650}.stat-label{font-size:13px;color:var(--text-muted);margin-bottom:3px}.stat-value{font-size:29px;line-height:1.2;font-weight:750;letter-spacing:-.035em}.stat-foot{color:var(--text-soft);font-size:11px;margin-top:9px}.skeleton{color:var(--border-strong)}.dashboard-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}.panel{padding:22px}.panel-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.panel h3{font-size:15px;letter-spacing:-.01em}.panel-heading p{color:var(--text-soft);font-size:12px;margin-top:4px}.health-pill{border-radius:999px;background:#f0fdf4;color:var(--success);padding:4px 9px;font-size:11px;font-weight:650}.health-meter{height:8px;border-radius:10px;background:#f1f5f9;margin:25px 0 13px;overflow:hidden}.health-meter span{display:block;height:100%;width:0;border-radius:inherit;background:linear-gradient(90deg,#60a5fa,#2563eb);transition:width .45s ease}.health-copy{display:flex;justify-content:space-between;gap:14px;font-size:12px}.health-copy span{color:var(--text-muted);text-align:right}.quick-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:19px}.quick-action{border:1px solid var(--border);background:#fff;border-radius:10px;padding:13px 10px;text-align:left;display:flex;flex-direction:column;gap:10px;transition:border-color .18s,background .18s,transform .18s}.quick-action:hover{border-color:#93c5fd;background:#f8fbff;transform:translateY(-1px)}.quick-action>span{font-size:18px;color:var(--primary)}.quick-action strong{display:block;font-size:12px}.quick-action small{display:block;color:var(--text-soft);font-size:10px;margin-top:3px;white-space:nowrap}.toolbar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center}.filter-toolbar{padding:13px 15px;background:#fff;border:1px solid var(--border);border-radius:10px}.filter-toolbar label{font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px}.filter-summary{font-size:13px;font-weight:650}.filter-hint{font-size:12px;color:var(--text-soft);margin-right:auto}.btn{padding:9px 14px;border-radius:9px;border:1px solid transparent;cursor:pointer;font-size:13px;font-weight:600;transition:background .15s ease,border-color .15s ease,transform .15s ease,box-shadow .15s ease;display:inline-flex;align-items:center;justify-content:center;gap:6px}.btn:active{transform:scale(.97)}.btn-primary{background:var(--primary);color:#fff;border-color:var(--primary);box-shadow:0 3px 8px rgba(37,99,235,.17)}.btn-primary:hover{background:var(--primary-hover);border-color:var(--primary-hover)}.btn-outline{background:#fff;color:var(--text);border-color:var(--border-strong)}.btn-outline:hover{background:#f8fafc;border-color:#94a3b8}.btn-ghost{background:transparent;color:var(--text-muted);border:0;padding:3px 0}.btn-ghost:hover{color:var(--primary)}.btn-danger{background:var(--danger);color:#fff;border-color:var(--danger)}.btn-danger:hover{background:var(--danger-hover)}.btn-sm{padding:6px 9px;font-size:11px}.btn-block{width:100%}.input,.input-sm{padding:9px 11px;border:1px solid var(--border-strong);border-radius:8px;font-size:13px;width:100%;background:#fff;color:var(--text);transition:border-color .15s,box-shadow .15s}.input::placeholder,.input-sm::placeholder{color:#a1a1aa}.input:focus,.input-sm:focus{outline:0;border-color:#60a5fa;box-shadow:0 0 0 3px rgba(37,99,235,.11)}.input-sm{padding:7px 10px;font-size:12px;width:auto}.table-container{background:#fff;border:1px solid var(--border);border-radius:12px;overflow-x:auto;box-shadow:var(--shadow)}table{width:100%;border-collapse:collapse;font-size:12px;min-width:760px}th,td{padding:13px 15px;text-align:left;border-bottom:1px solid #f0f1f3;white-space:nowrap}tbody tr:last-child td{border-bottom:0}th{background:#fafafa;font-weight:650;color:var(--text-muted);font-size:11px;letter-spacing:.02em}tbody tr{transition:background .15s}tbody tr:hover td{background:#f8fbff}.status-badge{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:650}.status-enabled{background:#f0fdf4;color:#15803d}.status-disabled{background:#fef2f2;color:#b91c1c}.status-exceeded{background:#fff7ed;color:#c2410c}.actions-cell{display:flex;gap:5px;flex-wrap:wrap}.empty-state{text-align:center;padding:58px 30px;color:var(--text-muted);font-size:13px}.modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.38);backdrop-filter:blur(3px);display:flex;justify-content:center;align-items:center;padding:18px;z-index:200;animation:fadeIn .16s ease}.modal{background:#fff;border:1px solid rgba(255,255,255,.7);border-radius:16px;padding:26px;width:90%;max-width:520px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 70px rgba(15,23,42,.2);animation:slideUp .2s ease}.modal-sm{max-width:400px}.modal-lg{width:720px}.modal h3{margin-bottom:18px;font-size:18px;letter-spacing:-.02em}.modal label{display:block;font-size:12px;color:var(--text-muted);margin-bottom:5px;margin-top:14px}.modal label:first-of-type{margin-top:0}.modal-actions{display:flex;gap:8px;margin-top:22px;justify-content:flex-end}.login-overlay{position:fixed;inset:0;background:#fff;display:flex;justify-content:center;align-items:center;z-index:150}.login-container{max-width:410px;width:calc(100% - 36px);background:#fff;border:1px solid var(--border);border-radius:18px;padding:34px;box-shadow:0 18px 60px rgba(15,23,42,.08)}.login-brand{display:flex;align-items:center;gap:9px;color:var(--text);font-weight:700;margin-bottom:32px}.login-brand .brand-mark{width:30px;height:30px;border-radius:8px;font-size:13px}.login-container h2{font-size:25px;letter-spacing:-.04em;margin-bottom:7px}.login-container .input{margin-top:23px}.login-container .btn{margin-top:12px}.text-muted{color:var(--text-muted);font-size:13px}.error-text{color:var(--danger);font-size:12px;margin-top:9px}.copy-success{color:var(--success);font-size:12px;margin-left:8px}.key-display{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;margin-top:16px}.key-display code{display:block;font-size:13px;word-break:break-all;margin:9px 0;background:#fff;padding:9px 11px;border-radius:7px;border:1px solid var(--border)}.key-warning{color:var(--danger);font-size:11px;margin-top:8px}.toast{position:fixed;bottom:24px;right:24px;padding:12px 17px;border-radius:10px;color:#fff;font-size:13px;font-weight:600;z-index:300;animation:slideUp .2s ease;box-shadow:0 8px 24px rgba(15,23,42,.16)}.toast-success{background:#16a34a}.toast-error{background:#dc2626}.toast-info{background:#2563eb}.user-info-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}.user-info-grid>div{border:1px solid var(--border);border-radius:9px;padding:12px}.user-info-grid strong{font-size:11px;color:var(--text-muted)}.user-info-grid p{color:var(--text);margin-top:5px}.login-container p{line-height:1.6}@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@media (max-width:900px){.sidebar{width:210px}.main-content{width:calc(100% - 210px);margin-left:210px}.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dashboard-grid{grid-template-columns:1fr}}
@media (max-width:680px){.sidebar{transform:translateX(-100%);transition:transform .2s ease;box-shadow:12px 0 30px rgba(15,23,42,.08)}.sidebar.open{transform:translateX(0)}.main-content{width:100%;margin-left:0}.topbar{height:78px;padding:0 18px}.mobile-menu{display:block}.topbar-status{display:none}.tab-content{padding:25px 18px 40px}.page-heading{align-items:stretch;flex-direction:column;margin-bottom:20px}.heading-actions{width:100%}.heading-actions .btn{flex:1}.stats-grid{gap:10px}.stat-card{padding:15px;min-height:140px}.stat-value{font-size:24px}.quick-actions{grid-template-columns:1fr}.quick-action{flex-direction:row;align-items:center;gap:12px}.quick-action small{white-space:normal}.filter-toolbar{align-items:stretch}.filter-toolbar>*{width:100%!important}.filter-hint{margin-right:0}.modal{padding:20px}.toast{left:18px;right:18px;bottom:18px;text-align:center}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}
.usage-cell{min-width:145px}.usage-label{display:flex;justify-content:space-between;gap:8px;font-size:11px}.usage-label b{color:var(--text-muted);font-weight:600}.usage-bar{height:5px;border-radius:6px;background:#eef2f7;margin-top:6px;overflow:hidden}.usage-bar span{display:block;height:100%;border-radius:inherit;background:#60a5fa}.usage-unlimited{color:var(--text-soft);font-size:11px;margin-top:6px}
`;

const JS = `
// ── State ──
let authToken = "";
let csrfToken = "";
let hasCfAccess = false;

// ── Init (错误保护：任何异常都降级到登录表单) ──
(function init() {
  try {
    authToken = sessionStorage.getItem("admin_token") || "";
    csrfToken = document.querySelector('meta[name="csrf-token"]').content;
    hasCfAccess = document.querySelector('meta[name="has-cf-access"]').content === "1";
  } catch (e) {
    console.error("Admin init error:", e);
  }

  // Tabs
  try {
    document.querySelectorAll(".tab").forEach(tab => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });
  } catch (e) {}

  // 尝试自动认证
  try {
    if (hasCfAccess || authToken) {
      initApp();
    } else {
      showLogin();
    }
  } catch (e) {
    console.error("Admin auth flow error:", e);
    showLogin(); // 降级：显示登录表单
  }
})();

// ── Auth ──
function showLogin() {
  document.getElementById("loadingOverlay").style.display = "none";
  document.getElementById("loginOverlay").style.display = "flex";
}

// 兜底：5 秒后如果还在 loading 就显示登录
setTimeout(() => {
  var lo = document.getElementById("loadingOverlay");
  if (lo && lo.style.display !== "none") showLogin();
}, 5000);

function doLogin() {
  const token = document.getElementById("loginToken").value.trim();
  if (!token) return;
  authToken = token;
  document.getElementById("loginOverlay").style.display = "none";
  document.getElementById("loadingOverlay").style.display = "flex";
  document.getElementById("loginError").style.display = "none";
  apiCall("GET", "/api/admin/stats").then(r => {
    if (r.ok) {
      sessionStorage.setItem("admin_token", token);
      initApp();
    } else {
      authToken = "";
      document.getElementById("loadingOverlay").style.display = "none";
      document.getElementById("loginOverlay").style.display = "flex";
      document.getElementById("loginError").textContent = "Token 无效";
      document.getElementById("loginError").style.display = "block";
    }
  }).catch(e => {
    authToken = "";
    document.getElementById("loadingOverlay").style.display = "none";
    document.getElementById("loginOverlay").style.display = "flex";
    document.getElementById("loginError").textContent = "网络错误: " + (e.message || "请检查连接");
    document.getElementById("loginError").style.display = "block";
  });
}

function doLogout() {
  sessionStorage.removeItem("admin_token");
  authToken = "";
  hasCfAccess = false;
  document.getElementById("mainNav").style.display = "none";
  document.querySelectorAll(".tab-content").forEach(c => c.style.display = "none");
  showLogin();
}

async function initApp() {
  document.getElementById("loadingOverlay").style.display = "none";
  document.getElementById("loginOverlay").style.display = "none";
  document.getElementById("mainNav").style.display = "flex";
  document.querySelectorAll(".tab-content").forEach(c => c.style.display = "");
  document.getElementById("tab-dashboard").classList.add("active");
  updateLoginStatus(true);
  loadDashboard();
}

function updateLoginStatus(online) {
  const el = document.getElementById("loginStatus");
  const btn = document.getElementById("btnLogout");
  const topbar = document.getElementById("topbarStatus");
  if (!el || !btn) return;
  if (online) {
    el.textContent = hasCfAccess ? "Cloudflare Access" : "已连接";
    el.style.color = "var(--success)";
    if (topbar) topbar.textContent = hasCfAccess ? "Cloudflare Access" : "安全连接";
    btn.style.display = "";
  }
}

// ── API ──
async function apiCall(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  // CSRF token from meta tag
  headers["X-CSRF-Token"] = csrfToken;
  if (authToken) headers["Authorization"] = "Bearer " + authToken;

  // 确保 header 值仅含 Latin-1（浏览器 fetch 不允许以外字符）
  for (const k of Object.keys(headers)) {
    const v = String(headers[k]);
    let safe = "";
    for (let i = 0; i < v.length; i++) {
      if (v.charCodeAt(i) <= 0xFF) safe += v[i];
    }
    headers[k] = safe;
  }

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(path, opts);
  if (res.status === 401) {
    if (authToken) {
      sessionStorage.removeItem("admin_token");
      authToken = "";
    }
    if (!hasCfAccess) showLogin();
  }
  return res;
}

async function apiJson(method, path, body) {
  const res = await apiCall(method, path, body);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ── Tabs ──
function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.toggle("active", c.id === "tab-" + name));
  const titles = { dashboard: "仪表盘", keys: "Key 管理", users: "用户管理", blacklist: "封禁用户", appeals: "申诉管理", logs: "请求日志" };
  const title = document.getElementById("pageTitle");
  if (title) title.textContent = titles[name] || "管理后台";
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.classList.remove("open");
  if (name === "dashboard") loadDashboard();
  else if (name === "keys") loadKeys();
  else if (name === "users") loadUsers();
  else if (name === "blacklist") loadBlacklist();
  else if (name === "appeals") loadAppeals();
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.classList.toggle("open");
}

// ── Dashboard ──
async function loadDashboard() {
  try {
    const { data } = await apiJson("GET", "/api/admin/stats");
    const cards = document.querySelectorAll(".stat-value");
    cards[0].textContent = data.totalKeys;
    cards[1].textContent = data.enabledKeys;
    cards[2].textContent = data.totalRequests;
    cards[3].textContent = data.totalUsers ?? "-";
    cards.forEach(c => c.classList.remove("skeleton"));
    const rate = data.totalKeys ? Math.round((data.enabledKeys / data.totalKeys) * 100) : 0;
    const rateEl = document.getElementById("enabledRate");
    const fill = document.getElementById("healthMeterFill");
    const pill = document.getElementById("healthPill");
    const headline = document.getElementById("healthHeadline");
    const detail = document.getElementById("healthDetail");
    if (rateEl) rateEl.textContent = rate + "%";
    if (fill) fill.style.width = rate + "%";
    if (pill) {
      pill.textContent = data.exceededQuotaKeys ? data.exceededQuotaKeys + " 个需关注" : "运行良好";
      pill.style.background = data.exceededQuotaKeys ? "#fff7ed" : "#f0fdf4";
      pill.style.color = data.exceededQuotaKeys ? "#c2410c" : "var(--success)";
    }
    if (headline) headline.textContent = data.exceededQuotaKeys ? "有 Key 达到用量上限" : "所有资源运行正常";
    if (detail) detail.textContent = data.exceededQuotaKeys ? data.exceededQuotaKeys + " 个 Key 需要检查" : rate + "% 的 Key 处于启用状态";
  } catch (e) {
    showToast("加载仪表盘失败: " + e.message, "error");
  }
}

// ── Keys ──
async function loadKeys() {
  const container = document.getElementById("keysTableContainer");
  container.innerHTML = '<p class="empty-state">加载中...</p>';
  try {
    const { data } = await apiJson("GET", "/api/admin/keys");
    if (data.length === 0) {
      container.innerHTML = '<p class="empty-state">暂无 API Key</p>';
      return;
    }
    container.innerHTML = renderKeysTable(data);
  } catch (e) {
    container.innerHTML = '<p class="empty-state error-text">加载失败: ' + escapeHtml(e.message) + '</p>';
  }
}

function renderKeysTable(keys) {
  // 将 key 数据存入全局映射，避免在 onclick 中拼 JSON
  window._keyData = {};
  keys.forEach(k => { window._keyData[k.id] = k; });

  const rows = keys.map(k => {
    const enabled = k.enabled === 1;
    const limitType = k.limit_type || "count";
    const currentUsage = limitType === "tokens" ? (k.token_count ?? 0) : (k.request_count ?? 0);
    const exceeded = k.request_limit !== null && currentUsage >= k.request_limit;
    let statusHtml = enabled
      ? '<span class="status-badge status-enabled">启用</span>'
      : '<span class="status-badge status-disabled">停用</span>';
    if (exceeded) statusHtml += ' <span class="status-badge status-exceeded">超额</span>';
    if (limitType === "tokens") statusHtml += ' <span class="status-badge" style="background:#e0e7ff;color:#3730a3">Token制</span>';

    const usageLabel = limitType === "tokens"
      ? k.token_count + ' tokens / ' + (k.request_limit != null ? k.request_limit + ' tokens' : '\u221e')
      : k.request_count + '次 / ' + (k.request_limit != null ? k.request_limit + '次' : '\u221e');
    const usagePercent = k.request_limit != null ? Math.min(100, Math.round((currentUsage / k.request_limit) * 100)) : 0;
    const usageHtml = '<div class="usage-cell"><div class="usage-label"><span>' + usageLabel + '</span>' + (k.request_limit != null ? '<b>' + usagePercent + '%</b>' : '') + '</div>' + (k.request_limit != null ? '<div class="usage-bar"><span style="width:' + usagePercent + '%"></span></div>' : '<div class="usage-unlimited">不限量</div>') + '</div>';

    return '<tr>' +
      '<td>' + k.id + '</td>' +
      '<td>' + escapeHtml(k.name) + '</td>' +
      '<td>' + statusHtml + '</td>' +
      '<td>' + usageHtml + '</td>' +
      '<td>' + (k.expires_at ? formatDate(k.expires_at) : '-') + '</td>' +
      '<td>' + formatDate(k.created_at) + '</td>' +
      '<td>' + (k.last_used_at ? formatDate(k.last_used_at) : '\u4ece\u672a\u4f7f\u7528') + '</td>' +
      '<td>' + escapeHtml(k.notes || '-') + '</td>' +
      '<td class="actions-cell">' +
        '<button class="btn btn-sm btn-outline" onclick="showEditModal(' + k.id + ')">编辑</button>' +
        '<button class="btn btn-sm btn-outline" onclick="confirmResetQuota(' + k.id + ', \\'' + escapeHtml(k.name) + '\\')">重置配额</button>' +
        '<button class="btn btn-sm btn-danger" onclick="confirmDelete(' + k.id + ', \\'' + escapeHtml(k.name) + '\\')">删除</button>' +
      '</td>' +
    '</tr>';
  }).join("");

  return '<table><thead><tr>' +
    '<th>ID</th><th>名称</th><th>状态</th><th>用量</th>' +
    '<th>过期时间</th><th>创建时间</th><th>最后使用</th><th>备注</th><th>操作</th>' +
  '</tr></thead><tbody>' + rows + '</tbody></table>';
}

// ── Create Key ──
function showCreateModal() {
  document.getElementById("formCreate").reset();
  document.getElementById("createResult").style.display = "none";
  document.getElementById("formCreate").style.display = "";
  document.getElementById("modal-create").style.display = "flex";
}

async function handleCreate(e) {
  e.preventDefault();
  const form = e.target;
  const userId = form.user_id.value.trim();
  if (!userId) { showToast("请输入用户 ID", "error"); return; }
  const body = { name: form.name.value.trim(), user_id: userId };
  body.limit_type = form.limit_type.value;
  const limit = form.request_limit.value.trim();
  if (limit) body.request_limit = parseInt(limit);
  if (form.notes.value.trim()) body.notes = form.notes.value.trim();
  if (form.expires_at.value) body.expires_at = new Date(form.expires_at.value).toISOString();

  try {
    const { data } = await apiJson("POST", "/api/admin/keys/create", body);
    form.style.display = "none";
    const resultDiv = document.getElementById("createResult");
    resultDiv.innerHTML =
      '<div class="key-display">' +
        '<strong>API Key 创建成功 (ID: ' + data.id + ')</strong>' +
        '<code id="newKey">' + data.rawKey + '</code>' +
        '<button class="btn btn-sm btn-outline" onclick="copyKey()">复制</button>' +
        '<span id="copyMsg" class="copy-success" style="display:none">已复制</span>' +
        '<p class="key-warning">此 Key 仅显示一次，请立即复制并安全保存。关闭后无法找回。</p>' +
      '</div>' +
      '<div style="margin-top:12px">' +
        '<button class="btn btn-primary" onclick="closeModal(\\'modal-create\\'); loadKeys();">完成</button>' +
      '</div>';
    resultDiv.style.display = "block";
  } catch (e) {
    showToast("创建失败: " + e.message, "error");
  }
}

function copyKey() {
  const code = document.getElementById("newKey");
  navigator.clipboard.writeText(code.textContent).then(() => {
    document.getElementById("copyMsg").style.display = "inline";
    setTimeout(() => { document.getElementById("copyMsg").style.display = "none"; }, 2000);
  });
}

// ── Edit Key ──
function showEditModal(id) {
  const key = window._keyData && window._keyData[id];
  if (!key) return;
  const form = document.getElementById("formEdit");
  form.id.value = key.id;
  form.name.value = key.name;
  form.enabled.value = key.enabled;
  form.request_limit.value = key.request_limit != null ? key.request_limit : "";
  form.limit_type.value = key.limit_type || "count";
  form.notes.value = key.notes || "";
  form.expires_at.value = key.expires_at ? key.expires_at.slice(0, 16) : "";
  document.getElementById("modal-edit").style.display = "flex";
}

async function handleEdit(e) {
  e.preventDefault();
  const form = e.target;
  const body = {
    id: parseInt(form.id.value),
    name: form.name.value.trim(),
    enabled: parseInt(form.enabled.value),
  };
  const limit = form.request_limit.value.trim();
  body.request_limit = limit ? parseInt(limit) : null;
  body.limit_type = form.limit_type.value;
  body.notes = form.notes.value.trim() || null;
  body.expires_at = form.expires_at.value ? new Date(form.expires_at.value).toISOString() : null;

  try {
    await apiJson("POST", "/api/admin/keys/update", body);
    closeModal("modal-edit");
    loadKeys();
    showToast("更新成功", "success");
  } catch (e) {
    showToast("更新失败: " + e.message, "error");
  }
}

// ── Delete Key ──
function confirmDelete(id, name) {
  showConfirm("删除 API Key", '确定要删除 Key "' + name + '" (ID: ' + id + ') 吗？此操作不可撤销，关联的请求日志将被同时删除。', async () => {
    try {
      await apiJson("POST", "/api/admin/keys/delete", { id: id });
      closeModal("modal-confirm");
      loadKeys();
      showToast("已删除", "success");
    } catch (e) {
      showToast("删除失败: " + e.message, "error");
    }
  });
}

// ── Reset Quota ──
function confirmResetQuota(id, name) {
  showConfirm("重置配额", '确定要将 Key "' + name + '" (ID: ' + id + ') 的请求计数重置为 0 吗？', async () => {
    try {
      await apiJson("POST", "/api/admin/keys/reset-quota", { id: id });
      closeModal("modal-confirm");
      loadKeys();
      showToast("配额已重置", "success");
    } catch (e) {
      showToast("重置失败: " + e.message, "error");
    }
  });
}

// ── Logs ──
async function loadLogs() {
  const container = document.getElementById("logsTableContainer");
  container.innerHTML = '<p class="empty-state">加载中...</p>';
  try {
    const keyId = document.getElementById("logFilterKeyId").value.trim();
    const userId = document.getElementById("logFilterUserId").value.trim();
    const callMethod = document.getElementById("logFilterCallMethod").value;
    const status = document.getElementById("logFilterStatus").value;
    const params = new URLSearchParams();
    if (keyId) params.set("api_key_id", keyId);
    if (userId) params.set("user_id", userId);
    if (callMethod) params.set("call_method", callMethod);
    if (status) params.set("status", status);
    const { data } = await apiJson("GET", "/api/admin/logs?" + params.toString());
    if (data.length === 0) {
      container.innerHTML = '<p class="empty-state">暂无日志</p>';
      return;
    }
    container.innerHTML = renderLogsTable(data);
  } catch (e) {
    container.innerHTML = '<p class="empty-state error-text">加载失败: ' + escapeHtml(e.message) + '</p>';
  }
}

function renderLogsTable(logs) {
  const rows = logs.map(l => {
    const statusClass = l.status >= 200 && l.status < 300 ? "status-enabled" : "status-disabled";
    const callMethodLabel = l.call_method === "api_key"
      ? '<span class="status-badge" style="background:#dbeafe;color:#1e40af">API Key</span>'
      : '<span class="status-badge" style="background:#fef3c7;color:#92400e">Session</span>';
    return '<tr>' +
      '<td>' + l.id + '</td>' +
      '<td>' + callMethodLabel + '</td>' +
      '<td>' + l.api_key_id + ' (' + escapeHtml(l.key_name || '-') + ')</td>' +
      '<td>' + escapeHtml(l.user_email || (l.user_id ? l.user_id.slice(0, 8) + '...' : '-')) + '</td>' +
      '<td>' + formatDate(l.request_time) + '</td>' +
      '<td>' + (l.model || '-') + '</td>' +
      '<td><span class="status-badge ' + statusClass + '">' + l.status + '</span></td>' +
      '<td>' + (l.latency_ms != null ? l.latency_ms + 'ms' : '-') + '</td>' +
      '<td>' + (l.prompt_tokens != null ? l.prompt_tokens : '-') + ' / ' + (l.completion_tokens != null ? l.completion_tokens : '-') + ' / ' + (l.total_tokens != null ? l.total_tokens : '-') + '</td>' +
      '<td>' + escapeHtml((l.user_agent || '').slice(0, 60)) + '</td>' +
      '<td>' + escapeHtml((l.error_message || '').slice(0, 80)) + '</td>' +
    '</tr>';
  }).join("");

  return '<table><thead><tr>' +
    '<th>ID</th><th>方式</th><th>Key</th><th>用户</th><th>时间</th><th>模型</th>' +
    '<th>状态</th><th>延迟</th><th>Tokens (P/C/T)</th>' +
    '<th>客户端</th><th>错误</th>' +
  '</tr></thead><tbody>' + rows + '</tbody></table>';
}

// ── User Management ──
async function loadUsers() {
  const container = document.getElementById("usersTableContainer");
  container.innerHTML = '<p class="empty-state">加载中...</p>';
  try {
    const search = document.getElementById("userSearch").value.trim();
    const role = document.getElementById("userRoleFilter").value;
    const membership = document.getElementById("userMemberFilter").value;
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (role) params.set("role", role);
    if (membership) params.set("membership", membership);
    const { data } = await apiJson("GET", "/api/admin/users?" + params.toString());
    if (data.length === 0) {
      container.innerHTML = '<p class="empty-state">暂无用户</p>';
      return;
    }
    window._userData = {};
    data.forEach(u => { window._userData[u.id] = u; });
    container.innerHTML = renderUsersTable(data);
  } catch (e) {
    container.innerHTML = '<p class="empty-state error-text">加载失败: ' + escapeHtml(e.message) + '</p>';
  }
}

function renderUsersTable(users) {
  const rows = users.map(u => {
    const roleBadge = u.role === "admin"
      ? '<span class="status-badge" style="background:#fef3c7;color:#92400e">管理员</span>'
      : '<span class="status-badge" style="background:#e0e7ff;color:#3730a3">用户</span>';
    const verified = u.email_verified === 1
      ? '<span class="status-badge status-enabled">已验证</span>'
      : '<span class="status-badge status-disabled">未验证</span>';
    const memberLabels = { free: "Free", plus: "Plus", pro: "Pro" };
    const memberBadge = u.membership_type === "pro"
      ? '<span class="status-badge" style="background:#d1fae5;color:#065f46">Pro</span>'
      : u.membership_type === "plus"
        ? '<span class="status-badge" style="background:#dbeafe;color:#1e40af">Plus</span>'
        : '<span class="status-badge" style="background:#f1f5f9;color:#64748b">Free</span>';

    return '<tr>' +
      '<td>' + escapeHtml(u.id.slice(0,8)) + '...</td>' +
      '<td>' + escapeHtml(u.email) + '</td>' +
      '<td>' + verified + '</td>' +
      '<td>' + roleBadge + '</td>' +
      '<td>' + memberBadge + '</td>' +
      '<td>' + (u.membership_expires_at ? formatDate(u.membership_expires_at) : "-") + '</td>' +
      '<td>' + formatDate(u.created_at) + '</td>' +
      '<td class="actions-cell">' +
        '<button class="btn btn-sm btn-outline" onclick="showUserDetail(\\'' + u.id + '\\')">详情</button>' +
      '</td>' +
    '</tr>';
  }).join("");

  return '<table><thead><tr>' +
    '<th>ID</th><th>邮箱</th><th>验证</th><th>角色</th><th>会员</th>' +
    '<th>到期时间</th><th>注册时间</th><th>操作</th>' +
  '</tr></thead><tbody>' + rows + '</tbody></table>';
}

async function showUserDetail(userId) {
  document.getElementById("userDetailContent").innerHTML = '<p class="empty-state">加载中...</p>';
  document.getElementById("modal-user").style.display = "flex";
  try {
    const userPath = "/api/admin/users/" + encodeURIComponent(userId);
    const { data: user } = await apiJson("GET", userPath);
    const { data: keys } = await apiJson("GET", userPath + "/keys");
    let sessions = [];
    try {
      ({ data: sessions } = await apiJson("GET", userPath + "/sessions"));
    } catch (sessionError) {
      // Session 列表不是用户详情的核心数据，兼容旧数据库/部署时不阻断详情加载。
      console.warn("Failed to load user sessions", sessionError);
    }
    const { data: stats } = await apiJson("GET", userPath + "/stats");

    const roleBadge = user.role === "admin" ? "管理员" : "用户";
    const memberLabels = { free: "Free", plus: "Plus", pro: "Pro" };

    let keysHtml = '<p class="text-muted" style="margin-top:12px">API Keys (' + (keys ? keys.length : 0) + '个)</p>';
    if (keys && keys.length > 0) {
      keysHtml += '<div class="table-container"><table><thead><tr><th>ID</th><th>名称</th><th>状态</th><th>用量</th><th>操作</th></tr></thead><tbody>';
      keys.forEach(k => {
        const enabled = k.enabled === 1 ? '<span class="status-badge status-enabled">启用</span>' : '<span class="status-badge status-disabled">停用</span>';
        keysHtml += '<tr><td>' + k.id + '</td><td>' + escapeHtml(k.name) + '</td><td>' + enabled + '</td><td>' + k.request_count + '次</td>' +
          '<td class="actions-cell">' +
            '<button class="btn btn-sm btn-outline" onclick="disableKey(' + k.id + ')">' + (k.enabled ? '禁用' : '启用') + '</button>' +
            '<button class="btn btn-sm btn-danger" onclick="confirmDeleteKey(' + k.id + ', \\'' + escapeHtml(k.name) + '\\')">删除</button>' +
          '</td></tr>';
      });
      keysHtml += '</tbody></table></div>';
    }

    const activeSessions = (sessions || []).filter(s => !s.revoked_at && new Date(s.expires_at).getTime() > Date.now());
    let sessionsHtml = '<div class="detail-section-heading"><span>登录设备 (' + activeSessions.length + '个在线)</span>' +
      (activeSessions.length > 0 ? '<button class="btn btn-sm btn-danger" onclick="revokeUserSessions(\\'' + userId + '\\')">踢下线（全部设备）</button>' : '') +
      '</div>';
    if (activeSessions.length > 0) {
      sessionsHtml += '<div class="table-container"><table><thead><tr><th>设备</th><th>最近使用</th><th>登录时间</th><th>过期时间</th></tr></thead><tbody>';
      activeSessions.forEach(s => {
        sessionsHtml += '<tr><td>' + escapeHtml(s.device_name || s.user_agent || '未知设备') + '</td>' +
          '<td>' + formatDate(s.last_used_at || s.created_at) + '</td>' +
          '<td>' + formatDate(s.created_at) + '</td><td>' + formatDate(s.expires_at) + '</td></tr>';
      });
      sessionsHtml += '</tbody></table></div>';
    } else {
      sessionsHtml += '<p class="text-muted">当前没有在线设备</p>';
    }

    document.getElementById("userDetailContent").innerHTML =
      '<div class="user-info-grid">' +
        '<div><strong>邮箱</strong><p>' + escapeHtml(user.email) + '</p></div>' +
        '<div><strong>验证状态</strong><p>' + (user.email_verified ? "已验证" : "未验证") + '</p></div>' +
        '<div><strong>角色</strong><p><select id="editRole" class="input-sm" onchange="updateUserField(\\'' + userId + '\\', \\'role\\', this.value)"><option value="user"' + (user.role==="user"?" selected":"") + '>用户</option><option value="admin"' + (user.role==="admin"?" selected":"") + '>管理员</option></select></p></div>' +
        '<div><strong>会员</strong><p><select id="editMember" class="input-sm" onchange="updateUserField(\\'' + userId + '\\', \\'membership_type\\', this.value)"><option value="free"' + (user.membership_type==="free"?" selected":"") + '>Free</option><option value="plus"' + (user.membership_type==="plus"?" selected":"") + '>Plus</option><option value="pro"' + (user.membership_type==="pro"?" selected":"") + '>Pro</option></select></p></div>' +
        '<div><strong>到期时间</strong><p>' + (user.membership_expires_at ? formatDate(user.membership_expires_at) : "永久") + '</p></div>' +
        '<div><strong>注册时间</strong><p>' + formatDate(user.created_at) + '</p></div>' +
        '<div><strong>今日请求</strong><p>' + (stats ? stats.dailyRequests : "-") + '</p></div>' +
        '<div><strong>月Token</strong><p>' + (stats ? stats.monthlyTokens.toLocaleString() : "-") + '</p></div>' +
      '</div>' +
      '<button class="btn btn-primary" style="margin-top:12px" onclick="showUserKeyModal(\\'' + userId + '\\')">+ 为新 Key</button>' +
      (user.status === "banned" ? '<span class="status-badge status-disabled" style="margin:12px 0 0 8px">已封禁</span>' : '<button class="btn btn-sm btn-danger" style="margin:12px 0 0 8px" onclick="banUser(\\'' + userId + '\\')">封禁账号</button>') +
      (user.role !== "admin" ? '<button class="btn btn-sm btn-danger" style="margin:12px 0 0 8px" data-email="' + escapeHtml(user.email) + '" onclick="deleteUser(\\'' + userId + '\\', this.dataset.email)">删除账户</button>' : '') +
      keysHtml +
      '<div class="user-sessions">' + sessionsHtml + '</div>' +
      '<style>.user-info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; } .user-info-grid p { color: var(--text); margin-top: 4px; } .user-sessions { margin-top: 20px; } .detail-section-heading { display:flex; justify-content:space-between; align-items:center; margin: 18px 0 8px; font-weight: 600; }</style>';
  } catch (e) {
    document.getElementById("userDetailContent").innerHTML = '<p class="error-text">加载失败: ' + escapeHtml(e.message) + '</p>';
  }
}

async function banUser(userId) {
  const reason = prompt("请输入封禁原因");
  if (!reason || reason.trim().length < 3) return;
  try { const result = await apiJson("POST", "/api/admin/bans/create", { user_id: userId, reason: reason.trim() }); showToast(result.data?.emailSent ? "账号已封禁，通知邮件已发送" : "账号已封禁，但通知邮件发送失败: " + (result.data?.emailError || "未知错误"), result.data?.emailSent ? "success" : "error"); await showUserDetail(userId); } catch (e) { showToast("封禁失败: " + e.message, "error"); }
}

async function deleteUser(userId, email) {
  if (!confirm('确定删除账户 "' + email + '" 吗？此操作会永久删除账户、登录会话、API Key 和关联数据，且无法恢复。')) return;
  try {
    const result = await apiJson("POST", "/api/admin/users/delete", { user_id: userId });
    closeModal("modal-user");
    loadUsers();
    showToast(result.data?.emailSent ? "账户已删除，通知邮件已发送" : "账户已删除，但通知邮件发送失败: " + (result.data?.emailError || "未知错误"), result.data?.emailSent ? "success" : "error");
  } catch (e) {
    showToast("删除失败: " + e.message, "error");
  }
}

async function revokeUserSessions(userId) {
  if (!confirm("确定踢出该账号的全部登录设备吗？用户需要重新登录。")) return;
  try {
    const { data } = await apiJson("POST", "/api/admin/users/revoke-sessions", { user_id: userId });
    showToast("已踢下线 " + (data.revoked_count || 0) + " 个设备", "success");
    await showUserDetail(userId);
  } catch (e) {
    showToast("操作失败: " + e.message, "error");
  }
}

async function updateUserField(userId, field, value) {
  try {
    const body = { id: userId };
    body[field] = value;
    await apiJson("POST", "/api/admin/users/update", body);
    showToast("更新成功", "success");
  } catch (e) {
    showToast("更新失败: " + e.message, "error");
  }
}

function showUserKeyModal(userId) {
  document.getElementById("formUserKey").reset();
  document.getElementById("formUserKey").user_id.value = userId;
  document.getElementById("formUserKey").style.display = "";
  document.getElementById("userKeyResult").style.display = "none";
  document.getElementById("modal-user-key").style.display = "flex";
}

async function handleUserKeyCreate(e) {
  e.preventDefault();
  const form = e.target;
  const body = { name: form.name.value.trim(), user_id: form.user_id.value };
  body.limit_type = form.limit_type.value;
  const limit = form.request_limit.value.trim();
  if (limit) body.request_limit = parseInt(limit);
  if (form.notes.value.trim()) body.notes = form.notes.value.trim();
  try {
    const { data } = await apiJson("POST", "/api/admin/keys/create", body);
    form.style.display = "none";
    const resultDiv = document.getElementById("userKeyResult");
    resultDiv.innerHTML =
      '<div class="key-display">' +
        '<strong>Key 创建成功 (ID: ' + data.id + ')</strong>' +
        '<code id="newUserKey">' + data.rawKey + '</code>' +
        '<button class="btn btn-sm btn-outline" onclick="copyUserKey()">复制</button>' +
        '<span id="copyUserKeyMsg" class="copy-success" style="display:none">已复制</span>' +
        '<p class="key-warning">此 Key 仅显示一次，请立即复制并安全保存。</p>' +
      '</div>' +
      '<div style="margin-top:12px">' +
        '<button class="btn btn-primary" onclick="closeModal(\\'modal-user-key\\'); showUserDetail(\\'' + body.user_id + '\\')">完成</button>' +
      '</div>';
    resultDiv.style.display = "block";
  } catch (e) {
    showToast("创建失败: " + e.message, "error");
  }
}

function copyUserKey() {
  const code = document.getElementById("newUserKey");
  navigator.clipboard.writeText(code.textContent).then(() => {
    document.getElementById("copyUserKeyMsg").style.display = "inline";
    setTimeout(() => { document.getElementById("copyUserKeyMsg").style.display = "none"; }, 2000);
  });
}

function showCreateUserModal() {
  document.getElementById("formCreateUser").reset();
  document.getElementById("formCreateUser").style.display = "";
  document.getElementById("createUserResult").style.display = "none";
  document.getElementById("modal-create-user").style.display = "flex";
}

async function handleCreateUserSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const body = {
    email: form.email.value.trim(),
    role: form.role.value,
    membership_type: form.membership_type.value,
  };
  try {
    const { data: user } = await apiJson("POST", "/api/admin/users/create", body);
    form.style.display = "none";
    const resultDiv = document.getElementById("createUserResult");
    resultDiv.innerHTML =
      '<div class="key-display">' +
        '<strong>用户创建成功</strong>' +
        '<p>邮箱: ' + escapeHtml(user.email) + '</p>' +
        '<p>ID: <code>' + user.id + '</code></p>' +
        '<p style="color:var(--success);margin-top:4px">已默认认证，可直接登录使用。</p>' +
      '</div>' +
      '<div style="margin-top:12px">' +
        '<button class="btn btn-primary" onclick="closeModal(\\'modal-create-user\\'); loadUsers()">完成</button>' +
        '<button class="btn btn-outline" style="margin-left:8px" onclick="closeModal(\\'modal-create-user\\'); showUserDetail(\\'' + user.id + '\\')">查看详情</button>' +
      '</div>';
    resultDiv.style.display = "block";
  } catch (e) {
    showToast("创建失败: " + e.message, "error");
  }
}

async function disableKey(id) {
  try {
    await apiJson("POST", "/api/admin/keys/update", { id: id, enabled: 0 });
    showToast("Key 已禁用", "success");
    // refresh user detail - find current userId
    loadUsers();
    closeModal("modal-user");
  } catch (e) {
    showToast("操作失败: " + e.message, "error");
  }
}

async function confirmDeleteKey(id, name) {
  showConfirm("删除 API Key", '确定要删除 Key "' + name + '" (ID: ' + id + ') 吗？', async () => {
    try {
      await apiJson("POST", "/api/admin/keys/delete", { id: id });
      closeModal("modal-confirm");
      showToast("已删除", "success");
      loadUsers();
      closeModal("modal-user");
    } catch (e) {
      showToast("删除失败: " + e.message, "error");
    }
  });
}

// ── Blacklist Management ──
async function loadBlacklist() {
  const container = document.getElementById("blacklistTableContainer");
  container.innerHTML = '<p class="empty-state">加载中...</p>';
  try {
    const { data } = await apiJson("GET", "/api/admin/blacklist");
    if (data.length === 0) {
      container.innerHTML = '<p class="empty-state">暂无封禁用户</p>';
      return;
    }
    container.innerHTML = renderBlacklistTable(data);
  } catch (e) {
    container.innerHTML = '<p class="empty-state error-text">加载失败: ' + escapeHtml(e.message) + '</p>';
  }
}

async function loadAppeals() {
  const container = document.getElementById("appealsTableContainer");
  if (!container) return;
  container.innerHTML = '<p class="empty-state">加载中...</p>';
  try {
    const status = document.getElementById("appealStatusFilter").value;
    const { data } = await apiJson("GET", "/api/admin/appeals" + (status ? "?status=" + encodeURIComponent(status) : ""));
    if (!data.length) { container.innerHTML = '<p class="empty-state">暂无申诉工单</p>'; return; }
    container.innerHTML = '<table><thead><tr><th>用户邮箱</th><th>封禁原因</th><th>申诉内容</th><th>提交时间</th><th>状态</th><th>操作</th></tr></thead><tbody>' + data.map(a => '<tr><td>' + escapeHtml(a.email) + '</td><td>' + escapeHtml(a.reason) + '</td><td style="white-space:normal;min-width:260px">' + escapeHtml(a.content) + '</td><td>' + formatDate(a.created_at) + '</td><td><span class="status-badge ' + (a.status === "pending" ? "status-exceeded" : a.status === "approved" ? "status-enabled" : "status-disabled") + '">' + escapeHtml(a.status) + '</span></td><td>' + (a.status === "pending" ? '<button class="btn btn-sm btn-primary" onclick="reviewAppeal(\\'' + a.id + '\\',\\'approved\\')">通过</button> <button class="btn btn-sm btn-danger" onclick="reviewAppeal(\\'' + a.id + '\\',\\'rejected\\')">拒绝</button>' : '-') + '</td></tr>').join("") + '</tbody></table>';
  } catch (e) { container.innerHTML = '<p class="empty-state error-text">加载失败: ' + escapeHtml(e.message) + '</p>'; }
}

async function reviewAppeal(id, decision) {
  const reply = prompt("审核回复（可选）", decision === "approved" ? "申诉已通过，账号访问权限已恢复。" : "经审核，账号封禁状态维持不变。");
  if (reply === null) return;
  try { await apiJson("POST", "/api/admin/appeals/review", { id, decision, admin_reply: reply }); showToast("工单已处理", "success"); loadAppeals(); } catch (e) { showToast("处理失败: " + e.message, "error"); }
}

function renderBlacklistTable(list) {
  const rows = list.map(item => {
    return '<tr>' +
      '<td>' + escapeHtml(item.email) + '</td>' +
      '<td>' + escapeHtml(item.reason || '-') + '</td>' +
      '<td>' + formatDate(item.created_at) + '</td>' +
      '<td class="actions-cell">' +
        '<button class="btn btn-sm btn-danger" onclick="confirmRemoveBlacklist(\\'' + escapeHtml(item.email) + '\\')">解除封禁</button>' +
      '</td>' +
    '</tr>';
  }).join("");

  return '<table><thead><tr>' +
    '<th>邮箱</th><th>原因</th><th>添加时间</th><th>操作</th>' +
  '</tr></thead><tbody>' + rows + '</tbody></table>';
}

async function addBlacklist() {
  const email = document.getElementById("blacklistEmail").value.trim();
  if (!email) { showToast("请输入邮箱地址", "error"); return; }
  const reason = document.getElementById("blacklistReason").value.trim();

  try {
    const { data: result } = await apiJson("POST", "/api/admin/blacklist/add", { email, reason: reason || undefined });
    document.getElementById("blacklistEmail").value = "";
    document.getElementById("blacklistReason").value = "";
    loadBlacklist();
    showToast(result?.emailSent === false ? "已封禁，但封禁邮件发送失败: " + (result.emailError || "未知错误") : "已封禁: " + email, result?.emailSent === false ? "error" : "success");
  } catch (e) {
    showToast("封禁失败: " + e.message, "error");
  }
}

function confirmRemoveBlacklist(email) {
  showConfirm("解除封禁", '确定要解除对 "' + email + '" 的封禁吗？', async () => {
    try {
      await apiJson("POST", "/api/admin/blacklist/remove", { email: email });
      closeModal("modal-confirm");
      loadBlacklist();
      showToast("已解除封禁", "success");
    } catch (e) {
      showToast("操作失败: " + e.message, "error");
    }
  });
}

// ── Modal Helpers ──
function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

function showConfirm(title, message, onOk) {
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmMessage").textContent = message;
  const okBtn = document.getElementById("confirmOk");
  const newOk = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOk, okBtn);
  newOk.addEventListener("click", onOk);
  document.getElementById("modal-confirm").style.display = "flex";
}

// ── Toast ──
let toastTimer;
function showToast(msg, type) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.className = "toast toast-" + type;
  toast.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.display = "none"; }, 3000);
}

// ── Utils ──
function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(s) {
  if (!s) return "-";
  try {
    // D1/CURRENT_TIMESTAMP returns a timezone-less UTC timestamp. Add the
    // UTC designator before parsing so the browser does not treat it as local
    // time (the value stored in the database remains unchanged).
    const value = String(s).trim();
    const utcValue = /^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?$/.test(value)
      ? value.replace(" ", "T") + "Z"
      : value;
    const d = new Date(utcValue);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  } catch (e) { return s; }
}

// Close modals on overlay click
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay") && e.target.id !== "loginOverlay" && e.target.id !== "loadingOverlay") {
    e.target.style.display = "none";
  }
});
`;

export { CSS, JS, getAdminHtml };
