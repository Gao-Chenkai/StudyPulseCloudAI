import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { sha256Hex } from "../auth.js";
import { getUserById } from "../users/users.js";
import { checkLoginRateLimits, getRequestIp, resetLoginRateLimits } from "../security/rateLimit.js";
import { requireSessionAuth } from "./middleware.js";
import { createSessionWithMetadata } from "./session.js";
import { createAuthChallenge, getAuthChallenge } from "./challenges.js";

const PASSKEY_RP_NAME = "StudyPulse";
const PASSKEY_RP_ID = "chenkai.space";
const PASSKEY_REGISTER_KIND = "passkey_registration";
const PASSKEY_LOGIN_KIND = "passkey_authentication";
const PASSKEY_CHALLENGE_TTL_MS = 5 * 60_000;
const PASSKEY_MAX_BODY_BYTES = 128 * 1024;
const PASSKEY_ALLOWED_PRODUCTION_ORIGINS = [
	"https://auth.chenkai.space",
	"https://dash.studypulse.chenkai.space",
	"https://spapi.chenkai.space",
];

function ok(data = {}) {
	return Response.json({ success: true, data });
}

function fail(code, message, status = 400) {
	return Response.json({ success: false, error: { code, message } }, { status });
}

function rateLimited(rate) {
	const response = fail("RATE_LIMITED", "请求过于频繁，请稍后再试", 429);
	response.headers.set("Retry-After", String(rate.retryAfterSeconds || 30));
	return response;
}

function passkeyRate(request, env) {
	return checkLoginRateLimits("passkey", request, env);
}

function normalizeName(value) {
	if (typeof value !== "string") return "Passkey";
	const name = value.trim().slice(0, 80);
	return name || "Passkey";
}

function toBase64Url(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
	if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
		throw new Error("Invalid base64url value");
	}
	const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseTransports(value) {
	if (!value) return undefined;
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function serializeTransports(value) {
	return Array.isArray(value) && value.length > 0 ? JSON.stringify(value.slice(0, 8)) : null;
}

function passkeyMetadata(row) {
	return {
		id: row.credential_id,
		name: row.name,
		device_type: row.device_type,
		backed_up: !!row.backed_up,
		created_at: row.created_at,
		last_used_at: row.last_used_at,
	};
}

function allowedOrigins(env) {
	const configured = typeof env.PASSKEY_ALLOWED_ORIGINS === "string"
		? env.PASSKEY_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)
		: [];
	return configured.length > 0 ? configured : PASSKEY_ALLOWED_PRODUCTION_ORIGINS;
}

function passkeyConfig(request, env) {
	const url = new URL(request.url);
	let origin = request.headers.get("Origin") || url.origin;
	try {
		origin = new URL(origin).origin;
	} catch {
		throw new Error("Invalid passkey origin");
	}

	const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
	const origins = isLocal ? [url.origin] : allowedOrigins(env);
	if (!isLocal && origins.some((value) => {
		try {
			return new URL(value).protocol !== "https:" || new URL(value).origin !== value;
		} catch {
			return true;
		}
	})) throw new Error("Passkey production origins must be explicit HTTPS origins");
	if (!origins.includes(origin)) throw new Error("Origin is not allowed for passkey operations");

	const configuredRpId = typeof env.PASSKEY_RP_ID === "string" && env.PASSKEY_RP_ID.trim()
		? env.PASSKEY_RP_ID.trim().toLowerCase()
		: null;
	const rpID = configuredRpId || (isLocal ? url.hostname : PASSKEY_RP_ID);
	if (!/^[a-z0-9.-]+$/.test(rpID)) throw new Error("Invalid passkey RP ID");
	return { origin, rpID };
}

function configError(request, env) {
	try {
		return { config: passkeyConfig(request, env) };
	} catch {
		return { response: fail("INVALID_ORIGIN", "当前来源不支持 Passkey", 403) };
	}
}

async function readJson(request, { allowEmpty = false } = {}) {
	const contentLength = Number(request.headers.get("Content-Length"));
	if (Number.isFinite(contentLength) && contentLength > PASSKEY_MAX_BODY_BYTES) {
		return { error: fail("REQUEST_TOO_LARGE", "Passkey 请求体过大", 413) };
	}
	try {
		const bytes = new Uint8Array(await request.arrayBuffer());
		if (bytes.byteLength > PASSKEY_MAX_BODY_BYTES) {
			return { error: fail("REQUEST_TOO_LARGE", "Passkey 请求体过大", 413) };
		}
		if (bytes.byteLength === 0 && allowEmpty) return { body: {} };
		return { body: JSON.parse(new TextDecoder().decode(bytes)) };
	} catch {
		return { error: fail("INVALID_REQUEST", "请求体必须是有效 JSON") };
	}
}

async function sessionContext(request, env) {
	const auth = await requireSessionAuth(request, env);
	if (!auth.ok) return { response: auth.response };
	const user = await getUserById(auth.userId, env);
	if (!user) return { response: fail("UNAUTHORIZED", "用户不存在", 401) };
	if (user.status === "banned") return { response: fail("ACCOUNT_BANNED", "该账号已被暂停", 403) };
	return { auth, user };
}

function sessionPayload(session, user) {
	return {
		access_token: session.token,
		refresh_token: session.refreshToken,
		session_token: session.token,
		token: session.token,
		expires_at: session.expiresAt,
		refresh_expires_at: session.refreshExpiresAt,
		user: { id: user.id, email: user.email },
	};
}

async function sessionMetadata(request, deviceName) {
	return {
		deviceName: normalizeName(deviceName),
		userAgent: request.headers.get("User-Agent")?.slice(0, 500) || null,
		ipAddress: await sha256Hex(getRequestIp(request)),
	};
}

export async function handlePasskeyRegistrationOptions(request, env) {
	const parsed = await readJson(request, { allowEmpty: true });
	if (parsed.error) return parsed.error;
	const context = await sessionContext(request, env);
	if (context.response) return context.response;
	const rate = await passkeyRate(request, env);
	if (!rate.allowed) return rateLimited(rate);
	const origin = configError(request, env);
	if (origin.response) return origin.response;

	const existing = await env.StudyPulseDB.prepare(
		"SELECT credential_id, transports FROM user_passkeys WHERE user_id = ? ORDER BY created_at ASC",
	).bind(context.user.id).all();
	const options = await generateRegistrationOptions({
		rpName: PASSKEY_RP_NAME,
		rpID: origin.config.rpID,
		userName: context.user.email,
		userID: new TextEncoder().encode(context.user.id),
		userDisplayName: (context.user.username || context.user.email).slice(0, 64),
		attestationType: "none",
		timeout: 60_000,
		excludeCredentials: (existing.results || []).map((row) => ({
			id: row.credential_id,
			transports: parseTransports(row.transports),
		})),
		authenticatorSelection: {
			residentKey: "required",
			requireResidentKey: true,
			userVerification: "required",
		},
	});
	const challengeToken = await createAuthChallenge(env, {
		kind: PASSKEY_REGISTER_KIND,
		userId: context.user.id,
		payload: { challenge: options.challenge, name: normalizeName(parsed.body?.name) },
		ttlMs: PASSKEY_CHALLENGE_TTL_MS,
	});
	return ok({ challenge_token: challengeToken, public_key: options });
}

export async function handlePasskeyRegistrationVerify(request, env) {
	const parsed = await readJson(request);
	if (parsed.error) return parsed.error;
	const context = await sessionContext(request, env);
	if (context.response) return context.response;
	const rate = await passkeyRate(request, env);
	if (!rate.allowed) return rateLimited(rate);
	const origin = configError(request, env);
	if (origin.response) return origin.response;
	const challenge = await getAuthChallenge(parsed.body?.challenge_token, env, PASSKEY_REGISTER_KIND);
	const response = parsed.body?.response;
	if (!challenge || challenge.user_id !== context.user.id || !response || typeof response !== "object") {
		return fail("AUTH_CHALLENGE_EXPIRED", "Passkey 注册挑战已失效，请重试", 401);
	}

	let verification;
	try {
		verification = await verifyRegistrationResponse({
			response,
			expectedChallenge: challenge.payload?.challenge || "",
			expectedOrigin: origin.config.origin,
			expectedRPID: origin.config.rpID,
			requireUserPresence: true,
			requireUserVerification: true,
		});
	} catch (error) {
		console.warn("passkey_registration_verification_failed", { user_id: context.user.id, error: error?.message || "verification_error" });
		return fail("INVALID_PASSKEY", "Passkey 注册验证失败", 400);
	}
	if (!verification?.verified || !verification.registrationInfo?.credential) {
		return fail("INVALID_PASSKEY", "Passkey 注册验证失败", 400);
	}

	const registration = verification.registrationInfo;
	const credential = registration.credential;
	const duplicate = await env.StudyPulseDB.prepare(
		"SELECT credential_id FROM user_passkeys WHERE credential_id = ?",
	).bind(credential.id).first();
	if (duplicate) return fail("PASSKEY_ALREADY_REGISTERED", "该 Passkey 已经绑定", 409);
	const now = new Date().toISOString();
	const batch = await env.StudyPulseDB.batch([
		env.StudyPulseDB.prepare("UPDATE auth_challenges SET used = 1 WHERE id = ? AND used = 0").bind(challenge.id),
		env.StudyPulseDB.prepare(
			`INSERT INTO user_passkeys
				(credential_id, user_id, public_key, sign_count, transports, device_type, backed_up, name, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			credential.id,
			context.user.id,
			toBase64Url(credential.publicKey),
			Number(credential.counter || 0),
			serializeTransports(response.response?.transports),
			registration.credentialDeviceType || null,
			registration.credentialBackedUp ? 1 : 0,
			challenge.payload?.name || "Passkey",
			now,
			now,
		),
		env.StudyPulseDB.prepare(
			"UPDATE users SET passkey_prompt_dismissed_at = COALESCE(passkey_prompt_dismissed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		).bind(context.user.id),
	]);
	if (batch[0]?.meta?.changes !== 1) {
		return fail("AUTH_CHALLENGE_EXPIRED", "Passkey 注册挑战已失效，请重试", 401);
	}
	await resetLoginRateLimits("passkey", request, env);
	return ok({ passkey: passkeyMetadata({
		credential_id: credential.id,
		name: challenge.payload?.name || "Passkey",
		device_type: registration.credentialDeviceType || null,
		backed_up: registration.credentialBackedUp ? 1 : 0,
		created_at: now,
		last_used_at: null,
	}) });
}

export async function handlePasskeyAuthenticationOptions(request, env) {
	const parsed = await readJson(request, { allowEmpty: true });
	if (parsed.error) return parsed.error;
	const rate = await passkeyRate(request, env);
	if (!rate.allowed) return rateLimited(rate);
	const origin = configError(request, env);
	if (origin.response) return origin.response;
	const options = await generateAuthenticationOptions({
		rpID: origin.config.rpID,
		userVerification: "required",
		timeout: 60_000,
	});
	const challengeToken = await createAuthChallenge(env, {
		kind: PASSKEY_LOGIN_KIND,
		payload: { challenge: options.challenge },
		ttlMs: PASSKEY_CHALLENGE_TTL_MS,
	});
	return ok({ challenge_token: challengeToken, public_key: options });
}

export async function handlePasskeyAuthenticationVerify(request, env) {
	const parsed = await readJson(request);
	if (parsed.error) return parsed.error;
	const rate = await passkeyRate(request, env);
	if (!rate.allowed) return rateLimited(rate);
	const origin = configError(request, env);
	if (origin.response) return origin.response;
	const challenge = await getAuthChallenge(parsed.body?.challenge_token, env, PASSKEY_LOGIN_KIND);
	const response = parsed.body?.response;
	const credentialId = response?.id;
	if (!challenge || typeof credentialId !== "string" || !/^[A-Za-z0-9_-]+$/.test(credentialId)) {
		return fail("INVALID_PASSKEY", "Passkey 登录失败", 401);
	}

	const credential = await env.StudyPulseDB.prepare(
		`SELECT p.credential_id, p.public_key, p.sign_count, p.transports, p.name,
		        p.user_id, u.email, u.status
		   FROM user_passkeys p
		   JOIN users u ON u.id = p.user_id
		  WHERE p.credential_id = ?`,
	).bind(credentialId).first();
	if (!credential) return fail("INVALID_PASSKEY", "Passkey 登录失败", 401);
	if (credential.status === "banned") return fail("ACCOUNT_BANNED", "该账号已被暂停", 403);

	let verification;
	try {
		verification = await verifyAuthenticationResponse({
			response,
			expectedChallenge: challenge.payload?.challenge || "",
			expectedOrigin: origin.config.origin,
			expectedRPID: origin.config.rpID,
			credential: {
				id: credential.credential_id,
				publicKey: fromBase64Url(credential.public_key),
				counter: Number(credential.sign_count || 0),
				transports: parseTransports(credential.transports),
			},
			requireUserVerification: true,
		});
	} catch (error) {
		console.warn("passkey_authentication_verification_failed", { error: error?.message || "verification_error" });
		return fail("INVALID_PASSKEY", "Passkey 登录失败", 401);
	}
	if (!verification?.verified || !verification.authenticationInfo) return fail("INVALID_PASSKEY", "Passkey 登录失败", 401);
	const nextCounter = Number(verification.authenticationInfo.newCounter || 0);
	const batch = await env.StudyPulseDB.batch([
		env.StudyPulseDB.prepare("UPDATE auth_challenges SET used = 1 WHERE id = ? AND used = 0").bind(challenge.id),
		env.StudyPulseDB.prepare(
			`UPDATE user_passkeys
			    SET sign_count = MAX(sign_count, ?),
			        device_type = COALESCE(?, device_type),
			        backed_up = CASE WHEN ? = 1 THEN 1 ELSE backed_up END,
			        last_used_at = CURRENT_TIMESTAMP,
			        updated_at = CURRENT_TIMESTAMP
			  WHERE credential_id = ? AND user_id = ?`,
		).bind(
			nextCounter,
			verification.authenticationInfo.credentialDeviceType || null,
			verification.authenticationInfo.credentialBackedUp ? 1 : 0,
			credential.credential_id,
			credential.user_id,
		),
	]);
	if (batch[0]?.meta?.changes !== 1) {
		return fail("AUTH_CHALLENGE_EXPIRED", "Passkey 登录挑战已失效，请重试", 401);
	}

	await resetLoginRateLimits("passkey", request, env);
	const session = await createSessionWithMetadata(
		credential.user_id,
		env,
		await sessionMetadata(request, credential.name),
	);
	return ok(sessionPayload(session, { id: credential.user_id, email: credential.email }));
}

export async function handlePasskeyList(request, env) {
	const origin = configError(request, env);
	if (origin.response) return origin.response;
	const context = await sessionContext(request, env);
	if (context.response) return context.response;
	const [user, passkeys] = await Promise.all([
		env.StudyPulseDB.prepare("SELECT passkey_prompt_dismissed_at FROM users WHERE id = ?").bind(context.user.id).first(),
		env.StudyPulseDB.prepare(
			`SELECT credential_id, name, device_type, backed_up, created_at, last_used_at
			   FROM user_passkeys
			  WHERE user_id = ?
			  ORDER BY created_at DESC`,
		).bind(context.user.id).all(),
	]);
	return ok({
		passkeys: (passkeys.results || []).map(passkeyMetadata),
		prompt_dismissed: !!user?.passkey_prompt_dismissed_at,
	});
}

export async function handlePasskeyDelete(request, env, credentialId) {
	const origin = configError(request, env);
	if (origin.response) return origin.response;
	const context = await sessionContext(request, env);
	if (context.response) return context.response;
	if (typeof credentialId !== "string" || !/^[A-Za-z0-9_-]+$/.test(credentialId)) return fail("INVALID_REQUEST", "Passkey ID 无效");
	const result = await env.StudyPulseDB.prepare(
		"DELETE FROM user_passkeys WHERE credential_id = ? AND user_id = ?",
	).bind(credentialId, context.user.id).run();
	if (result.meta?.changes !== 1) return fail("PASSKEY_NOT_FOUND", "Passkey 不存在", 404);
	return ok({});
}

export async function handlePasskeyPromptDismiss(request, env) {
	const parsed = await readJson(request, { allowEmpty: true });
	if (parsed.error) return parsed.error;
	const origin = configError(request, env);
	if (origin.response) return origin.response;
	const context = await sessionContext(request, env);
	if (context.response) return context.response;
	await env.StudyPulseDB.prepare(
		"UPDATE users SET passkey_prompt_dismissed_at = COALESCE(passkey_prompt_dismissed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
	).bind(context.user.id).run();
	return ok({});
}

export function isPasskeyRoute(pathname) {
	return pathname === "/auth/passkey"
		|| pathname.startsWith("/auth/passkey/")
		|| pathname === "/v1/auth/passkey"
		|| pathname.startsWith("/v1/auth/passkey/")
		|| pathname === "/api/user/passkeys"
		|| pathname.startsWith("/api/user/passkeys/");
}

export async function handlePasskeyRoute(request, env, pathname) {
	const method = request.method.toUpperCase();
	const userApi = pathname === "/api/user/passkeys" || pathname.startsWith("/api/user/passkeys/");
	const prefix = userApi ? "/api/user/passkeys" : pathname.startsWith("/v1/auth/passkey") ? "/v1/auth/passkey" : "/auth/passkey";
	const route = pathname.slice(prefix.length);

	if (route === "" && method === "GET") return handlePasskeyList(request, env);
	if (route === "/register/options" && method === "POST") return handlePasskeyRegistrationOptions(request, env);
	if (route === "/register/verify" && method === "POST") return handlePasskeyRegistrationVerify(request, env);
	if (route === "/login/options" && method === "POST" && !userApi) return handlePasskeyAuthenticationOptions(request, env);
	if (route === "/login/verify" && method === "POST" && !userApi) return handlePasskeyAuthenticationVerify(request, env);
	if (route === "/prompt-dismiss" && method === "POST" && !userApi) return handlePasskeyPromptDismiss(request, env);
	if (route.startsWith("/") && method === "DELETE") {
		let credentialId;
		try {
			credentialId = decodeURIComponent(route.slice(1));
		} catch {
			return fail("INVALID_REQUEST", "Passkey ID 无效");
		}
		return handlePasskeyDelete(request, env, credentialId);
	}
	return fail("NOT_FOUND", "Not Found", 404);
}
