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
<header>
  <div class="header-inner">
    <h1>StudyPulse Cloud AI <span class="badge">管理后台</span></h1>
    <div class="header-actions">
      <span id="loginStatus"></span>
      <button id="btnLogout" class="btn btn-sm btn-outline" style="display:none" onclick="doLogout()">退出登录</button>
    </div>
  </div>
</header>

<main id="app">
  <!-- 登录遮罩 -->
  <div id="loginOverlay" class="login-overlay" style="display:none">
    <div class="login-container">
      <h2>管理员登录</h2>
      <p class="text-muted">请输入 ADMIN_API_TOKEN 以访问管理后台</p>
      <input type="password" id="loginToken" class="input" placeholder="ADMIN_API_TOKEN">
      <button class="btn btn-primary" onclick="doLogin()">登录</button>
      <p id="loginError" class="error-text" style="display:none"></p>
    </div>
  </div>

  <!-- 加载中 -->
  <div id="loadingOverlay" class="login-overlay">
    <div class="login-container">
      <p class="text-muted">连接中...</p>
    </div>
  </div>

  <nav class="tabs" style="display:none" id="mainNav">
    <button class="tab active" data-tab="dashboard">仪表盘</button>
    <button class="tab" data-tab="keys">Key 管理</button>
    <button class="tab" data-tab="logs">请求日志</button>
  </nav>

  <section id="tab-dashboard" class="tab-content active">
    <div class="stats-grid" id="statsGrid">
      <div class="stat-card"><div class="stat-label">总 Key 数</div><div class="stat-value skeleton">-</div></div>
      <div class="stat-card"><div class="stat-label">启用 Key 数</div><div class="stat-value skeleton">-</div></div>
      <div class="stat-card"><div class="stat-label">总请求数</div><div class="stat-value skeleton">-</div></div>
      <div class="stat-card"><div class="stat-label">超额 Key 数</div><div class="stat-value skeleton">-</div></div>
    </div>
  </section>

  <section id="tab-keys" class="tab-content">
    <div class="toolbar">
      <button class="btn btn-primary" onclick="showCreateModal()">+ 创建新 Key</button>
      <button class="btn btn-outline" onclick="loadKeys()">刷新</button>
    </div>
    <div id="keysTableContainer" class="table-container">
      <p class="empty-state">加载中...</p>
    </div>
  </section>

  <section id="tab-logs" class="tab-content">
    <div class="toolbar">
      <label>Key ID: <input type="number" id="logFilterKeyId" placeholder="全部" class="input-sm"></label>
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

<!-- 创建 Key 模态框 -->
<div id="modal-create" class="modal-overlay" style="display:none">
  <div class="modal">
    <h3>创建新 API Key</h3>
    <form id="formCreate" onsubmit="handleCreate(event)">
      <label>名称 *</label>
      <input type="text" name="name" class="input" required placeholder="例如：iOS Beta 内测 2">
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

<!-- Toast -->
<div id="toast" class="toast" style="display:none"></div>

<script>${JS}</script>
</body>
</html>`;
}

const CSS = `
:root {
  --primary: #4f46e5;
  --primary-hover: #4338ca;
  --danger: #dc2626;
  --danger-hover: #b91c1c;
  --success: #059669;
  --warning: #d97706;
  --bg: #f8fafc;
  --surface: #ffffff;
  --border: #e2e8f0;
  --text: #1e293b;
  --text-muted: #64748b;
  --radius: 8px;
  --shadow: 0 1px 3px rgba(0,0,0,.1);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  min-height: 100vh;
}

header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 0 24px;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: var(--shadow);
}

.header-inner {
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 56px;
}

h1 { font-size: 18px; font-weight: 600; }
.badge { font-size: 12px; color: var(--primary); background: #eef2ff; padding: 2px 8px; border-radius: 12px; margin-left: 8px; font-weight: 500; }

main { max-width: 1280px; margin: 0 auto; padding: 24px; }

/* Tabs */
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  border-bottom: 2px solid var(--border);
}

.tab {
  padding: 10px 20px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all .15s;
  font-weight: 500;
}

.tab:hover { color: var(--text); }
.tab.active { color: var(--primary); border-bottom-color: var(--primary); }

.tab-content { display: none; }
.tab-content.active { display: block; }

/* Stats */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.stat-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  box-shadow: var(--shadow);
}

.stat-label { font-size: 13px; color: var(--text-muted); margin-bottom: 4px; }
.stat-value { font-size: 28px; font-weight: 700; }
.skeleton { color: var(--border); }

/* Toolbar */
.toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  align-items: center;
}

.toolbar label {
  font-size: 13px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Buttons */
.btn {
  padding: 8px 16px;
  border-radius: var(--radius);
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all .15s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.btn-primary { background: var(--primary); color: #fff; border-color: var(--primary); }
.btn-primary:hover { background: var(--primary-hover); }
.btn-outline { background: var(--surface); color: var(--text); border-color: var(--border); }
.btn-outline:hover { background: var(--bg); }
.btn-danger { background: var(--danger); color: #fff; border-color: var(--danger); }
.btn-danger:hover { background: var(--danger-hover); }
.btn-sm { padding: 4px 10px; font-size: 12px; }

/* Inputs */
.input, .input-sm {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  width: 100%;
  background: var(--surface);
  transition: border-color .15s;
}

.input:focus, .input-sm:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(79,70,229,.1);
}

.input-sm { padding: 6px 10px; font-size: 13px; width: auto; }

/* Table */
.table-container {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow-x: auto;
  box-shadow: var(--shadow);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th, td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

th {
  background: var(--bg);
  font-weight: 600;
  color: var(--text-muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

tr:hover td { background: #f8fafc; }

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

.status-enabled { background: #ecfdf5; color: var(--success); }
.status-disabled { background: #fef2f2; color: var(--danger); }
.status-exceeded { background: #fffbeb; color: var(--warning); }

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.4);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 200;
  animation: fadeIn .15s;
}

.modal {
  background: var(--surface);
  border-radius: 12px;
  padding: 24px;
  width: 90%;
  max-width: 520px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,.15);
  animation: slideUp .2s;
}

.modal-sm { max-width: 400px; }

.modal h3 { margin-bottom: 16px; font-size: 16px; }

.modal label {
  display: block;
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 4px;
  margin-top: 12px;
}

.modal label:first-of-type { margin-top: 0; }

.modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 20px;
  justify-content: flex-end;
}

/* Login overlay */
.login-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 150;
}

.login-container {
  max-width: 400px;
  width: 90%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 32px;
  box-shadow: var(--shadow);
}

.login-container h2 { margin-bottom: 8px; }
.login-container .btn { margin-top: 16px; width: 100%; justify-content: center; }

.text-muted { color: var(--text-muted); font-size: 13px; }
.error-text { color: var(--danger); font-size: 13px; margin-top: 8px; }
.copy-success { color: var(--success); font-size: 12px; margin-left: 8px; }

/* Actions cell */
.actions-cell { display: flex; gap: 4px; flex-wrap: wrap; }

/* Empty State */
.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--text-muted);
  font-size: 14px;
}

/* Key display */
.key-display {
  background: #f0fdf4;
  border: 1px solid #86efac;
  border-radius: var(--radius);
  padding: 16px;
  margin-top: 16px;
}

.key-display code {
  display: block;
  font-size: 14px;
  word-break: break-all;
  margin: 8px 0;
  background: #fff;
  padding: 8px 12px;
  border-radius: 4px;
  border: 1px solid var(--border);
}

.key-warning {
  color: var(--danger);
  font-size: 12px;
  margin-top: 8px;
}

/* Toast */
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 12px 20px;
  border-radius: var(--radius);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  z-index: 300;
  animation: slideUp .2s;
  box-shadow: 0 4px 12px rgba(0,0,0,.15);
}

.toast-success { background: var(--success); }
.toast-error { background: var(--danger); }
.toast-info { background: var(--primary); }

@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes slideUp { from { opacity: 0; transform: translateY(20px) } to { opacity: 1; transform: translateY(0) } }

/* Responsive */
@media (max-width: 768px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .modal { width: 95%; padding: 16px; }
  main { padding: 16px; }
}
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
  document.getElementById("tab-dashboard").classList.add("active");
  updateLoginStatus(true);
  loadDashboard();
}

function updateLoginStatus(online) {
  const el = document.getElementById("loginStatus");
  const btn = document.getElementById("btnLogout");
  if (!el || !btn) return;
  if (online) {
    el.textContent = hasCfAccess ? "Cloudflare Access" : "已连接";
    el.style.color = "var(--success)";
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
  if (name === "dashboard") loadDashboard();
  else if (name === "keys") loadKeys();
}

// ── Dashboard ──
async function loadDashboard() {
  try {
    const { data } = await apiJson("GET", "/api/admin/stats");
    const cards = document.querySelectorAll(".stat-value");
    cards[0].textContent = data.totalKeys;
    cards[1].textContent = data.enabledKeys;
    cards[2].textContent = data.totalRequests;
    cards[3].textContent = data.exceededQuotaKeys;
    cards.forEach(c => c.classList.remove("skeleton"));
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

    return '<tr>' +
      '<td>' + k.id + '</td>' +
      '<td>' + escapeHtml(k.name) + '</td>' +
      '<td>' + statusHtml + '</td>' +
      '<td>' + usageLabel + '</td>' +
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
  const body = { name: form.name.value.trim() };
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
    const status = document.getElementById("logFilterStatus").value;
    const params = new URLSearchParams();
    if (keyId) params.set("api_key_id", keyId);
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
    return '<tr>' +
      '<td>' + l.id + '</td>' +
      '<td>' + l.api_key_id + ' (' + escapeHtml(l.key_name || '-') + ')</td>' +
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
    '<th>ID</th><th>Key</th><th>时间</th><th>模型</th>' +
    '<th>状态</th><th>延迟</th><th>Tokens (P/C/T)</th>' +
    '<th>客户端</th><th>错误</th>' +
  '</tr></thead><tbody>' + rows + '</tbody></table>';
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
    const d = new Date(s);
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
