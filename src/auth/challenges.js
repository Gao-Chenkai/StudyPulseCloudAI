import { sha256Hex } from "../auth.js";

function randomToken(prefix) {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return prefix + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createAuthChallenge(env, { kind, userId = null, email = null, payload = null, ttlMs = 10 * 60_000 }) {
	const token = randomToken("sp_challenge_");
	await env.StudyPulseDB.prepare(
		`INSERT INTO auth_challenges (token_hash, kind, user_id, email, payload, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	).bind(await sha256Hex(token), kind, userId, email, payload ? JSON.stringify(payload) : null, new Date(Date.now() + ttlMs).toISOString()).run();
	return token;
}

export async function getAuthChallenge(token, env, kind) {
	if (typeof token !== "string" || !token.startsWith("sp_challenge_")) return null;
	const challenge = await env.StudyPulseDB.prepare(
		`SELECT id, token_hash, kind, user_id, email, payload, expires_at, used
		   FROM auth_challenges WHERE token_hash = ? AND kind = ?`,
	).bind(await sha256Hex(token), kind).first();
	if (!challenge || challenge.used === 1 || Date.now() >= new Date(challenge.expires_at).getTime()) return null;
	try { challenge.payload = challenge.payload ? JSON.parse(challenge.payload) : null; } catch { challenge.payload = null; }
	return challenge;
}

export async function consumeAuthChallenge(id, env) {
	const result = await env.StudyPulseDB.prepare(
		"UPDATE auth_challenges SET used = 1 WHERE id = ? AND used = 0",
	).bind(id).run();
	return result.meta?.changes === 1;
}
