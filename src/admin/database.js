/**
 * StudyPulse Cloud AI - 管理后台数据库操作
 *
 * 所有对 D1 的查询集中在这里，使用参数化查询（prepared statements）。
 * 管理后台绝对不返回 key_hash 字段，防止哈希泄露。
 */

import { sha256Hex } from "../auth.js";

// ────────────────────────────────────────────────────────────────────────────
// 仪表盘统计
// ────────────────────────────────────────────────────────────────────────────

/**
 * 获取仪表盘统计数据。
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<{totalKeys: number, enabledKeys: number, totalRequests: number, exceededQuotaKeys: number}>}
 */
export async function getDashboardStats(env) {
	const db = env.StudyPulseDB;

	const [totalKeys, enabledKeys, totalRequests, exceededQuotaKeys] =
		await Promise.all([
			db
				.prepare("SELECT COUNT(*) AS count FROM api_keys")
				.first("count"),
			db
				.prepare("SELECT COUNT(*) AS count FROM api_keys WHERE enabled = 1")
				.first("count"),
			db
				.prepare("SELECT COALESCE(SUM(request_count), 0) AS count FROM api_keys")
				.first("count"),
			db
				.prepare(
					"SELECT COUNT(*) AS count FROM api_keys WHERE request_limit IS NOT NULL AND ((limit_type = 'tokens' AND token_count >= request_limit) OR ((limit_type IS NULL OR limit_type = 'count') AND request_count >= request_limit))",
				)
				.first("count"),
		]);

	return {
		totalKeys,
		enabledKeys,
		totalRequests,
		exceededQuotaKeys,
	};
}

// ────────────────────────────────────────────────────────────────────────────
// API Key 管理
// ────────────────────────────────────────────────────────────────────────────

/**
 * 列出所有 API Key（不含 key_hash）。
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<Array>}
 */
export async function listApiKeys(env) {
	const { results } = await env.StudyPulseDB.prepare(
		`SELECT id, name, enabled, request_count, request_limit,
		        limit_type, token_count,
		        user_id, notes, expires_at, created_at, last_used_at
		   FROM api_keys
		  ORDER BY created_at DESC`,
	).all();

	return results;
}

/**
 * 创建新的 API Key。
 * 生成 sp_beta_ 前缀的随机 key，仅存 SHA-256 哈希到 D1。
 * 返回的 rawKey 仅在创建时展示一次。
 *
 * @param {{ StudyPulseDB: D1Database }} env
 * @param {{ name: string, limit_type?: string, request_limit?: number|null, notes?: string, expires_at?: string }} params
 * @returns {Promise<{id: number, rawKey: string}>}
 */
export async function createApiKey(env, params) {
	const { name, limit_type, request_limit, notes, expires_at } = params;

	// 生成 sp_beta_ + 16 位随机 hex
	const rawKey = "sp_beta_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
	const hash = await sha256Hex(rawKey);

	const result = await env.StudyPulseDB.prepare(
		`INSERT INTO api_keys (key_hash, name, enabled, request_count, request_limit, limit_type, notes, expires_at)
		 VALUES (?, ?, 1, 0, ?, ?, ?, ?)
		 RETURNING id`,
	)
		.bind(hash, name, request_limit ?? null, limit_type || "count", notes ?? null, expires_at ?? null)
		.first("id");

	return { id: result, rawKey };
}

/**
 * 更新 API Key（不允许修改 key_hash、request_count、created_at）。
 * @param {{ StudyPulseDB: D1Database }} env
 * @param {number} id - API Key ID
 * @param {{ name?: string, enabled?: number, limit_type?: string, request_limit?: number|null, notes?: string|null, expires_at?: string|null }} fields
 * @returns {Promise<boolean>} true = 更新成功，false = 记录不存在
 */
export async function updateApiKey(env, id, fields) {
	// 构建动态 SET 子句（参数化查询）
	const setClauses = [];
	const bindings = [];

	if (fields.name !== undefined) {
		setClauses.push("name = ?");
		bindings.push(fields.name);
	}
	if (fields.enabled !== undefined) {
		setClauses.push("enabled = ?");
		bindings.push(fields.enabled ? 1 : 0);
	}
	if (fields.request_limit !== undefined) {
		setClauses.push("request_limit = ?");
		bindings.push(fields.request_limit);
	}
	if (fields.limit_type !== undefined) {
		setClauses.push("limit_type = ?");
		bindings.push(fields.limit_type);
	}
	if (fields.notes !== undefined) {
		setClauses.push("notes = ?");
		bindings.push(fields.notes);
	}
	if (fields.expires_at !== undefined) {
		setClauses.push("expires_at = ?");
		bindings.push(fields.expires_at);
	}

	if (setClauses.length === 0) return false;

	bindings.push(id);

	const { meta } = await env.StudyPulseDB.prepare(
		`UPDATE api_keys SET ${setClauses.join(", ")} WHERE id = ?`,
	)
		.bind(...bindings)
		.run();

	return meta.changes > 0;
}

/**
 * 删除 API Key 及关联的 request_logs（CASCADE）。
 * @param {{ StudyPulseDB: D1Database }} env
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function deleteApiKey(env, id) {
	const { meta } = await env.StudyPulseDB.prepare(
		"DELETE FROM api_keys WHERE id = ?",
	)
		.bind(id)
		.run();

	return meta.changes > 0;
}

/**
 * 重置 API Key 的请求计数为 0。
 * @param {{ StudyPulseDB: D1Database }} env
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function resetQuota(env, id) {
	const { meta } = await env.StudyPulseDB.prepare(
		"UPDATE api_keys SET request_count = 0, token_count = 0 WHERE id = ?",
	)
		.bind(id)
		.run();

	return meta.changes > 0;
}

// ────────────────────────────────────────────────────────────────────────────
// 请求日志
// ────────────────────────────────────────────────────────────────────────────

/**
 * 查询请求日志（最近 200 条，按时间倒序）。
 * 支持按 api_key_id 和 status 筛选。
 * 不返回 prompt/reply 内容 —— 日志表本身就不存这些字段。
 *
 * @param {{ StudyPulseDB: D1Database }} env
 * @param {{ api_key_id?: number, status?: number }} filters
 * @returns {Promise<Array>}
 */
export async function getRequestLogs(env, filters = {}) {
	const conditions = [];
	const bindings = [];

	if (filters.api_key_id) {
		conditions.push("rl.api_key_id = ?");
		bindings.push(filters.api_key_id);
	}
	if (filters.status !== undefined && filters.status !== null && filters.status !== "") {
		conditions.push("rl.status = ?");
		bindings.push(Number(filters.status));
	}

	const where = conditions.length > 0
		? `WHERE ${conditions.join(" AND ")}`
		: "";

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
	)
		.bind(...bindings)
		.all();

	return results;
}

/**
 * 写入请求日志。
 * 仅在 AI 调用完成后调用（成功或失败都写）。
 *
 * @param {{ StudyPulseDB: D1Database }} env
 * @param {object} entry
 * @param {number} entry.api_key_id
 * @param {string} entry.model
 * @param {string} entry.provider
 * @param {number} entry.status
 * @param {number} [entry.latency_ms]
 * @param {number} [entry.prompt_tokens]
 * @param {number} [entry.completion_tokens]
 * @param {number} [entry.total_tokens]
 * @param {string} [entry.ip]
 * @param {string} [entry.user_agent]
 * @param {string} [entry.error_message]
 * @returns {Promise<void>}
 */
export async function writeRequestLog(env, entry) {
	await env.StudyPulseDB.prepare(
		`INSERT INTO request_logs
		   (api_key_id, model, provider, status, latency_ms,
		    prompt_tokens, completion_tokens, total_tokens,
		    ip, user_agent, error_message)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			entry.api_key_id,
			entry.model ?? null,
			entry.provider ?? null,
			entry.status,
			entry.latency_ms ?? null,
			entry.prompt_tokens ?? null,
			entry.completion_tokens ?? null,
			entry.total_tokens ?? null,
			entry.ip ?? null,
			entry.user_agent ?? null,
			entry.error_message ?? null,
		)
		.run();
}
