function escapeHtml(value) {
	return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

const shell = (content) => `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:40px 20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px"><tr><td style="font-size:32px;font-weight:700;padding-bottom:56px;letter-spacing:-1.5px">StudyPulse Cloud AI</td></tr>${content}<tr><td style="padding-top:48px;font-size:16px;line-height:1.6;color:#444">此致<br>StudyPulse Cloud AI Team</td></tr></table></td></tr></table></body></html>`;

export function banNotificationEmail({ email, reason, appealUrl }) {
	return shell(`<tr><td style="font-size:24px;font-weight:600;padding-bottom:24px">账号访问权限已暂停</td></tr><tr><td style="font-size:16px;line-height:1.6;color:#444">您好，<br><br>您的 StudyPulse Cloud AI 账号访问权限已暂停。<br><br>账号：${escapeHtml(email)}<br><br>您的账号已被暂停，因为近期活动违反了我们的服务条款和使用政策。</td></tr><tr><td style="padding-top:28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:#f5f5f7;border-radius:12px;padding:20px;font-size:16px;line-height:1.6;color:#444"><strong>封禁原因：</strong><br>${escapeHtml(reason)}</td></tr></table></td></tr><tr><td style="font-size:16px;line-height:1.6;color:#444;padding-top:28px">如果您认为此次处理存在错误，可以提交申诉。</td></tr><tr><td style="padding-top:24px"><a href="${escapeHtml(appealUrl)}" style="display:inline-block;background:#10a37f;color:#fff;padding:14px 28px;border-radius:8px;font-weight:600;text-decoration:none">发起申诉</a></td></tr><tr><td style="padding-top:22px;font-size:13px;line-height:1.5;color:#777;word-break:break-all">申诉地址：${escapeHtml(appealUrl)}</td></tr>`);
}

export function appealResultEmail({ approved, reply }) {
	if (!approved) {
		return shell(`<tr><td style="font-size:16px;line-height:1.8;color:#444">您好，<br><br>感谢您就停用您的帐户访问权限的决定提出上诉。在仔细审核您的帐户后，我们坚持停用您的访问权限的决定。我们将不再考虑其他上诉请求。<br><br>谢谢您的理解。<br><br>此致<br>StudyPulse Cloud AI 团队${reply ? `<br><br>审核回复：${escapeHtml(reply)}` : ""}</td></tr><tr><td style="padding-top:32px;font-size:14px;line-height:1.6;color:#777">如果您有任何问题，请通过我们的帮助中心联系我们。</td></tr>`);
	}
	return shell(`<tr><td style="font-size:24px;font-weight:600;padding-bottom:24px">申诉审核结果</td></tr><tr><td style="font-size:16px;line-height:1.6;color:#444">您好，<br><br>您的账号封禁申诉已审核，结果为：<strong>通过</strong>。您的账号访问权限已恢复。${reply ? `<br><br>审核回复：${escapeHtml(reply)}` : ""}</td></tr>`);
}

export function accountDeletionEmail({ email }) {
	return shell(`<tr><td style="font-size:24px;font-weight:600;padding-bottom:24px">账户删除申请已通过</td></tr><tr><td style="font-size:16px;line-height:1.6;color:#444">您好，<br><br>您的账户删除申请已经通过，账户已经删除。<br><br>账号：${escapeHtml(email)}<br><br>与该账户关联的登录会话、API Key 及账户数据已一并删除。</td></tr>`);
}

export function contributionResultEmail({ approved, membership, expiresAt, reply }) {
	const membershipLabel = membership === "pro" ? "Pro" : "Plus";
	return shell(`<tr><td style="font-size:24px;font-weight:600;padding-bottom:24px">代码贡献审核结果</td></tr><tr><td style="font-size:16px;line-height:1.6;color:#444">您好，<br><br>您提交的代码贡献已完成审核，结果为：<strong>${approved ? "通过" : "未通过"}</strong>。${approved ? `<br><br>感谢您的贡献，我们已为您的账号发放 <strong>${membershipLabel}</strong> 会员，当前有效期至：${escapeHtml(expiresAt ? new Date(expiresAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-")}。` : "<br><br>本次贡献暂未满足审核要求，您可以补充更完整的贡献链接后再次提交。"}${reply ? `<br><br>审核回复：${escapeHtml(reply)}` : ""}</td></tr>`);
}
