/**
 * StudyPulse Cloud AI - 邮箱验证码
 *
 * 功能：
 *   - sendVerificationCode：生成验证码 → 写 DB → 调用 Resend → 更新状态
 *   - verifyCode：按邮箱查最新记录，比较 code，累计 attempts
 *   - sendEmail：调用 Resend REST API
 */

// ────────────────────────────────────────────────────────────────────────────
// 发送验证码
// ────────────────────────────────────────────────────────────────────────────

/**
 * 发送邮箱验证码。
 *
 * 流程：校验格式 → 检查频率 → 生成验证码 → INSERT DB(pending) → Resend → UPDATE 状态
 *
 * @param {string} rawEmail - 原始邮箱
 * @param {{ StudyPulseDB: D1Database, RESEND_API_KEY?: string }} env
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendVerificationCode(rawEmail, env) {
	// 1. 校验邮箱格式（简单正则）
	const email = rawEmail.trim().toLowerCase();
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return { success: false, error: "Invalid email format" };
	}

	// 2. 1 分钟内不可重复发送
	const recent = await env.StudyPulseDB.prepare(
		`SELECT created_at FROM email_verification_codes
		  WHERE email = ?
		  ORDER BY created_at DESC
		  LIMIT 1`,
	)
		.bind(email)
		.first();

	if (recent) {
		const elapsed = Date.now() - new Date(recent.created_at + "Z").getTime();
		if (elapsed < 60_000) {
			return { success: false, error: "Please wait before requesting a new code" };
		}
	}

	// 3. 生成 6 位随机数字验证码
	const codeBytes = new Uint8Array(3);
	crypto.getRandomValues(codeBytes);
	const code = String(
		((codeBytes[0] << 16) | (codeBytes[1] << 8) | codeBytes[2]) % 1_000_000,
	).padStart(6, "0");

	// 4. 过期时间 = now + 10 分钟（ISO 8601）
	const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

	// 5. INSERT：delivery_status='pending'
	await env.StudyPulseDB.prepare(
		`INSERT INTO email_verification_codes (email, code, used, attempts, delivery_status, expires_at)
		 VALUES (?, ?, 0, 0, 'pending', ?)`,
	)
		.bind(email, code, expiresAt)
		.run();

	// 6. 调用 Resend 发送邮件
	const emailResult = await sendEmail(email, code, env);

	if (emailResult.success) {
		// 发送成功 → 更新状态为 'sent'
		await env.StudyPulseDB.prepare(
			`UPDATE email_verification_codes
			    SET delivery_status = 'sent'
			  WHERE email = ? AND code = ? AND delivery_status = 'pending'`,
		)
			.bind(email, code)
			.run();

		return { success: true };
	}

	// 发送失败 → 标记失效（delivery_status='failed', used=1）
	console.error("Resend delivery failed for email:", email);
	await env.StudyPulseDB.prepare(
		`UPDATE email_verification_codes
		    SET delivery_status = 'failed', used = 1
		  WHERE email = ? AND code = ? AND delivery_status = 'pending'`,
	)
		.bind(email, code)
		.run();

	return { success: false, error: "Email delivery failed" };
}

// ────────────────────────────────────────────────────────────────────────────
// 校验验证码
// ────────────────────────────────────────────────────────────────────────────

/**
 * 校验邮箱验证码并完成登录/注册。
 *
 * 流程：按邮箱查最新记录 → 检查状态 → 比较 code → 累计 attempts → 查找/创建用户 → 返回 userId
 *
 * @param {string} rawEmail
 * @param {string} code
 * @param {{ StudyPulseDB: D1Database }} env
 * @returns {Promise<{success: boolean, error?: string, userId?: string}>}
 */
export async function verifyCode(rawEmail, code, env) {
	const email = rawEmail.trim().toLowerCase();

	// 1. 按邮箱查最新一条记录（不按 code 筛选，否则错误验证码无法累计 attempts）
	const record = await env.StudyPulseDB.prepare(
		`SELECT id, code, used, attempts, delivery_status, expires_at
		   FROM email_verification_codes
		  WHERE email = ?
		  ORDER BY created_at DESC
		  LIMIT 1`,
	)
		.bind(email)
		.first();

	// 2. 未找到记录
	if (!record) {
		console.error("verifyCode: no record found for email:", email);
		return { success: false, error: "Invalid verification code" };
	}

	// 3. 已使用
	if (record.used === 1) {
		console.error("verifyCode: code already used for email:", email);
		return { success: false, error: "Verification code already used" };
	}

	// 4. 错误次数过多
	if (record.attempts >= 5) {
		// 标记失效
		await env.StudyPulseDB.prepare(
			"UPDATE email_verification_codes SET used = 1 WHERE id = ?",
		)
			.bind(record.id)
			.run();
		console.error("verifyCode: code locked for email:", email, "attempts:", record.attempts);
		return { success: false, error: "Verification code locked due to too many attempts" };
	}

	// 5. 已过期
	const now = new Date();
	const expiresAt = new Date(record.expires_at);
	if (now >= expiresAt) {
		console.error("verifyCode: code expired for email:", email);
		return { success: false, error: "Verification code expired" };
	}

	// 6. code 不匹配 → attempts + 1
	if (record.code !== code) {
		await env.StudyPulseDB.prepare(
			"UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?",
		)
			.bind(record.id)
			.run();
		console.error("verifyCode: invalid code for email:", email, "attempts:", record.attempts + 1);
		return { success: false, error: "Invalid verification code" };
	}

	// 7. code 匹配 → 标记已使用
	await env.StudyPulseDB.prepare(
		"UPDATE email_verification_codes SET used = 1 WHERE id = ?",
	)
		.bind(record.id)
		.run();

	// 8. 查 users 表
	const existingUser = await env.StudyPulseDB.prepare(
		"SELECT id, email_verified FROM users WHERE email = ?",
	)
		.bind(email)
		.first();

	if (existingUser) {
		// 8a. 用户存在 → 更新 email_verified
		if (existingUser.email_verified !== 1) {
			await env.StudyPulseDB.prepare(
				"UPDATE users SET email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
			)
				.bind(existingUser.id)
				.run();
		}
		return { success: true, userId: existingUser.id };
	}

	// 8b. 用户不存在 → 创建新用户
	const userId = crypto.randomUUID();
	await env.StudyPulseDB.prepare(
		`INSERT INTO users (id, email, email_verified, role, membership_type)
		 VALUES (?, ?, 1, 'user', 'free')`,
	)
		.bind(userId, email)
		.run();

	return { success: true, userId };
}

// ────────────────────────────────────────────────────────────────────────────
// Resend 邮件发送
// ────────────────────────────────────────────────────────────────────────────

/**
 * 通过 Resend REST API 发送验证码邮件。
 * 仅通过 REST API + Cloudflare Secret 实现，不使用 Cloudflare Email Routing。
 *
 * @param {string} email
 * @param {string} code
 * @param {{ RESEND_API_KEY?: string }} env
 * @returns {Promise<{success: boolean}>}
 */
async function sendEmail(email, code, env) {
	if (!env.RESEND_API_KEY) {
		console.error("RESEND_API_KEY not configured");
		return { success: false };
	}

	try {
		const response = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${env.RESEND_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: "StudyPulse <onboarding@resend.dev>",
				to: email,
				subject: "StudyPulse Verification Code",
				html: `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 10 minutes.</p>`,
			}),
		});

		if (!response.ok) {
			const text = await response.text();
			console.error("Resend API error:", response.status, text);
			return { success: false };
		}

		return { success: true };
	} catch (err) {
		console.error("Resend fetch error:", err?.message || err);
		return { success: false };
	}
}
