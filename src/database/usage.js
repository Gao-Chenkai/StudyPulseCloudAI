/**
 * StudyPulse Cloud AI - usage_records 写操作
 *
 * 独立模块，避免 index.js 直接拼 SQL。
 */

/**
 * 写入使用记录（仅在 user_id 存在时调用）。
 *
 * @param {{ StudyPulseDB: D1Database }} env
 * @param {{ user_id: string, api_key_id?: number|null, model?: string, input_tokens?: number, output_tokens?: number, total_tokens?: number }} entry
 * @returns {Promise<void>}
 */
export async function recordUsageRecord(env, entry) {
	await env.StudyPulseDB.prepare(
		`INSERT INTO usage_records
		   (user_id, api_key_id, model, input_tokens, output_tokens, total_tokens)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			entry.user_id,
			entry.api_key_id ?? null,
			entry.model ?? null,
			entry.input_tokens ?? 0,
			entry.output_tokens ?? 0,
			entry.total_tokens ?? 0,
		)
		.run();
}
