/**
 * StudyPulse Cloud AI - 管理后台 API 路由处理
 *
 * 所有管理 API 路径：/api/admin/*
 *
 * 安全措施：
 *   - 所有路由统一校验管理员身份
 *   - 状态变更接口（POST/PUT/DELETE）需要 CSRF Token
 *   - 参数化 D1 查询防止 SQL 注入
 *   - 绝不返回 key_hash
 *   - 安全响应头（CSP、X-Frame-Options、X-Content-Type-Options 等）
 */

import { authenticateAdmin } from "./auth.js";
import {
	getDashboardStats,
	listApiKeys,
	createApiKey,
	updateApiKey,
	deleteApiKey,
	resetQuota,
	getRequestLogs,
} from "./database.js";

// ────────────────────────────────────────────────────────────────────────────
// CSRF 保护
// ────────────────────────────────────────────────────────────────────────────

const CSRF_COOKIE = "admin_csrf";
const CSRF_HEADER = "X-CSRF-Token";

/**
 * 生成 CSRF Token 并设置 Cookie。
 * Cookie: SameSite=Strict, Path=/api/admin, Secure（生产环境）
 */
function generateCsrfToken() {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function setCsrfCookie(headers, token, secure) {
	headers.append(
		"Set-Cookie",
		`${CSRF_COOKIE}=${token}; Path=/api/admin; SameSite=Strict; HttpOnly; Max-Age=3600${secure ? "; Secure" : ""}`,
	);
}

/**
 * 校验 CSRF Token：Cookie 中的值与 X-CSRF-Token header 一致。
 */
function verifyCsrf(request) {
	const cookieHeader = request.headers.get("Cookie") || "";
	const cookies = Object.fromEntries(
		cookieHeader.split(";").map((c) => {
			const [k, ...v] = c.trim().split("=");
			return [k, v.join("=")];
		}),
	);
	const cookieToken = cookies[CSRF_COOKIE];
	const headerToken = request.headers.get(CSRF_HEADER);

	if (!cookieToken || !headerToken) return false;

	// 常量时间比较避免时序攻击
	let result = cookieToken.length ^ headerToken.length;
	for (let i = 0; i < cookieToken.length && i < headerToken.length; i++) {
		result |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i);
	}
	return result === 0;
}

// ────────────────────────────────────────────────────────────────────────────
// 安全响应头
// ────────────────────────────────────────────────────────────────────────────

const SECURITY_HEADERS = {
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"X-XSS-Protection": "1; mode=block",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function applySecurityHeaders(headers) {
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(key, value);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// 辅助函数
// ────────────────────────────────────────────────────────────────────────────

function json(data, status = 200, extraHeaders = {}) {
	const headers = new Headers({ "Content-Type": "application/json" });
	applySecurityHeaders(headers);
	for (const [k, v] of Object.entries(extraHeaders)) {
		headers.set(k, v);
	}
	return new Response(JSON.stringify(data), { status, headers });
}

function error(message, status = 400) {
	return json({ error: message }, status);
}

function unauthorized() {
	return error("Unauthorized", 401);
}

// ────────────────────────────────────────────────────────────────────────────
// 路由表
// ────────────────────────────────────────────────────────────────────────────

/**
 * 管理 API 路由入口。
 *
 * @param {Request} request
 * @param {{ StudyPulseDB: D1Database, ADMIN_API_TOKEN?: string }} env
 * @param {string} pathname - URL pathname
 * @returns {Promise<Response>}
 */
export async function handleAdminApi(request, env, pathname) {
	const method = request.method.toUpperCase();

	// 1. 管理员鉴权
	if (!(await authenticateAdmin(request, env))) {
		return unauthorized();
	}

	// 2. 状态变更操作需要 CSRF 校验
	const stateChanging = ["POST", "PUT", "DELETE"].includes(method);
	if (stateChanging) {
		if (!verifyCsrf(request)) {
			return error("CSRF validation failed", 403);
		}
	}

	// 3. 路由分发
	try {
		switch (true) {
			// GET /api/admin/stats
			case pathname === "/api/admin/stats" && method === "GET":
				return handleStats(env);

			// GET /api/admin/keys
			case pathname === "/api/admin/keys" && method === "GET":
				return handleListKeys(env);

			// POST /api/admin/keys/create
			case pathname === "/api/admin/keys/create" && method === "POST":
				return handleCreateKey(request, env);

			// POST /api/admin/keys/update
			case pathname === "/api/admin/keys/update" && method === "POST":
				return handleUpdateKey(request, env);

			// POST /api/admin/keys/delete
			case pathname === "/api/admin/keys/delete" && method === "POST":
				return handleDeleteKey(request, env);

			// POST /api/admin/keys/reset-quota
			case pathname === "/api/admin/keys/reset-quota" && method === "POST":
				return handleResetQuota(request, env);

			// GET /api/admin/logs
			case pathname === "/api/admin/logs" && method === "GET":
				return handleLogs(request, env);

			default:
				return error("Not Found", 404);
		}
	} catch (err) {
		console.error("[admin] Internal error:", err?.message || err);
		return error("Internal server error", 500);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// 路由处理器
// ────────────────────────────────────────────────────────────────────────────

async function handleStats(env) {
	const stats = await getDashboardStats(env);
	return json({ success: true, data: stats });
}

async function handleListKeys(env) {
	const keys = await listApiKeys(env);
	return json({ success: true, data: keys });
}

async function handleCreateKey(request, env) {
	let body;
	try {
		body = await request.json();
	} catch {
		return error("Invalid JSON body", 400);
	}

	const { name } = body;
	if (!name || typeof name !== "string" || name.trim().length === 0) {
		return error("name is required", 400);
	}

	const params = {
		name: name.trim(),
		request_limit: body.request_limit ? Number(body.request_limit) : null,
		notes: body.notes || null,
		expires_at: body.expires_at || null,
	};

	const result = await createApiKey(env, params);
	return json({
		success: true,
		data: {
			id: result.id,
			rawKey: result.rawKey,
		},
	});
}

async function handleUpdateKey(request, env) {
	let body;
	try {
		body = await request.json();
	} catch {
		return error("Invalid JSON body", 400);
	}

	const { id } = body;
	if (!id || typeof id !== "number") {
		return error("id is required (number)", 400);
	}

	const fields = {};
	if (body.name !== undefined) fields.name = body.name;
	if (body.enabled !== undefined) fields.enabled = body.enabled;
	if (body.request_limit !== undefined) fields.request_limit = body.request_limit === null ? null : Number(body.request_limit);
	if (body.notes !== undefined) fields.notes = body.notes;
	if (body.expires_at !== undefined) fields.expires_at = body.expires_at;

	if (Object.keys(fields).length === 0) {
		return error("no fields to update", 400);
	}

	const updated = await updateApiKey(env, id, fields);
	if (!updated) {
		return error("Key not found", 404);
	}

	return json({ success: true });
}

async function handleDeleteKey(request, env) {
	let body;
	try {
		body = await request.json();
	} catch {
		return error("Invalid JSON body", 400);
	}

	const { id } = body;
	if (!id || typeof id !== "number") {
		return error("id is required (number)", 400);
	}

	const deleted = await deleteApiKey(env, id);
	if (!deleted) {
		return error("Key not found", 404);
	}

	return json({ success: true });
}

async function handleResetQuota(request, env) {
	let body;
	try {
		body = await request.json();
	} catch {
		return error("Invalid JSON body", 400);
	}

	const { id } = body;
	if (!id || typeof id !== "number") {
		return error("id is required (number)", 400);
	}

	const reset = await resetQuota(env, id);
	if (!reset) {
		return error("Key not found", 404);
	}

	return json({ success: true });
}

async function handleLogs(request, env) {
	const url = new URL(request.url);
	const api_key_id = url.searchParams.get("api_key_id");
	const status = url.searchParams.get("status");

	const logs = await getRequestLogs(env, {
		api_key_id: api_key_id ? Number(api_key_id) : undefined,
		status: status ? Number(status) : undefined,
	});

	return json({ success: true, data: logs });
}

// ────────────────────────────────────────────────────────────────────────────
// 导出 CSRF 工具供 UI 页面使用
// ────────────────────────────────────────────────────────────────────────────

export { generateCsrfToken, setCsrfCookie, applySecurityHeaders, json, error };
