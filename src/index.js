/**
 * StudyPulse Cloud AI - Worker 入口
 *
 * v0.5：主机名路由
 *   - admin.chenkai.space  → 管理后台（WebUI + API）
 *   - spapi.chenkai.space  → 公开 AI API（健康检查 + /v1/chat）
 *   - localhost（开发）     → 路径路由（兼容旧行为，全部可访问）
 *
 * 目录结构：
 *   src/
 *    ├── index.js              路由 + 请求处理
 *    ├── auth.js               API Key 鉴权（公开 API）
 *    ├── providers/minimax.js  AI 调用（MiniMax-M3，OpenAI 兼容协议）
 *    ├── database/api_keys.js  额度自增
 *    └── admin/
 *         ├── auth.js          管理员鉴权
 *         ├── database.js      管理后台 D1 操作
 *         ├── routes.js        管理后台 API 路由
 *         └── ui.js            管理后台 WebUI
 */

import { authenticate } from "./auth.js";
import { chat as minimaxChat } from "./providers/minimax.js";
import { incrementApiKeyUsage } from "./database/api_keys.js";
import { handleAdminApi } from "./admin/routes.js";
import { serveAdminPage } from "./admin/ui.js";
import { writeRequestLog } from "./admin/database.js";

// 服务元信息
const SERVICE_META = {
	service: "StudyPulse Cloud AI",
	version: "0.5-beta",
};

// 生产环境自定义域名
const SPAPI_HOSTNAME = "spapi.chenkai.space";
const ADMIN_HOSTNAME = "admin.chenkai.space";

/**
 * Worker 默认导出（Cloudflare Workers 标准格式）
 */
export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const { pathname } = url;
		const method = request.method.toUpperCase();
		const hostname = url.hostname;

		// ── 管理后台子域名：仅 admin.chenkai.space ──
		if (hostname === ADMIN_HOSTNAME) {
			return handleAdmin(request, env, ctx, pathname, method);
		}

		// ── 公开 API 子域名：仅 spapi.chenkai.space ──
		if (hostname === SPAPI_HOSTNAME) {
			return handlePublicApi(request, env, ctx, pathname, method);
		}

		// ── 本地开发 & Workers.dev 调试：路径路由（兼容全部功能）──
		if (
			hostname === "localhost" ||
			hostname.startsWith("127.0.0.1") ||
			hostname.endsWith(".workers.dev")
		) {
			if (
				pathname.startsWith("/api/admin/") ||
				pathname.startsWith("/admin")
			) {
				return handleAdmin(request, env, ctx, pathname, method);
			}
			return handlePublicApi(request, env, ctx, pathname, method);
		}

		// ── 未知主机名 → 404 ──
		return Response.json({ error: "Not Found" }, { status: 404 });
	},
};

// ────────────────────────────────────────────────────────────────────────────
// 管理后台路由（仅 admin.chenkai.space 可访问）
// ────────────────────────────────────────────────────────────────────────────

function handleAdmin(request, env, ctx, pathname, method) {
	// 管理后台 WebUI
	if ((pathname === "/admin" || pathname === "/admin/") && method === "GET") {
		return serveAdminPage(request, env);
	}

	// 管理后台 API
	if (pathname.startsWith("/api/admin/")) {
		return handleAdminApi(request, env, pathname);
	}

	return Response.json({ error: "Not Found" }, { status: 404 });
}

// ────────────────────────────────────────────────────────────────────────────
// 公开 API 路由（仅 spapi.chenkai.space 可访问）
// ────────────────────────────────────────────────────────────────────────────

function handlePublicApi(request, env, ctx, pathname, method) {
	// 健康检查
	if (pathname === "/" && method === "GET") {
		return handleHealth();
	}

	// AI 聊天接口
	if (pathname === "/v1/chat" && method === "POST") {
		return handleChat(request, env, ctx);
	}

	// 其余路径（包括 /admin）→ 404
	return Response.json({ error: "Not Found" }, { status: 404 });
}

// ────────────────────────────────────────────────────────────────────────────
// 健康检查
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET / 健康检查
 */
function handleHealth() {
	return Response.json({
		success: true,
		...SERVICE_META,
		status: "online",
	});
}

// ────────────────────────────────────────────────────────────────────────────
// POST /v1/chat
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /v1/chat
 *
 * 流程：鉴权 -> 校验 Secret -> 解析 Body -> 调用 MiniMax -> 计次 -> 写日志 -> 返回回复
 *
 * Body 支持两种形态（多模态向后兼容）：
 *   1. 纯文本：      { "message": "你好" }
 *   2. 多模态数组：  { "content": [...] }
 *   同时存在时 content 优先；两者都缺则视为空文本。
 *
 * 错误码：
 *   400  Invalid JSON Body        Body 非合法 JSON
 *   401  Missing API Key          未带 Authorization
 *   403  Invalid API Key          Key 无效 / Key 已禁用
 *   429  API quota exceeded       请求次数已达上限
 *   500  Server not configured    未配置 MINIMAX_API_KEY
 *   502  AI request failed        上游 AI 调用失败
 *
 * 额度规则：仅在 MiniMax 调用成功后才自增 request_count。
 *           鉴权失败、上游失败、内部错误一律不计次。
 * 日志规则：成功或失败都写 request_logs（通过 ctx.waitUntil 异步不阻塞响应）。
 */
async function handleChat(request, env, ctx) {
	const startTime = Date.now();
	const clientIp = request.headers.get("CF-Connecting-IP") || "";
	const clientUa = request.headers.get("User-Agent") || "";

	// 1. API Key 鉴权（含 enabled 与额度校验，详见 src/auth.js）
	const auth = await authenticate(request, env);
	if (!auth.ok) {
		return auth.response;
	}
	const { apiKey } = auth;

	// 2. 校验 Worker Secret 是否已注入
	if (!env || !env.MINIMAX_API_KEY) {
		return Response.json(
			{ error: "Server not configured: MINIMAX_API_KEY missing" },
			{ status: 500 },
		);
	}

	// 3. 解析 Body
	let body;
	try {
		body = await request.json();
	} catch {
		return Response.json(
			{ error: "Invalid JSON Body" },
			{ status: 400 },
		);
	}

	// 4. 组装 user 消息：多模态 content 数组优先，其次纯文本 message
	let userContent;
	if (Array.isArray(body?.content)) {
		userContent = body.content;
	} else {
		userContent =
			typeof body?.message === "string" ? body.message : "";
	}

	const messages = [{ role: "user", content: userContent }];

	// 5. 调用 AI Provider
	let reply;
	const model = "MiniMax-M3";
	const provider = "minimax";

	try {
		reply = await minimaxChat(messages, env);
	} catch (err) {
		// 上游 AI 调用失败 -> 502
		// 错误细节输出到 stderr，响应体只返回通用提示
		console.error("AI provider error:", err?.message || err);

		// 异步写失败日志（不阻塞响应）
		const latency = Date.now() - startTime;
		ctx.waitUntil(
			writeRequestLog(env, {
				api_key_id: apiKey.id,
				model,
				provider,
				status: 502,
				latency_ms: latency,
				ip: clientIp,
				user_agent: clientUa,
				error_message: (err?.message || "Unknown error").slice(0, 500),
			}).catch((e) => console.error("Failed to write error log:", e?.message || e)),
		);

		return Response.json(
			{ error: "AI request failed" },
			{ status: 502 },
		);
	}

	// 6. 上游成功，自增额度计数并刷新 last_used_at
	try {
		await incrementApiKeyUsage(env, apiKey.id);
	} catch (err) {
		console.error("Failed to increment API key usage:", err?.message || err);
	}

	// 7. 异步写成功日志（不阻塞响应）
	const latency = Date.now() - startTime;
	ctx.waitUntil(
		writeRequestLog(env, {
			api_key_id: apiKey.id,
			model,
			provider,
			status: 200,
			latency_ms: latency,
			ip: clientIp,
			user_agent: clientUa,
		}).catch((e) => console.error("Failed to write request log:", e?.message || e)),
	);

	// 8. 返回模型回复
	return Response.json({
		success: true,
		data: {
			reply,
		},
	});
}
