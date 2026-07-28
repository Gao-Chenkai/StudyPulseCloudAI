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
	if (typeof value === "string" && /^studypulse:\/\/auth\/callback(?:\?.*)?$/.test(value)) return value;
	try {
		const url = new URL(value);
		if (url.protocol === "https:" && url.hostname === "dash.studypulse.chenkai.space") {
			return url.pathname === "/" ? `${url.origin}/dashboard` : url.pathname.startsWith("/dashboard") ? value : "studypulse://auth/callback";
		}
	} catch { /* invalid return URL */ }
	return "studypulse://auth/callback";
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
	const githubHeaders = {
		Authorization: `Bearer ${token.access_token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "StudyPulse-Cloud-AI",
	};
	let profileResponse;
	let emailsResponse;
	try {
		[profileResponse, emailsResponse] = await Promise.all([
			fetch("https://api.github.com/user", { headers: githubHeaders }),
			fetch("https://api.github.com/user/emails", { headers: githubHeaders }),
		]);
	} catch (error) {
		console.error("GitHub user lookup request failed:", error?.message || error);
		return redirect(`${returnTo}?error=github_profile_failed`, 302);
	}
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
