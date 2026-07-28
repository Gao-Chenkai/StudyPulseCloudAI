import { authenticateRequest, requireSessionAuth } from "../auth/middleware.js";
import { sendVerificationCode, verifyCode } from "../auth/email.js";
import { createSession } from "../auth/session.js";
import { getUserById } from "../users/users.js";

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function handleSupportSendCode(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const result = await sendVerificationCode(email, env, "login");
  if (!result.success) return json({ error: result.error === "Please wait before requesting a new code" ? "请稍后再试" : result.error === "Email delivery failed" ? "验证码发送失败" : result.error }, result.error === "Please wait before requesting a new code" ? 429 : 400);
  return json({ success: true });
}

export async function handleSupportVerifyCode(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  // verifyCode consumes the code and resolves the existing user (or creates
  // the same account identity as the legacy login flow), returning userId.
  const result = await verifyCode(email, code, env, "login");
  if (!result.success) return json({ error: "验证码无效或已过期" }, 400);
  const session = await createSession(result.userId, env);
  const user = await getUserById(result.userId, env);
  if (user?.status === "banned") return json({ error: "账号已被暂停" }, 403);
  return json({ success: true, data: { token: session.token, user: { id: user.id, email: user.email }, membership_type: user.membership_type } });
}

export async function handleSupportMe(request, env) {
  const auth = await requireSessionAuth(request, env); if (!auth.ok) return auth.response;
  const user = await getUserById(auth.userId, env); if (!user) return json({ error: "用户不存在" }, 404);
  return json({ success: true, data: { id: user.id, email: user.email, membership_type: user.membership_type, membership_expires_at: user.membership_expires_at } });
}

function effectivePlan(user) {
  if (user.membership_type !== "free" && user.membership_expires_at && new Date() >= new Date(user.membership_expires_at)) return "free";
  return user.membership_type;
}

export async function handleListTickets(request, env) {
  const auth = await requireSessionAuth(request, env); if (!auth.ok) return auth.response;
  const user = await getUserById(auth.userId, env); if (!user) return json({ error: "用户不存在" }, 404);
  const result = await env.StudyPulseDB.prepare(`SELECT id,subject,content,priority,status,admin_reply,created_at,processed_at FROM feedback_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`).bind(auth.userId).all();
  return json({ success: true, data: { user: { email: user.email, membership_type: effectivePlan(user) }, tickets: result.results } });
}

export async function handleCreateTicket(request, env) {
  const auth = await requireSessionAuth(request, env); if (!auth.ok) return auth.response;
  const user = await getUserById(auth.userId, env); if (!user) return json({ error: "用户不存在" }, 404);
  if (user.status === "banned") return json({ error: "账号已被暂停" }, 403);
  let body; try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 120) : "";
  const content = typeof body?.content === "string" ? body.content.trim().slice(0, 5000) : "";
  const priority = ["normal", "urgent", "top"].includes(body?.priority) ? body.priority : "normal";
  if (!subject || !content) return json({ error: "请填写主题和反馈内容" }, 400);
  if (priority === "top" && effectivePlan(user) !== "pro") return json({ error: "仅 Pro 用户可以提交顶级工单" }, 403);
  const id = crypto.randomUUID();
  await env.StudyPulseDB.prepare(`INSERT INTO feedback_tickets (id,user_id,subject,content,priority) VALUES (?,?,?,?,?)`).bind(id, auth.userId, subject, content, priority).run();
	return json({ success: true, data: { id } }, 201);
}
