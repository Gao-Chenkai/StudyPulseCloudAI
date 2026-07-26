import { requireSessionAuth } from "../auth/middleware.js";
import { getMembershipPlan } from "../membership/membership.js";
import { getUserById } from "../users/users.js";

const TIME_ZONE = "Asia/Shanghai";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

function periodStarts(now = new Date()) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: TIME_ZONE }));
  local.setHours(0, 0, 0, 0);
  return { today: local.toISOString(), month: new Date(local.getFullYear(), local.getMonth(), 1).toISOString() };
}

function effectivePlan(user) {
  if (user.membership_type !== "free" && user.membership_expires_at && Date.now() >= new Date(user.membership_expires_at).getTime()) return "free";
  return user.membership_type || "free";
}

export async function handleUserDashboardApi(request, env, pathname) {
  if (pathname !== "/api/user/dashboard" || request.method.toUpperCase() !== "GET") return json({ error: "Not Found" }, 404);
  const auth = await requireSessionAuth(request, env);
  if (!auth.ok) return auth.response;
  const user = await getUserById(auth.userId, env);
  if (!user) return json({ error: "User not found" }, 404);
  if (user.status === "banned") return json({ error: "Account banned" }, 403);

  const starts = periodStarts();
  const planId = effectivePlan(user);
  const plan = await getMembershipPlan(planId, env);
  const [today, month, recent] = await Promise.all([
    env.StudyPulseDB.prepare(`SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(total_tokens),0) AS tokens FROM usage_records WHERE user_id = ? AND created_at >= ?`).bind(user.id, starts.today).first(),
    env.StudyPulseDB.prepare(`SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(total_tokens),0) AS tokens FROM usage_records WHERE user_id = ? AND created_at >= ?`).bind(user.id, starts.month).first(),
    env.StudyPulseDB.prepare(`SELECT id, model, status, prompt_tokens AS input_tokens, completion_tokens AS output_tokens, total_tokens AS tokens, request_time AS created_at FROM request_logs WHERE user_id = ? ORDER BY request_time DESC LIMIT 8`).bind(user.id).all(),
  ]);

  return json({ success: true, data: {
    user: { id: user.id, email: user.email, username: user.username, avatar: user.avatar_url, created_at: user.created_at, status: user.status || "active", email_verified: !!user.email_verified },
    subscription: { plan: plan?.name || planId.toUpperCase(), type: user.membership_type || "free", effective_type: planId, status: planId === "free" && user.membership_type !== "free" ? "expired" : "active", expire_time: user.membership_expires_at, auto_renew: false, daily_request_limit: plan?.daily_request_limit ?? null, monthly_token_limit: plan?.monthly_token_limit ?? null },
    usage: { today: { requests: Number(today?.requests || 0), input_tokens: Number(today?.input_tokens || 0), output_tokens: Number(today?.output_tokens || 0), tokens: Number(today?.tokens || 0) }, month: { requests: Number(month?.requests || 0), input_tokens: Number(month?.input_tokens || 0), output_tokens: Number(month?.output_tokens || 0), tokens: Number(month?.tokens || 0) } },
    recent_calls: recent.results || [],
  } });
}
