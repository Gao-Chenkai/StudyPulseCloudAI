/**
 * StudyPulse Cloud AI - 邮箱验证码
 *
 * 功能：
 *   - sendVerificationCode：生成验证码 → 写 DB → 调用 Resend → 更新状态
 *   - verifyCode：按邮箱查最新记录，比较 code，累计 attempts
 *   - sendEmail：调用 Resend REST API
 */

import { isEmailBlacklisted } from "../admin/database.js";

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
export const VERIFICATION_PURPOSES = new Set(["register", "login", "reset_password", "change_email"]);

export async function sendVerificationCode(rawEmail, env, purpose = "login") {
	// 1. 校验邮箱格式（简单正则）
	const email = rawEmail.trim().toLowerCase();
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return { success: false, error: "Invalid email format" };
	}
	if (!VERIFICATION_PURPOSES.has(purpose)) {
		return { success: false, error: "Invalid verification purpose" };
	}

	// 1.5 检查邮箱是否已被封禁
	if (await isEmailBlacklisted(email, env)) {
		return { success: false, error: "Email is banned" };
	}

	// 2. 1 分钟内不可重复发送
	const recent = await env.StudyPulseDB.prepare(
		`SELECT created_at FROM email_verification_codes
		  WHERE email_normalized = ? AND purpose = ?
		  ORDER BY created_at DESC
		  LIMIT 1`,
	)
		.bind(email, purpose)
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
		`INSERT INTO email_verification_codes
			 (email, email_normalized, code, purpose, used, attempts, delivery_status, expires_at)
		 VALUES (?, ?, ?, ?, 0, 0, 'pending', ?)`,
	)
		.bind(email, email, code, purpose, expiresAt)
		.run();

	// 6. 调用 Resend 发送邮件
	const emailResult = await sendEmail(email, code, env);

	if (emailResult.success) {
		// 发送成功 → 更新状态为 'sent'
		await env.StudyPulseDB.prepare(
			`UPDATE email_verification_codes
			    SET delivery_status = 'sent'
			  WHERE email_normalized = ? AND purpose = ? AND code = ? AND delivery_status = 'pending'`,
		)
			.bind(email, purpose, code)
			.run();

		return { success: true };
	}

	// 发送失败 → 标记失效（delivery_status='failed', used=1）
	console.error("Resend delivery failed for email:", email);
	await env.StudyPulseDB.prepare(
		`UPDATE email_verification_codes
		    SET delivery_status = 'failed', used = 1
		  WHERE email_normalized = ? AND purpose = ? AND code = ? AND delivery_status = 'pending'`,
	)
		.bind(email, purpose, code)
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
export async function consumeVerificationCode(rawEmail, code, env, purpose = "login") {
	const email = rawEmail.trim().toLowerCase();
	if (!VERIFICATION_PURPOSES.has(purpose)) {
		return { success: false, error: "Invalid verification code" };
	}
	const record = await env.StudyPulseDB.prepare(
		`SELECT id, code, used, attempts, delivery_status, expires_at
		   FROM email_verification_codes
		  WHERE email_normalized = ? AND purpose = ?
		  ORDER BY created_at DESC, id DESC
		  LIMIT 1`,
	).bind(email, purpose).first();

	if (!record || record.used === 1 || record.delivery_status === "failed") {
		return { success: false, error: "Invalid verification code" };
	}
	if (record.attempts >= 5) {
		await env.StudyPulseDB.prepare(
			"UPDATE email_verification_codes SET used = 1 WHERE id = ? AND used = 0",
		).bind(record.id).run();
		return { success: false, error: "Verification code locked due to too many attempts" };
	}
	if (Date.now() >= new Date(record.expires_at).getTime()) {
		return { success: false, error: "Verification code expired" };
	}
	if (typeof code !== "string" || record.code !== code) {
		await env.StudyPulseDB.prepare(
			"UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ? AND used = 0",
		).bind(record.id).run();
		return { success: false, error: "Invalid verification code" };
	}

	// The conditional update makes code consumption idempotent under concurrent requests.
	const claimed = await env.StudyPulseDB.prepare(
		"UPDATE email_verification_codes SET used = 1 WHERE id = ? AND used = 0",
	).bind(record.id).run();
	if (!claimed.meta || claimed.meta.changes !== 1) {
		return { success: false, error: "Invalid verification code" };
	}
	return { success: true, email, recordId: record.id, purpose };
}

export async function verifyCode(rawEmail, code, env, purpose = "login") {
	const consumed = await consumeVerificationCode(rawEmail, code, env, purpose);
	if (!consumed.success) return consumed;

	// Login codes retain the original behavior: verify the email and create the
	// same user identity when it does not exist yet.
	const existingUser = await env.StudyPulseDB.prepare(
		"SELECT id, email_verified, status FROM users WHERE email_normalized = ?",
	).bind(consumed.email).first();

	if (existingUser) {
		if (existingUser.status === "banned") return { success: false, error: "Email is banned" };
		if (existingUser.email_verified !== 1) {
			await env.StudyPulseDB.prepare(
				"UPDATE users SET email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
			).bind(existingUser.id).run();
		}
		return { success: true, userId: existingUser.id };
	}

	const userId = crypto.randomUUID();
	await env.StudyPulseDB.prepare(
		`INSERT OR IGNORE INTO users
			 (id, email, email_normalized, email_verified, role, membership_type)
		 VALUES (?, ?, ?, 1, 'user', 'free')`,
	).bind(userId, consumed.email, consumed.email).run();
	const actualUser = await env.StudyPulseDB.prepare(
		"SELECT id FROM users WHERE email_normalized = ?",
	).bind(consumed.email).first();
	return { success: true, userId: actualUser?.id || userId };
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
				from: "StudyPulse <noreply@chenkai.space>",
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
