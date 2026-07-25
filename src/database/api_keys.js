/**
 * StudyPulse Cloud AI - api_keys 表的写操作
 *
 * 把所有对 api_keys 表的 D1 写操作集中到这里，保持 index.js / auth.js
 * 只负责业务流程，不直接拼 SQL。
 */

import { sha256Hex } from "../auth.js";

// ────────────────────────────────────────────────────────────────────────────
// 额度自增
// ────────────────────────────────────────────────────────────────────────────

/**
 * 自增 API Key 的请求计数和 Token 计数，并刷新最后使用时间。
 *
 * 仅在 MiniMax 调用成功后才调用此函数；
 * 鉴权失败、上游失败、内部错误时一律不调用，避免误扣额度。
 *
 * 单条 UPDATE 原子完成，避免并发计数丢失。
 *
 * @param {{ StudyPulseDB: D1Database }} env - Worker 环境
 * @param {number} apiKeyId - api_keys.id
 * @param {number} [tokenUsage] - 本次请求消耗的 total_tokens。非流式从 usage 获取，流式从 SSE 提取，缺则不计
 * @returns {Promise<void>}
 */
export async function incrementApiKeyUsage(env, apiKeyId, tokenUsage) {
	const tokenCountSQL = tokenUsage != null
		? ", token_count = token_count + ?"
		: "";

	const bindings = [apiKeyId];
	if (tokenUsage != null) {
		bindings.unshift(tokenUsage); // tokenUsage 在 SQL 中是第二个 ?，先 push
	}

	await env.StudyPulseDB.prepare(
		`UPDATE api_keys
		    SET request_count = request_count + 1${tokenCountSQL},
		        last_used_at = CURRENT_TIMESTAMP
		  WHERE id = ?`,
	)
		.bind(...bindings)
		.run();
}

// ────────────────────────────────────────────────────────────────────────────
// 创建 API Key（管理后台）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 创建新的 API Key。
 *
 * 新 Key 必须绑定 user_id。生成 sp_beta_ 前缀的随机 key，仅存 SHA-256 哈希到 D1。
 * 返回的 rawKey 仅在创建时展示一次。
 *
 * @param {{ StudyPulseDB: D1Database }} env
 * @param {{ name: string, user_id: string, limit_type?: string, request_limit?: number|null, notes?: string, expires_at?: string }} params
 * @returns {Promise<{id: number, rawKey: string}>}
 */
export async function createApiKey(env, params) {
	const { name, user_id, limit_type, request_limit, notes, expires_at } = params;

	// 生成 sp_beta_ + 16 位随机 hex
	const rawKey = "sp_beta_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
	const hash = await sha256Hex(rawKey);

	const result = await env.StudyPulseDB.prepare(
		`INSERT INTO api_keys (key_hash, name, enabled, request_count, request_limit, limit_type, user_id, notes, expires_at)
		 VALUES (?, ?, 1, 0, ?, ?, ?, ?, ?)
		 RETURNING id`,
	)
		.bind(hash, name, request_limit ?? null, limit_type || "count", user_id, notes ?? null, expires_at ?? null)
		.first("id");

	return { id: result, rawKey };
}
