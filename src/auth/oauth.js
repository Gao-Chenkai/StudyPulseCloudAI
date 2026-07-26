import { createSessionWithMetadata } from "./session.js";
import { getUserByEmail } from "../users/users.js";
import { sendVerificationCode, consumeVerificationCode } from "./email.js";
import { consumeAuthChallenge, createAuthChallenge, getAuthChallenge } from "./challenges.js";

const GITHUB_CLIENT_ID = "Ov23lilABeGFN4QQdBHu";
const CALLBACK = "https://auth.chenkai.space/oauth/github/callback";
const COOKIE = "github_oauth_state";

function randomToken(prefix) {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return prefix + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function redirect(url, status = 302, headers = {}) {
	return new Response(null, { status, headers: { Location: url, ...headers } });
}

function safeReturnTo(value) {
	return typeof value === "string" && /^studypulse:\/\/auth\/callback(?:\?.*)?$/.test(value)
		? value
		: "studypulse://auth/callback";
}

export function handleGitHubStart(request, env) {
	const url = new URL(request.url);
	const state = randomToken("st_");
	const returnTo = safeReturnTo(url.searchParams.get("return_to"));
	const authUrl = new URL("https://github.com/login/oauth/authorize");
	authUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID || GITHUB_CLIENT_ID);
	authUrl.searchParams.set("redirect_uri", env.GITHUB_CALLBACK_URL || CALLBACK);
	authUrl.searchParams.set("scope", "read:user user:email");
	authUrl.searchParams.set("state", state);
	const cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify({ state, returnTo }))}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`;
	return redirect(authUrl.toString(), 302, { "Set-Cookie": cookie });
}

export async function handleGitHubCallback(request, env) {
	const url = new URL(request.url);
	const state = url.searchParams.get("state");
	const cookie = request.headers.get("Cookie") || "";
	const raw = cookie.match(new RegExp(`${COOKIE}=([^;]+)`))?.[1];
	let stateData;
	try { stateData = JSON.parse(decodeURIComponent(raw || "")); } catch { stateData = null; }
	const returnTo = safeReturnTo(stateData?.returnTo);
	if (!state || !stateData || state !== stateData.state) return redirect(`${returnTo}?error=invalid_state`, 302);
	if (url.searchParams.get("error")) return redirect(`${returnTo}?error=github_denied`, 302);
	if (!env.GITHUB_CLIENT_SECRET) return redirect(`${returnTo}?error=server_not_configured`, 302);

	let tokenResponse;
	try {
		tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
			method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID || GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: url.searchParams.get("code"), redirect_uri: env.GITHUB_CALLBACK_URL || CALLBACK }),
		});
	} catch (error) {
		console.error("GitHub token exchange failed:", error?.message || error);
		return redirect(`${returnTo}?error=github_token_exchange_failed`, 302);
	}
	const token = await tokenResponse.json().catch(() => ({}));
	if (!token.access_token) return redirect(`${returnTo}?error=github_token_exchange_failed`, 302);
	const githubHeaders = { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
	const [profileResponse, emailsResponse] = await Promise.all([
		fetch("https://api.github.com/user", { headers: githubHeaders }),
		fetch("https://api.github.com/user/emails", { headers: githubHeaders }),
	]);
	if (!profileResponse.ok || !emailsResponse.ok) {
		console.error("GitHub user lookup failed:", profileResponse.status, emailsResponse.status);
		return redirect(`${returnTo}?error=github_profile_failed`, 302);
	}
	const profile = await profileResponse.json().catch(() => ({}));
	const emails = await emailsResponse.json().catch(() => []);
	if (!profile.id) return redirect(`${returnTo}?error=github_profile_failed`, 302);
	const primary = Array.isArray(emails) ? emails.find((item) => item.primary && item.verified) || emails.find((item) => item.verified) : null;
	if (!primary?.email) {
		const challenge = await createAuthChallenge(env, {
			kind: "github_email_binding",
			payload: { githubId: String(profile.id), login: profile.login || null, avatarUrl: profile.avatar_url || null, returnTo },
		});
		return redirect(`${new URL(request.url).origin}/oauth/github/bind?challenge=${encodeURIComponent(challenge)}`, 302, {
			"Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
		});
	}
	const email = primary.email.trim().toLowerCase();
	let user = await getUserByEmail(email, env);
	if (!user) {
		const id = crypto.randomUUID();
		await env.StudyPulseDB.prepare(`INSERT OR IGNORE INTO users (id, email, email_normalized, email_verified, role, membership_type, username, avatar_url) VALUES (?, ?, ?, 1, 'user', 'free', ?, ?)`)
			.bind(id, email, email, profile.login || null, profile.avatar_url || null).run();
		user = await getUserByEmail(email, env);
	}
	if (user.status === "banned") return redirect(`${returnTo}?error=account_banned`, 302);
	const existingOAuth = await env.StudyPulseDB.prepare("SELECT user_id FROM user_oauth_accounts WHERE provider = 'github' AND provider_user_id = ?")
		.bind(String(profile.id)).first();
	if (existingOAuth && existingOAuth.user_id !== user.id) return redirect(`${returnTo}?error=github_already_bound`, 302);
	const existingEmailOAuth = await env.StudyPulseDB.prepare("SELECT user_id FROM user_oauth_accounts WHERE provider = 'github' AND provider_email = ?")
		.bind(email).first();
	if (existingEmailOAuth && existingEmailOAuth.user_id !== user.id) return redirect(`${returnTo}?error=github_email_already_bound`, 302);
	await env.StudyPulseDB.prepare(`INSERT INTO user_oauth_accounts (id, user_id, provider, provider_user_id, provider_email, username, avatar_url) VALUES (?, ?, 'github', ?, ?, ?, ?) ON CONFLICT(provider, provider_user_id) DO UPDATE SET user_id = excluded.user_id, provider_email = excluded.provider_email, username = excluded.username, avatar_url = excluded.avatar_url, updated_at = CURRENT_TIMESTAMP`)
		.bind(crypto.randomUUID(), user.id, String(profile.id), email, profile.login || null, profile.avatar_url || null).run();
	const session = await createSessionWithMetadata(user.id, env, { userAgent: request.headers.get("User-Agent") });
	const separator = returnTo.includes("?") ? "&" : "?";
	return redirect(`${returnTo}${separator}access_token=${encodeURIComponent(session.token)}&refresh_token=${encodeURIComponent(session.refreshToken)}`, 302, { "Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax` });
}

function bindPage(message = "") {
	return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>绑定邮箱 · StudyPulse</title><style>body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f8fb;color:#182132;margin:0;min-height:100vh;display:grid;place-items:center}.card{width:min(420px,calc(100% - 32px));padding:32px;border:1px solid #e2e7ef;border-radius:14px;background:#fff;box-shadow:0 14px 35px #1c2b4510}h1{margin:0 0 8px;font-size:24px}p{color:#7d899c}label{display:block;margin:16px 0 6px;font-size:12px;font-weight:600}input,button{width:100%;height:44px;box-sizing:border-box;padding:0 12px;border:1px solid #d9e0e9;border-radius:8px;font:inherit}button{margin-top:18px;border:0;background:#2f6df6;color:white;font-weight:600;cursor:pointer}.code{display:flex;gap:8px}.code button{width:112px;margin-top:0;background:white;color:#3569d4;border:1px solid #d9e0e9}.message{min-height:22px;text-align:center;color:#788599}.error{color:#c2414d}</style><main class="card"><h1>绑定并验证邮箱</h1><p>GitHub 未提供可用的已验证邮箱。请绑定一个邮箱，完成验证后继续登录。</p><form id="form"><input type="hidden" name="challenge" value="${escapeHtml(new URLSearchParams(new URL(message || "https://invalid").search).get("challenge") || "")}"><label>邮箱地址</label><input id="email" name="email" type="email" autocomplete="email" required placeholder="name@example.com"><label>验证码</label><div class="code"><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="6 位验证码"><button id="send" type="button">获取验证码</button></div><button type="submit">完成绑定并登录</button><p id="status" class="message"></p></form></main><script>const form=document.getElementById('form'),status=document.getElementById('status'),challenge=new URLSearchParams(location.search).get('challenge');form.challenge.value=challenge||'';async function call(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),j=await r.json().catch(()=>null);if(!r.ok)throw Error(j?.error?.message||'请求失败');return j}document.getElementById('send').onclick=async()=>{try{await call('/oauth/github/bind/send-code',{challenge,email:document.getElementById('email').value});status.textContent='验证码已发送，请查收邮箱';}catch(e){status.textContent=e.message;status.className='message error'}};form.onsubmit=async e=>{e.preventDefault();try{const j=await call('/oauth/github/bind/verify',Object.fromEntries(new FormData(form)));status.textContent='绑定成功，正在返回…';const u=j.data.return_to,sep=u.includes('?')?'&':'?';location.href=u+sep+'access_token='+encodeURIComponent(j.data.access_token)+'&refresh_token='+encodeURIComponent(j.data.refresh_token)}catch(e){status.textContent=e.message;status.className='message error'}};</script></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'" } });
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

export function renderGitHubBindPage(request) {
	return bindPage(request.url);
}

export async function handleGitHubBindSendCode(request, env) {
	let body;
	try { body = await request.json(); } catch { return Response.json({ success: false, error: { message: "请求参数无效" } }, { status: 400 }); }
	const challenge = await getAuthChallenge(body?.challenge, env, "github_email_binding");
	if (!challenge) return Response.json({ success: false, error: { message: "绑定链接已失效，请重新使用 GitHub 登录" } }, { status: 401 });
	const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
	const result = await sendVerificationCode(email, env, "github_bind");
	if (!result.success) return Response.json({ success: false, error: { message: result.error === "Please wait before requesting a new code" ? "请稍后再试" : "无法发送验证码" } }, { status: 400 });
	return Response.json({ success: true });
}

export async function handleGitHubBindVerify(request, env) {
	let body;
	try { body = await request.json(); } catch { return Response.json({ success: false, error: { message: "请求参数无效" } }, { status: 400 }); }
	const challenge = await getAuthChallenge(body?.challenge, env, "github_email_binding");
	if (!challenge) return Response.json({ success: false, error: { message: "绑定链接已失效，请重新使用 GitHub 登录" } }, { status: 401 });
	const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
	const verified = await consumeVerificationCode(email, body?.code, env, "github_bind");
	if (!verified.success) return Response.json({ success: false, error: { message: "验证码无效或已过期" } }, { status: 400 });
	let user = await getUserByEmail(email, env);
	if (!user) {
		const id = crypto.randomUUID();
		await env.StudyPulseDB.prepare(`INSERT OR IGNORE INTO users (id, email, email_normalized, email_verified, role, membership_type, username, avatar_url) VALUES (?, ?, ?, 1, 'user', 'free', ?, ?)`)
			.bind(id, email, email, challenge.payload?.login || null, challenge.payload?.avatarUrl || null).run();
		user = await getUserByEmail(email, env);
	}
	if (user.status === "banned") return Response.json({ success: false, error: { message: "该账号已被暂停" } }, { status: 403 });
	const existing = await env.StudyPulseDB.prepare("SELECT user_id FROM user_oauth_accounts WHERE provider = 'github' AND provider_user_id = ?").bind(challenge.payload?.githubId || "").first();
	if (existing && existing.user_id !== user.id) return Response.json({ success: false, error: { message: "该 GitHub 已绑定其他账号" } }, { status: 409 });
	if (!(await consumeAuthChallenge(challenge.id, env))) return Response.json({ success: false, error: { message: "绑定链接已失效，请重新开始" } }, { status: 401 });
	await env.StudyPulseDB.prepare(`INSERT INTO user_oauth_accounts (id, user_id, provider, provider_user_id, provider_email, username, avatar_url) VALUES (?, ?, 'github', ?, ?, ?, ?) ON CONFLICT(provider, provider_user_id) DO UPDATE SET user_id = excluded.user_id, provider_email = excluded.provider_email, username = excluded.username, avatar_url = excluded.avatar_url, updated_at = CURRENT_TIMESTAMP`)
		.bind(crypto.randomUUID(), user.id, challenge.payload?.githubId || "", email, challenge.payload?.login || null, challenge.payload?.avatarUrl || null).run();
	const session = await createSessionWithMetadata(user.id, env, { userAgent: request.headers.get("User-Agent") });
	return Response.json({ success: true, data: { access_token: session.token, refresh_token: session.refreshToken, return_to: challenge.payload?.returnTo || "studypulse://auth/callback" } });
}

export function renderLoginPage() {
	return new Response(`<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StudyPulse 登录</title><style>body{font:16px system-ui;max-width:420px;margin:48px auto;padding:0 20px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:6px 0}button{cursor:pointer}a{display:block;text-align:center;margin:18px 0}</style><h1>登录 StudyPulse</h1><form id="password"><input name="email" type="email" placeholder="邮箱" required><input name="password" type="password" placeholder="密码" required><button>邮箱密码登录</button></form><hr><form id="code"><input name="email" type="email" placeholder="邮箱" required><button>发送邮箱验证码</button></form><p id="message">验证码发送后，请使用 App 或 API 调用 /auth/login/code 完成登录。</p><a href="/oauth/github/start">使用 GitHub 登录</a><script>async function submitForm(event,id,path){event.preventDefault();const data=Object.fromEntries(new FormData(document.getElementById(id)));const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});document.getElementById('message').textContent=await response.text()}password.onsubmit=e=>submitForm(e,'password','/auth/login/password');code.onsubmit=e=>submitForm(e,'code','/auth/send-code')</script></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'" } });
}
