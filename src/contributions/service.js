import { sendTransactionalEmail } from "../appeals/service.js";
import { contributionResultEmail } from "../email/templates.js";

const VALID_TYPES = new Set(["fork", "issue", "pull_request", "other"]);

export async function createContribution(userId, input, env) {

	const user = await env.StudyPulseDB.prepare("SELECT id,email,status FROM users WHERE id = ?").bind(userId).first();
	if (!user) return { success: false, error: "User not found", status: 404 };
	if (user.status === "banned") return { success: false, error: "Account banned", status: 403 };
	const url = typeof input?.contribution_url === "string" ? input.contribution_url.trim() : "";
	const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
	const type = VALID_TYPES.has(input?.contribution_type) ? input.contribution_type : "other";
	const description = typeof input?.description === "string" ? input.description.trim().slice(0, 2000) : "";
	if (!/^https?:\/\/[^\s]+$/i.test(url)) return { success: false, error: "请输入有效的贡献 URL", status: 400 };
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, error: "请输入有效的邮箱地址", status: 400 };
	if (email !== String(user.email || "").trim().toLowerCase()) return { success: false, error: "邮箱必须与当前账号一致", status: 400 };
	const pending = await env.StudyPulseDB.prepare("SELECT id FROM contribution_tickets WHERE user_id = ? AND status = 'pending' LIMIT 1").bind(userId).first();
	if (pending) return { success: false, error: "您已有一条待审核贡献，请等待处理", status: 409 };
	const id = crypto.randomUUID();
	await env.StudyPulseDB.prepare(`INSERT INTO contribution_tickets (id,user_id,email,contribution_url,contribution_type,description) VALUES (?,?,?,?,?,?)`).bind(id, userId, email, url.slice(0, 2048), type, description || null).run();
	return { success: true, id };
}

export async function reviewContribution(id, decision, membership, durationDays, reply, env) {
	const ticket = await env.StudyPulseDB.prepare("SELECT c.*,u.email AS user_email FROM contribution_tickets c JOIN users u ON u.id=c.user_id WHERE c.id = ?").bind(id).first();
	if (!ticket) return { success: false, error: "Contribution not found", status: 404 };
	if (ticket.status !== "pending") return { success: false, error: "Contribution already reviewed", status: 409 };
	if (!["approved", "rejected"].includes(decision)) return { success: false, error: "Invalid decision", status: 400 };
	if (decision === "approved" && !["plus", "pro"].includes(membership)) return { success: false, error: "请选择 Plus 或 Pro 会员", status: 400 };
	const days = Math.min(3650, Math.max(1, Number(durationDays) || 30));
	const expiresAt = decision === "approved" ? new Date(Date.now() + days * 86400000).toISOString() : null;
	const normalizedReply = typeof reply === "string" ? reply.trim().slice(0, 5000) : "";
	await env.StudyPulseDB.prepare(`UPDATE contribution_tickets SET status=?,awarded_membership=?,membership_expires_at=?,admin_reply=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`).bind(decision, decision === "approved" ? membership : null, expiresAt, normalizedReply || null, id).run();
	if (decision === "approved") {
		await env.StudyPulseDB.prepare("UPDATE users SET membership_type=?, membership_expires_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(membership, expiresAt, ticket.user_id).run();
	}
	const email = await sendTransactionalEmail({
		to: ticket.user_email,
		subject: `[StudyPulse Cloud AI] 代码贡献审核结果：${decision === "approved" ? "已通过" : "未通过"}`,
		html: contributionResultEmail({ approved: decision === "approved", membership, expiresAt, reply: normalizedReply }),
	}, env);
	return { success: true, status: decision, membership: decision === "approved" ? membership : null, expiresAt, emailSent: email.success, emailError: email.success ? null : email.error };
}
