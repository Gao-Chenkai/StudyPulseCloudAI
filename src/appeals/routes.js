import { getAppealByToken, submitAppeal } from "./service.js";

const noStore = { "Cache-Control": "no-store" };

export async function handleAppealStatus(request, env) {
	const token = new URL(request.url).searchParams.get("token")?.trim() || "";
	if (!token) return Response.json({ error: "申诉链接无效：缺少 token" }, { status: 400, headers: noStore });

	const appeal = await getAppealByToken(token, env);
	if (!appeal || appeal.ban_status !== "active") {
		return Response.json({ error: "Appeal link is invalid or expired" }, { status: 404, headers: noStore });
	}

	return Response.json({
		success: true,
		data: {
			email: appeal.email,
			reason: appeal.reason,
			status: appeal.status || null,
			appeal_id: appeal.appeal_id || null,
		},
	}, { headers: noStore });
}

export async function handleSubmitAppeal(request, env) {
	let body;
	try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
	const token = typeof body?.token === "string" ? body.token.trim() : "";
	const content = typeof body?.content === "string" ? body.content.trim() : "";
	if (!token) return Response.json({ error: "申诉链接无效：缺少 token" }, { status: 400 });
	if (!content) return Response.json({ error: "请输入申诉说明" }, { status: 400 });
	const result = await submitAppeal(token, content, env);
	return Response.json(result.success ? result : { error: result.error }, { status: result.success ? 201 : result.status });
}
