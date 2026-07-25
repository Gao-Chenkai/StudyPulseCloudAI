/**
 * StudyPulse Cloud AI - Session 管理
 *
 * 功能：
 *   - createSession：生成 sp_sess_ + 64 hex Token，SHA-256 存入 DB
 *   - validateSession：校验 Session Token，检查过期，更新 last_used_at
 *   - destroySession：删除 Session
 */

import { sha256Hex } from "../auth.js";

const SESSION_PREFIX = "sp_sess_";
const SESSION_TTL_DAYS = 30;

// ────────────────────────────────────────────────────────────────────────────
// 创建 Session
// ────────────────────────────────────────────────────────────────────────────

/**
 * 为用户创建新 Session。
 *
 * Token 格式：sp_sess_ + 64 hex（crypto.getRandomValues(32)）
 * 数据库仅存储 SHA-256 哈希，原始 Token 仅返回一次。
 *
 * @param {string} userId - users.id
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<{token: string}>}
 */
export async function createSession(userId, env) {
	// 1. 生成 32 字节随机数据
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);

	// 2. 转换为 hex（64 字符）
	let hex = "";
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i].toString(16).padStart(2, "0");
	}
	const token = SESSION_PREFIX + hex;

	// 3. SHA-256 哈希
	const tokenHash = await sha256Hex(token);

	// 4. 过期时间 = now + 30 天
	const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

	// 5. INSERT
	const sessionId = crypto.randomUUID();
	await env.StudyPulseDB.prepare(
		`INSERT INTO sessions (id, user_id, token_hash, expires_at)
		 VALUES (?, ?, ?, ?)`,
	)
		.bind(sessionId, userId, tokenHash, expiresAt)
		.run();

	// 6. 返回原始 Token（仅此时可见）
	return { token };
}

// ────────────────────────────────────────────────────────────────────────────
// 校验 Session
// ────────────────────────────────────────────────────────────────────────────

/**
 * 从 Request 中校验 Session Token。
 *
 * 从 Authorization: Bearer 提取 Token，检查 sp_sess_ 前缀，
 * SHA-256 后查 sessions 表，验证过期时间，更新 last_used_at。
 *
 * @param {Request} request
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<{ok: boolean, userId?: string, response?: Response}>}
 */
export async function validateSession(request, env) {
	const authHeader = request.headers.get("Authorization");

	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return { ok: false };
	}

	const token = authHeader.slice("Bearer ".length).trim();

	// 检查是否为 Session Token（sp_sess_ 前缀）
	if (!token.startsWith(SESSION_PREFIX)) {
		return { ok: false };
	}

	// SHA-256 后查 DB
	const tokenHash = await sha256Hex(token);

	const session = await env.StudyPulseDB.prepare(
		`SELECT user_id, expires_at
		   FROM sessions
		  WHERE token_hash = ?`,
	)
		.bind(tokenHash)
		.first();

	if (!session) {
		return { ok: false };
	}

	// 检查过期
	const now = new Date();
	const expiresAt = new Date(session.expires_at);
	if (now >= expiresAt) {
		return { ok: false };
	}

	// 更新 last_used_at（异步，不阻塞返回）
	env.StudyPulseDB.prepare(
		`UPDATE sessions
		    SET last_used_at = CURRENT_TIMESTAMP
		  WHERE token_hash = ?`,
	)
		.bind(tokenHash)
		.run()
		.catch(() => {});

	return { ok: true, userId: session.user_id };
}

// ────────────────────────────────────────────────────────────────────────────
// 销毁 Session
// ────────────────────────────────────────────────────────────────────────────

/**
 * 注销当前 Session（退出登录）。
 *
 * @param {Request} request
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<void>}
 */
export async function destroySession(request, env) {
	const authHeader = request.headers.get("Authorization");

	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return;
	}

	const token = authHeader.slice("Bearer ".length).trim();

	if (!token.startsWith(SESSION_PREFIX)) {
		return;
	}

	const tokenHash = await sha256Hex(token);

	await env.StudyPulseDB.prepare(
		"DELETE FROM sessions WHERE token_hash = ?",
	)
		.bind(tokenHash)
		.run();
}
