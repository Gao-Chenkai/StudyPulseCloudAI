import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth.js";
import { createSession } from "../src/auth/session.js";

async function createUserSession(status = "active") {
	const id = crypto.randomUUID();
	const email = `${id}@example.com`;
	await env.StudyPulseDB.prepare(
		"INSERT INTO users (id, email, email_normalized, email_verified, status) VALUES (?, ?, ?, 1, ?)",
	).bind(id, email, email, status).run();
	const session = await createSession(id, env);
	return { id, email, token: session.token };
}

async function passkeyFetch(path, { method = "GET", body, token, origin = "http://localhost", ip = crypto.randomUUID() } = {}) {
	const headers = { Origin: origin, "CF-Connecting-IP": ip };
	if (token) headers.Authorization = `Bearer ${token}`;
	if (body !== undefined) headers["Content-Type"] = "application/json";
	return SELF.fetch(`http://localhost${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("Passkey authentication", () => {
	it("returns a usernameless authentication challenge", async () => {
		const response = await passkeyFetch("/auth/passkey/login/options", { method: "POST", body: {} });
		const json = await response.json();

		expect(response.status).toBe(200);
		expect(json.success).toBe(true);
		expect(json.data.challenge_token).toMatch(/^sp_challenge_/);
		expect(json.data.public_key.rpId).toBe("localhost");
		expect(json.data.public_key.userVerification).toBe("required");
		expect(json.data.public_key.allowCredentials).toBeUndefined();
	});

	it("rejects an unapproved Origin before creating a challenge", async () => {
		const response = await passkeyFetch("/auth/passkey/login/options", {
			method: "POST",
			body: {},
			origin: "https://evil.example",
		});
		const json = await response.json();

		expect(response.status).toBe(403);
		expect(json.error.code).toBe("INVALID_ORIGIN");
	});

	it("requires a Session and returns registration options for the current user", async () => {
		const user = await createUserSession();
		const response = await passkeyFetch("/auth/passkey/register/options", {
			method: "POST",
			body: { name: "我的 iPhone" },
			token: user.token,
		});
		const json = await response.json();

		expect(response.status).toBe(200);
		expect(json.data.challenge_token).toMatch(/^sp_challenge_/);
		expect(json.data.public_key.rp.id).toBe("localhost");
		expect(json.data.public_key.user.name).toBe(user.email);
		expect(json.data.public_key.authenticatorSelection.residentKey).toBe("required");

		const challenge = await env.StudyPulseDB.prepare(
			"SELECT user_id, kind, used FROM auth_challenges WHERE token_hash = ?",
		).bind(await sha256Hex(json.data.challenge_token)).first();
		expect(challenge.user_id).toBe(user.id);
		expect(challenge.kind).toBe("passkey_registration");
		expect(challenge.used).toBe(0);
	});

	it("does not let a different Session use a registration challenge", async () => {
		const owner = await createUserSession();
		const other = await createUserSession();
		const options = await passkeyFetch("/auth/passkey/register/options", {
			method: "POST",
			body: {},
			token: owner.token,
		});
		const optionsJson = await options.json();
		const response = await passkeyFetch("/auth/passkey/register/verify", {
			method: "POST",
			body: { challenge_token: optionsJson.data.challenge_token, response: {} },
			token: other.token,
		});
		const json = await response.json();

		expect(response.status).toBe(401);
		expect(json.error.code).toBe("AUTH_CHALLENGE_EXPIRED");
	});

	it("rejects expired and malformed registration challenges", async () => {
		const user = await createUserSession();
		const options = await passkeyFetch("/auth/passkey/register/options", {
			method: "POST",
			body: {},
			token: user.token,
		});
		const optionsJson = await options.json();
		await env.StudyPulseDB.prepare(
			"UPDATE auth_challenges SET expires_at = ? WHERE token_hash = ?",
		).bind(new Date(Date.now() - 1000).toISOString(), await sha256Hex(optionsJson.data.challenge_token)).run();

		const response = await passkeyFetch("/auth/passkey/register/verify", {
			method: "POST",
			body: { challenge_token: optionsJson.data.challenge_token, response: {} },
			token: user.token,
		});
		const json = await response.json();

		expect(response.status).toBe(401);
		expect(json.error.code).toBe("AUTH_CHALLENGE_EXPIRED");
	});

	it("lists and deletes only the current user's Passkeys without credential material", async () => {
		const user = await createUserSession();
		const credentialId = `credential_${crypto.randomUUID().replaceAll("-", "")}`;
		await env.StudyPulseDB.prepare(
			`INSERT INTO user_passkeys
				(credential_id, user_id, public_key, sign_count, device_type, backed_up, name, created_at, last_used_at)
			 VALUES (?, ?, ?, 4, 'singleDevice', 1, ?, ?, ?)`,
		).bind(credentialId, user.id, "not-returned", "我的 Mac", new Date().toISOString(), new Date().toISOString()).run();

		const list = await passkeyFetch("/api/user/passkeys", { token: user.token });
		const listJson = await list.json();
		expect(list.status).toBe(200);
		expect(listJson.data.passkeys).toHaveLength(1);
		expect(listJson.data.passkeys[0]).toMatchObject({ id: credentialId, name: "我的 Mac", device_type: "singleDevice", backed_up: true });
		expect(listJson.data.passkeys[0]).not.toHaveProperty("public_key");
		expect(listJson.data.passkeys[0]).not.toHaveProperty("sign_count");

		const deleted = await passkeyFetch(`/api/user/passkeys/${encodeURIComponent(credentialId)}`, { method: "DELETE", token: user.token });
		expect(deleted.status).toBe(200);
		expect(await env.StudyPulseDB.prepare("SELECT credential_id FROM user_passkeys WHERE credential_id = ?").bind(credentialId).first()).toBeNull();
	});

	it("supports dismissing the one-time enrollment prompt", async () => {
		const user = await createUserSession();
		const dismiss = await passkeyFetch("/auth/passkey/prompt-dismiss", { method: "POST", body: {}, token: user.token });
		expect(dismiss.status).toBe(200);

		const list = await passkeyFetch("/auth/passkey", { token: user.token });
		const json = await list.json();
		expect(json.data.prompt_dismissed).toBe(true);
		expect(json.data.passkeys).toEqual([]);
	});

	it("returns a generic failure for an unknown login credential", async () => {
		const options = await passkeyFetch("/auth/passkey/login/options", { method: "POST", body: {} });
		const optionsJson = await options.json();
		const response = await passkeyFetch("/auth/passkey/login/verify", {
			method: "POST",
			body: {
				challenge_token: optionsJson.data.challenge_token,
				response: { id: "unknown_credential", rawId: "unknown_credential", type: "public-key", response: {} },
			},
		});
		const json = await response.json();

		expect(response.status).toBe(401);
		expect(json.error.code).toBe("INVALID_PASSKEY");
		expect(json.error.message).toBe("Passkey 登录失败");
	});

	it("blocks a Passkey belonging to a banned account", async () => {
		const user = await createUserSession("banned");
		const credentialId = `banned_${crypto.randomUUID().replaceAll("-", "")}`;
		await env.StudyPulseDB.prepare(
			"INSERT INTO user_passkeys (credential_id, user_id, public_key) VALUES (?, ?, ?)",
		).bind(credentialId, user.id, "AQID").run();
		const options = await passkeyFetch("/auth/passkey/login/options", { method: "POST", body: {} });
		const optionsJson = await options.json();
		const response = await passkeyFetch("/auth/passkey/login/verify", {
			method: "POST",
			body: {
				challenge_token: optionsJson.data.challenge_token,
				response: { id: credentialId, rawId: credentialId, type: "public-key", response: {} },
			},
		});
		const json = await response.json();

		expect(response.status).toBe(403);
		expect(json.error.code).toBe("ACCOUNT_BANNED");
	});
});
