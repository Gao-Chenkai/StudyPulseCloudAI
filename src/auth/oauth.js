import { createSessionWithMetadata } from "./session.js";
import { getUserByEmail } from "../users/users.js";

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

	const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID || GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: url.searchParams.get("code"), redirect_uri: env.GITHUB_CALLBACK_URL || CALLBACK }),
	});
	const token = await tokenResponse.json();
	if (!token.access_token) return redirect(`${returnTo}?error=github_token_exchange_failed`, 302);
	const githubHeaders = { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
	const [profileResponse, emailsResponse] = await Promise.all([
		fetch("https://api.github.com/user", { headers: githubHeaders }),
		fetch("https://api.github.com/user/emails", { headers: githubHeaders }),
	]);
	const profile = await profileResponse.json();
	const emails = await emailsResponse.json();
	const primary = Array.isArray(emails) ? emails.find((item) => item.primary && item.verified) || emails.find((item) => item.verified) : null;
	if (!primary?.email) return redirect(`${returnTo}?error=github_email_required`, 302);
	const email = primary.email.trim().toLowerCase();
	let user = await getUserByEmail(email, env);
	if (!user) {
		const id = crypto.randomUUID();
		await env.StudyPulseDB.prepare(`INSERT INTO users (id, email, email_normalized, email_verified, role, membership_type, username, avatar_url) VALUES (?, ?, ?, 1, 'user', 'free', ?, ?)`)
			.bind(id, email, email, profile.login || null, profile.avatar_url || null).run();
		user = await getUserByEmail(email, env);
	}
	if (user.status === "banned") return redirect(`${returnTo}?error=account_banned`, 302);
	await env.StudyPulseDB.prepare(`INSERT INTO user_oauth_accounts (id, user_id, provider, provider_user_id, provider_email, username, avatar_url) VALUES (?, ?, 'github', ?, ?, ?, ?) ON CONFLICT(provider, provider_user_id) DO UPDATE SET user_id = excluded.user_id, provider_email = excluded.provider_email, username = excluded.username, avatar_url = excluded.avatar_url, updated_at = CURRENT_TIMESTAMP`)
		.bind(crypto.randomUUID(), user.id, String(profile.id), email, profile.login || null, profile.avatar_url || null).run();
	const session = await createSessionWithMetadata(user.id, env, { userAgent: request.headers.get("User-Agent") });
	const separator = returnTo.includes("?") ? "&" : "?";
	return redirect(`${returnTo}${separator}access_token=${encodeURIComponent(session.token)}&refresh_token=${encodeURIComponent(session.refreshToken)}`, 302, { "Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax` });
}

export function renderLoginPage() {
	return new Response(`<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StudyPulse 登录</title><style>body{font:16px system-ui;max-width:420px;margin:48px auto;padding:0 20px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:6px 0}button{cursor:pointer}a{display:block;text-align:center;margin:18px 0}</style><h1>登录 StudyPulse</h1><form id="password"><input name="email" type="email" placeholder="邮箱" required><input name="password" type="password" placeholder="密码" required><button>邮箱密码登录</button></form><hr><form id="code"><input name="email" type="email" placeholder="邮箱" required><button>发送邮箱验证码</button></form><p id="message">验证码发送后，请使用 App 或 API 调用 /auth/login/code 完成登录。</p><a href="/oauth/github/start">使用 GitHub 登录</a><script>async function submitForm(event,id,path){event.preventDefault();const data=Object.fromEntries(new FormData(document.getElementById(id)));const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});document.getElementById('message').textContent=await response.text()}password.onsubmit=e=>submitForm(e,'password','/auth/login/password');code.onsubmit=e=>submitForm(e,'code','/auth/send-code')</script></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'" } });
}
