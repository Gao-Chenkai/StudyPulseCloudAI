/**
 * StudyPulse Cloud AI - api_keys 表的写操作
 *
 * 把所有对 api_keys 表的 D1 写操作集中到这里，保持 index.js / auth.js
 * 只负责业务流程，不直接拼 SQL。
 *
 * 当前只有一个写操作：额度自增（仅在 AI 调用成功后触发）。
 */

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
