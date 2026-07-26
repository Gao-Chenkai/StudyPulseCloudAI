/**
 * StudyPulse Cloud AI - Session 管理
 *
 * 功能：
 *   - createSession：生成 sp_sess_ + 64 hex Token，SHA-256 存入 DB
 *   - validateSession：校验 Session Token、用户、撤销和过期状态
 *   - revokeSession/revokeAllSessions：可审计撤销，不删除历史记录
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
	return createSessionWithMetadata(userId, env);
}

/**
 * @param {string} userId
 * @param {{ StudyPulseDB: D1Database }} env
 * @param {{deviceName?: string,userAgent?: string,ipAddress?: string}} [metadata]
 */
export async function createSessionWithMetadata(userId, env, metadata = {}) {
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
		`INSERT INTO sessions
			 (id, user_id, token_hash, expires_at, created_at, device_name, user_agent, ip_address)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			sessionId,
			userId,
			tokenHash,
			expiresAt,
			new Date().toISOString(),
			metadata.deviceName ?? null,
			metadata.userAgent ?? null,
			metadata.ipAddress ?? null,
		)
		.run();

	// 6. 返回原始 Token（仅此时可见）
	return { token, expiresAt, sessionId };
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
 * @returns {Promise<{ok: boolean, userId?: string, sessionId?: string, expiresAt?: string, response?: Response}>}
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
		`SELECT s.id, s.user_id, s.expires_at, s.revoked_at, u.id AS valid_user_id
		   FROM sessions s
		   JOIN users u ON u.id = s.user_id
		  WHERE s.token_hash = ?`,
	)
		.bind(tokenHash)
		.first();

	if (!session || session.revoked_at || !session.valid_user_id) {
		return { ok: false };
	}

	// 检查过期
	const now = new Date();
	const expiresAt = new Date(session.expires_at);
	if (now >= expiresAt) {
		return { ok: false };
	}

	// 更新 last_used_at at most once per five minutes to avoid write amplification.
	env.StudyPulseDB.prepare(
		`UPDATE sessions
		    SET last_used_at = CURRENT_TIMESTAMP
		  WHERE token_hash = ?
		    AND (last_used_at IS NULL OR datetime(last_used_at) <= datetime('now', '-5 minutes'))`,
	)
		.bind(tokenHash)
		.run()
		.catch(() => {});

	return {
		ok: true,
		userId: session.user_id,
		sessionId: session.id,
		expiresAt: session.expires_at,
	};
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
	const session = await findSessionFromRequest(request, env);
	if (session) await revokeSessionById(session.id, env);
}

async function findSessionFromRequest(request, env) {
	const authHeader = request.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) return null;
	const token = authHeader.slice("Bearer ".length).trim();
	if (!token.startsWith(SESSION_PREFIX)) return null;
	const tokenHash = await sha256Hex(token);
	return env.StudyPulseDB.prepare(
		"SELECT id, user_id FROM sessions WHERE token_hash = ?",
	).bind(tokenHash).first();
}

export async function revokeSessionById(sessionId, env) {
	await env.StudyPulseDB.prepare(
		"UPDATE sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE id = ?",
	).bind(sessionId).run();
}

export async function revokeAllSessions(userId, env, exceptSessionId = null) {
	const query = exceptSessionId
		? "UPDATE sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE user_id = ? AND id != ?"
		: "UPDATE sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE user_id = ?";
	const bindings = exceptSessionId ? [userId, exceptSessionId] : [userId];
	await env.StudyPulseDB.prepare(query).bind(...bindings).run();
}

export function extractSessionToken(request) {
	const authHeader = request.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) return null;
	const token = authHeader.slice("Bearer ".length).trim();
	return token.startsWith(SESSION_PREFIX) ? token : null;
}
