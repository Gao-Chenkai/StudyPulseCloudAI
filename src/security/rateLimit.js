import { sha256Hex } from "../auth.js";

export const LOGIN_EMAIL_LIMIT = 5;
export const LOGIN_EMAIL_WINDOW_MS = 10 * 60_000;
export const LOGIN_IP_EMAIL_LIMIT = 10;
export const LOGIN_IP_LIMIT = 30;
export const LOGIN_IP_WINDOW_MS = 10 * 60_000;

function nowIso() {
	return new Date().toISOString();
}

function getClientIp(request) {
	return request.headers.get("CF-Connecting-IP")
		|| request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
		|| "unknown";
}

async function keyHash(scope, value) {
	return sha256Hex(`${scope}:${value}`);
}

async function consume(key, scope, limit, windowMs, env) {
	const hash = await keyHash(scope, key);
	const now = Date.now();
	const row = await env.StudyPulseDB.prepare(
		`SELECT window_started_at, attempt_count, blocked_until
		   FROM auth_rate_limits WHERE key_hash = ?`,
	).bind(hash).first();

	if (row?.blocked_until && now < new Date(row.blocked_until).getTime()) {
		return { allowed: false, retryAfterSeconds: Math.ceil((new Date(row.blocked_until).getTime() - now) / 1000) };
	}

	const windowStarted = row?.window_started_at ? new Date(row.window_started_at).getTime() : 0;
	const inWindow = windowStarted > 0 && now - windowStarted < windowMs;
	const count = inWindow ? Number(row.attempt_count || 0) + 1 : 1;
	const startedAt = inWindow ? row.window_started_at : nowIso();
	const blockedUntil = count > limit ? new Date(now + windowMs).toISOString() : null;

	await env.StudyPulseDB.prepare(
		`INSERT INTO auth_rate_limits
			 (key_hash, scope, window_started_at, attempt_count, blocked_until, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(key_hash) DO UPDATE SET
			 window_started_at = excluded.window_started_at,
			 attempt_count = excluded.attempt_count,
			 blocked_until = excluded.blocked_until,
			 updated_at = excluded.updated_at`,
	).bind(hash, scope, startedAt, count, blockedUntil, nowIso()).run();

	return { allowed: !blockedUntil, retryAfterSeconds: blockedUntil ? Math.ceil(windowMs / 1000) : 0 };
}

export async function checkLoginRateLimits(email, request, env) {
	const ip = getClientIp(request);
	const [ipResult, ipEmailResult] = await Promise.all([
		consume(ip, "login-ip", LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS, env),
		consume(`${ip}|${email}`, "login-ip-email", LOGIN_IP_EMAIL_LIMIT, LOGIN_IP_WINDOW_MS, env),
	]);
	if (!ipResult.allowed || !ipEmailResult.allowed) {
		return { allowed: false, retryAfterSeconds: Math.max(ipResult.retryAfterSeconds, ipEmailResult.retryAfterSeconds) };
	}
	return { allowed: true };
}

export async function resetLoginRateLimits(email, request, env) {
	const ip = getClientIp(request);
	const hashes = await Promise.all([
		keyHash("login-ip", ip),
		keyHash("login-ip-email", `${ip}|${email}`),
	]);
	await env.StudyPulseDB.prepare(
		"DELETE FROM auth_rate_limits WHERE key_hash IN (?, ?)",
	).bind(...hashes).run();
}

export function getRequestIp(request) {
	return getClientIp(request);
}
