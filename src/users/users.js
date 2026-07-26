/**
 * StudyPulse Cloud AI - 用户操作（D1）
 *
 * 所有对 users 表的查询操作，使用 Prepared Statements。
 * 管理操作写 admin_logs 在调用层实现。
 */

// ────────────────────────────────────────────────────────────────────────────
// 查询
// ────────────────────────────────────────────────────────────────────────────

/**
 * 按 ID 查询用户。
 * @param {string} userId
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<object|null>}
 */
export async function getUserById(userId, env) {
	return env.StudyPulseDB.prepare(
		`SELECT id, email, email_verified, role, membership_type,
		        membership_expires_at, github_id, username, avatar_url,
		        created_at, updated_at
		   FROM users
		  WHERE id = ?`,
	)
		.bind(userId)
		.first();
}

/**
 * 按邮箱查询用户。
 * @param {string} email
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<object|null>}
 */
export async function getUserByEmail(email, env) {
	return env.StudyPulseDB.prepare(
		`SELECT id, email, email_verified, role, membership_type,
		        membership_expires_at, github_id, username, avatar_url,
		        created_at, updated_at
		   FROM users
		  WHERE email_normalized = ?`,
	)
		.bind(email.trim().toLowerCase())
		.first();
}

// ────────────────────────────────────────────────────────────────────────────
// 列表查询（管理后台）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 列出所有用户，支持筛选和搜索。
 *
 * @param {{ StudyPulseDB: D1Database }} env
 * @param {{ search?: string, role?: string, membership_type?: string }} filters
 * @returns {Promise<Array>}
 */
export async function listAllUsers(env, filters = {}) {
	const conditions = [];
	const bindings = [];

	if (filters.search) {
		conditions.push("email LIKE ?");
		bindings.push(`%${filters.search}%`);
	}
	if (filters.role) {
		conditions.push("role = ?");
		bindings.push(filters.role);
	}
	if (filters.membership_type) {
		conditions.push("membership_type = ?");
		bindings.push(filters.membership_type);
	}

	const where = conditions.length > 0
		? `WHERE ${conditions.join(" AND ")}`
		: "";

	const { results } = await env.StudyPulseDB.prepare(
		`SELECT id, email, email_verified, role, membership_type,
		        membership_expires_at, created_at
		   FROM users
		   ${where}
		  ORDER BY created_at DESC
		  LIMIT 200`,
	)
		.bind(...bindings)
		.all();

	return results;
}

// ────────────────────────────────────────────────────────────────────────────
// 更新
// ────────────────────────────────────────────────────────────────────────────

/**
 * 更新用户角色。
 * @param {string} userId
 * @param {string} newRole - 'admin' | 'user'
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<boolean>}
 */
export async function updateUserRole(userId, newRole, env) {
	const { meta } = await env.StudyPulseDB.prepare(
		`UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
	)
		.bind(newRole, userId)
		.run();

	return meta.changes > 0;
}

/**
 * 更新用户会员等级和到期时间。
 * @param {string} userId
 * @param {string} membershipType - 'free' | 'plus' | 'pro'
 * @param {string|null} expiresAt - ISO 8601 或 null
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<boolean>}
 */
export async function updateUserMembership(userId, membershipType, expiresAt, env) {
	const { meta } = await env.StudyPulseDB.prepare(
		`UPDATE users
		    SET membership_type = ?,
		        membership_expires_at = ?,
		        updated_at = CURRENT_TIMESTAMP
		  WHERE id = ?`,
	)
		.bind(membershipType, expiresAt ?? null, userId)
		.run();

	return meta.changes > 0;
}

// ────────────────────────────────────────────────────────────────────────────
// 用户统计
// ────────────────────────────────────────────────────────────────────────────

/**
 * 获取用户关联数据统计。
 * @param {string} userId
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<{totalRequests: number, totalTokens: number, apiKeysCount: number}>}
 */
export async function getUserStats(userId, env) {
	const [totalRequests, totalTokens, apiKeysCount] = await Promise.all([
		env.StudyPulseDB.prepare(
			"SELECT COUNT(*) AS count FROM usage_records WHERE user_id = ?",
		)
			.bind(userId)
			.first("count"),
		env.StudyPulseDB.prepare(
			"SELECT COALESCE(SUM(total_tokens), 0) AS count FROM usage_records WHERE user_id = ?",
		)
			.bind(userId)
			.first("count"),
		env.StudyPulseDB.prepare(
			"SELECT COUNT(*) AS count FROM api_keys WHERE user_id = ?",
		)
			.bind(userId)
			.first("count"),
	]);

	return {
		totalRequests: totalRequests ?? 0,
		totalTokens: totalTokens ?? 0,
		apiKeysCount: apiKeysCount ?? 0,
	};
}

/**
 * 获取用户的 Session 列表。
 * @param {string} userId
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<Array>}
 */
export async function getUserSessions(userId, env) {
	const { results } = await env.StudyPulseDB.prepare(
		`SELECT id, user_id, expires_at, last_used_at, created_at
		   FROM sessions
		  WHERE user_id = ?
		  ORDER BY created_at DESC`,
	)
		.bind(userId)
		.all();

	return results;
}

/**
 * 获取用户的 API Key 列表（不含 key_hash）。
 * @param {string} userId
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<Array>}
 */
export async function getUserApiKeys(userId, env) {
	const { results } = await env.StudyPulseDB.prepare(
		`SELECT id, name, enabled, request_count, request_limit,
		        limit_type, token_count,
		        user_id, notes, expires_at, created_at, last_used_at
		   FROM api_keys
		  WHERE user_id = ?
		  ORDER BY created_at DESC`,
	)
		.bind(userId)
		.all();

	return results;
}
