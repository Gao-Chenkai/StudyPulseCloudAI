/**
 * StudyPulse Cloud AI - 统一鉴权中间件（Session + API Key 双鉴权）
 *
 * 鉴权优先级（Session 用户身份优先）：
 *   1. Authorization: Bearer sp_sess_xxx → Session Token
 *   2. X-API-Key: sp_beta_xxx          → API Key（推荐方式）
 *   3. Authorization: Bearer sp_beta_xxx → API Key（兼容旧版）
 */

import { authenticate } from "../auth.js";
import { validateSession } from "./session.js";

/**
 * 统一鉴权：同时支持 Session Token 和 API Key。
 *
 * 返回格式：
 *   { ok: true, userId: "xxx", authType: "session", sessionId, apiKeyId: null }
 *   { ok: true, userId: "xxx", authType: "api_key", sessionId: null, apiKeyId: 123 }
 *   { ok: false, response: Response }                 — 鉴权失败
 *
 * @param {Request} request
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<{ok: boolean, userId?: string|null, apiKeyId?: number|null, response?: Response}>}
 */
export async function authenticateRequest(request, env) {
	const authHeader = request.headers.get("Authorization");
	const apiKeyHeader = request.headers.get("X-API-Key");

	// ── 第一优先：Authorization: Bearer 是否为 Session Token ──
	if (authHeader) {
		const bearerToken = authHeader.startsWith("Bearer ")
			? authHeader.slice("Bearer ".length).trim()
			: "";

		// Session Token（sp_sess_ 前缀）
		if (bearerToken.startsWith("sp_sess_")) {
			const sessionResult = await validateSession(request, env);
			if (sessionResult.ok) {
				return {
					ok: true,
					userId: sessionResult.userId,
					authType: "session",
					sessionId: sessionResult.sessionId,
					apiKeyId: null,
				};
			}
			// Session 校验失败 → 直接返回错误，不回退到 API Key
			return {
				ok: false,
				response: Response.json(
					{ error: "Invalid or expired session" },
					{ status: 401 },
				),
			};
		}

		// 非 Session Token → 可能是 API Key（第三优先，下面处理）
	}

	// ── 第二优先：X-API-Key header ──
	if (apiKeyHeader) {
		const apiKeyResult = await authenticateByHeader(apiKeyHeader, request, env);
		if (apiKeyResult) return apiKeyResult;
	}

	// ── 第三优先：Authorization: Bearer 作为 API Key（兼容旧版）──
	if (authHeader) {
		const apiKeyResult = await authenticate(request, env);
		if (apiKeyResult.ok) {
			const apiKey = apiKeyResult.apiKey;
			return {
				ok: true,
				userId: apiKey.user_id || null,
				authType: "api_key",
				sessionId: null,
				apiKeyId: apiKey.id,
			};
		}
		return apiKeyResult;
	}

	// ── 未提供任何鉴权信息 ──
	return {
		ok: false,
		response: Response.json(
			{ error: "Missing API Key or Session Token" },
			{ status: 401 },
		),
	};
}

/**
 * 通过 API Key 字符串鉴权（包装 authenticate，适配 X-API-Key header）。
 *
 * @param {string} rawKey - API Key 原始字符串
 * @param {Request} request - 用于构造 fake auth header
 * @param {object} env
 * @returns {Promise<{ok: boolean, userId: string|null, apiKeyId: number}|null>}
 */
async function authenticateByHeader(rawKey, request, env) {
	// 构造一个 fake request 来复用现有 authenticate()
	// authenticate() 需要 Authorization: Bearer <key>
	const fakeRequest = new Request(request.url, {
		headers: {
			...Object.fromEntries(request.headers),
			"Authorization": `Bearer ${rawKey}`,
		},
	});

	const result = await authenticate(fakeRequest, env);

	if (result.ok) {
		return {
			ok: true,
			userId: result.apiKey.user_id || null,
			authType: "api_key",
			sessionId: null,
			apiKeyId: result.apiKey.id,
		};
	}

	// API Key 鉴权失败 → 返回 null（由调用者决定是否回退）
	return null;
}

/** Session-only guard for account-management endpoints. */
export async function requireSessionAuth(request, env) {
	const auth = await authenticateRequest(request, env);
	if (!auth.ok) return auth;
	if (auth.authType !== "session") {
		return {
			ok: false,
			response: Response.json({ success: false, error: { code: "FORBIDDEN", message: "该接口仅支持 Session Token" } }, { status: 403 }),
		};
	}
	return auth;
}
