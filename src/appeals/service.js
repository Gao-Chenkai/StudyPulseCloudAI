import { banNotificationEmail, appealResultEmail } from "../email/templates.js";

const APPEAL_ORIGIN = "https://support.chenkai.space";

function token() {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return "BAN_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sendTransactionalEmail({ to, subject, html }, env) {
	if (!env.RESEND_API_KEY) return { success: false, error: "RESEND_API_KEY not configured" };
	try {
		const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: "StudyPulse Cloud AI <noreply@chenkai.space>", to, subject, html }) });
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 500);
			console.error("Transactional email rejected by Resend", response.status, detail);
			return { success: false, error: `Resend ${response.status}: ${detail}` };
		}
		return { success: true };
	} catch (error) {
		console.error("Transactional email request failed", error?.message || error);
		return { success: false, error: error?.message || "delivery failed" };
	}
}

export async function createBan(userId, reason, env) {
	const user = await env.StudyPulseDB.prepare("SELECT id,email FROM users WHERE id = ?").bind(userId).first();
	if (!user) return { success: false, error: "User not found" };
	const banId = crypto.randomUUID();
	const appealToken = token();
	await env.StudyPulseDB.prepare("UPDATE users SET status = 'banned', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(userId).run();
	await env.StudyPulseDB.prepare("UPDATE bans SET status = 'cancelled' WHERE user_id = ? AND status = 'active'").bind(userId).run();
	await env.StudyPulseDB.prepare("INSERT INTO bans (id,user_id,reason,appeal_token,status) VALUES (?,?,?,?,'active')").bind(banId, userId, reason, appealToken).run();
	const appealUrl = `${APPEAL_ORIGIN}/appeal/${appealToken}`;
	const email = await sendTransactionalEmail({ to: user.email, subject: "[StudyPulse Cloud AI] 您的账号访问权限已暂停", html: banNotificationEmail({ email: user.email, reason, appealUrl }) }, env);
	return { success: true, banId, appealToken, emailSent: email.success, emailError: email.success ? null : email.error };
}

export async function getAppealByToken(tokenValue, env) {
	return env.StudyPulseDB.prepare(`SELECT b.id AS ban_id,b.user_id,b.reason,b.status AS ban_status,b.appeal_token,u.email,a.id AS appeal_id,a.content,a.status,a.created_at,a.reviewed_at,a.admin_reply FROM bans b JOIN users u ON u.id=b.user_id LEFT JOIN appeals a ON a.ban_id=b.id WHERE b.appeal_token = ? ORDER BY a.created_at DESC LIMIT 1`).bind(tokenValue).first();
}

export async function submitAppeal(tokenValue, content, env) {
	const ban = await env.StudyPulseDB.prepare("SELECT id,user_id,status FROM bans WHERE appeal_token = ?").bind(tokenValue).first();
	if (!ban || ban.status !== "active") return { success: false, error: "Appeal link is invalid or expired", status: 404 };
	const existing = await env.StudyPulseDB.prepare("SELECT id FROM appeals WHERE ban_id = ? AND status = 'pending'").bind(ban.id).first();
	if (existing) return { success: false, error: "An appeal is already pending", status: 409 };
	const id = crypto.randomUUID();
	await env.StudyPulseDB.prepare("INSERT INTO appeals (id,ban_id,user_id,content) VALUES (?,?,?,?)").bind(id, ban.id, ban.user_id, content.trim()).run();
	return { success: true, id };
}

export async function reviewAppeal(appealId, decision, reply, env) {
	const appeal = await env.StudyPulseDB.prepare("SELECT a.id,a.user_id,a.ban_id,u.email FROM appeals a JOIN users u ON u.id=a.user_id WHERE a.id = ?").bind(appealId).first();
	if (!appeal) return { success: false, error: "Appeal not found", status: 404 };
	const status = decision === "approved" ? "approved" : "rejected";
	const now = new Date().toISOString();
	await env.StudyPulseDB.prepare("UPDATE appeals SET status=?, reviewed_at=?, admin_reply=? WHERE id=? AND status='pending'").bind(status, now, reply?.trim() || null, appealId).run();
	if (status === "approved") {
		await env.StudyPulseDB.prepare("UPDATE users SET status='active', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(appeal.user_id).run();
		await env.StudyPulseDB.prepare("UPDATE bans SET status='cancelled' WHERE id=?").bind(appeal.ban_id).run();
		// blacklist API 使用的旧兼容表也必须同步清理，否则管理后台仍会显示该账号被封禁。
		await env.StudyPulseDB.prepare("DELETE FROM blacklisted_emails WHERE email = (SELECT email FROM users WHERE id = ?)").bind(appeal.user_id).run();
	}
	const email = await sendTransactionalEmail({ to: appeal.email, subject: `[StudyPulse Cloud AI] 申诉审核结果：${status === "approved" ? "通过" : "拒绝"}`, html: appealResultEmail({ approved: status === "approved", reply }) }, env);
	return { success: true, status, emailSent: email.success, emailError: email.success ? null : email.error };
}
