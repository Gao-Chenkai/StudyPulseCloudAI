/**
 * StudyPulse Cloud AI - API Key 鉴权模块
 *
 * v0.4：在 D1 鉴权基础上增加额度校验。
 *   - 原始 API Key 绝不存储；D1 仅存 SHA-256 哈希
 *   - 校验顺序：Header -> Bearer -> 哈希命中 -> enabled -> 额度
 *   - 额度自增由 src/database/api_keys.js 的 incrementApiKeyUsage 负责，
 *     本函数只做读校验，不写库
 */

// Authorization Header 中 Bearer scheme 前缀
const BEARER_PREFIX = "Bearer ";

/**
 * 计算字符串的 SHA-256 hex 摘要（Web Crypto API，无外部依赖）。
 * @param {string} text
 * @returns {Promise<string>} 64 字符 hex
 */
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

/**
 * 从 Request 中提取并校验 API Key（走 D1）。
 *
 * 校验流程（短路返回，越靠前越省 D1 查询）：
 *   1. Header 不存在            -> 401 Missing API Key
 *   2. 非 Bearer scheme         -> 403 Invalid API Key
 *   3. D1 查 key_hash 未命中     -> 403 Invalid API Key
 *   4. enabled == 0              -> 403 API Key disabled
 *   5. expires_at 已过期          -> 403 API Key expired
 *   6. request_count >= limit    -> 429 API quota exceeded
 *   7. 通过                       -> { ok: true, apiKey }
 *
 * 注意：本函数不递增 request_count。额度自增只在 AI 调用成功后
 *       由 index.js 调用 incrementApiKeyUsage(env, apiKey.id) 完成。
 *
 * @param {Request} request
 * @param {{ StudyPulseDB: D1Database }} env - Worker 环境，必须包含 StudyPulseDB 绑定
 * @returns {Promise<{ ok: true, apiKey: object } | { ok: false, response: Response }>}
 *   - 校验通过：{ ok: true, apiKey }（apiKey 为 D1 记录）
 *   - 校验失败：{ ok: false, response }（response 可直接 return 给客户端）
 */
export async function authenticate(request, env) {
	const authHeader = request.headers.get("Authorization");

	// 1. 检查 Header 是否存在
	if (!authHeader) {
		return {
			ok: false,
			response: Response.json(
				{ error: "Missing API Key" },
				{ status: 401 },
			),
		};
	}

	// 2. 提取 Bearer 后面的 Key
	if (!authHeader.startsWith(BEARER_PREFIX)) {
		return {
			ok: false,
			response: Response.json(
				{ error: "Invalid API Key" },
				{ status: 403 },
			),
		};
	}

	const rawKey = authHeader.slice(BEARER_PREFIX.length).trim();
	if (!rawKey) {
		return {
			ok: false,
			response: Response.json(
				{ error: "Invalid API Key" },
				{ status: 403 },
			),
		};
	}

	// 3. SHA-256 哈希后查 D1（原始 Key 不进 DB，只比较哈希）
	// 此处不在 SQL 里判断 enabled，以便区分「Key 不存在」与「Key 已禁用」
	const keyHash = await sha256Hex(rawKey);

	const apiKey = await env.StudyPulseDB.prepare(
		`SELECT id, name, enabled, request_count, request_limit,
		        limit_type, token_count,
		        user_id, notes, expires_at, created_at, last_used_at
		   FROM api_keys
		  WHERE key_hash = ?`,
	)
		.bind(keyHash)
		.first();

	if (!apiKey) {
		return {
			ok: false,
			response: Response.json(
				{ error: "Invalid API Key" },
				{ status: 403 },
			),
		};
	}

	// 4. enabled == 0 -> 403 API Key disabled
	// D1 中 enabled 是 INTEGER（0/1）；用 !== 1 兼容 null 等异常值
	if (apiKey.enabled !== 1) {
		return {
			ok: false,
			response: Response.json(
				{ error: "API Key disabled" },
				{ status: 403 },
			),
		};
	}

	// 5. 检查 Key 是否已过期
	// expires_at 为 NULL 时永不过期；非 NULL 时比较当前时间
	if (apiKey.expires_at !== null) {
		const now = new Date();
		const expiresAt = new Date(apiKey.expires_at);
		if (now >= expiresAt) {
			return {
				ok: false,
				response: Response.json(
					{ error: "API Key expired" },
					{ status: 403 },
				),
			};
		}
	}

	// 6. 额度校验：按 limit_type 选择对比维度
	// "count"（默认）：对比 request_count；"tokens"：对比 token_count
	// request_limit 为 NULL 时不限量
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

	// 7. 通过。返回完整记录给上层用于记量与日志
	return { ok: true, apiKey };
}
