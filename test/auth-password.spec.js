import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { sha256Hex } from "../src/auth.js";
import { authenticateRequest } from "../src/auth/middleware.js";

const password = "正确的安全密码 123";

function email() {
	return `auth-${crypto.randomUUID()}@example.com`;
}

async function request(path, options = {}) {
	return SELF.fetch(`http://localhost${path}`, {
		method: options.method || "POST",
		headers: { "Content-Type": "application/json", ...(options.headers || {}) },
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
}

async function insertCode(address, code, purpose, expiresAt = new Date(Date.now() + 600_000).toISOString()) {
	await env.StudyPulseDB.prepare(
		`INSERT INTO email_verification_codes
			 (email, email_normalized, code, purpose, used, attempts, delivery_status, expires_at)
		 VALUES (?, ?, ?, ?, 0, 0, 'sent', ?)`,
	).bind(address, address.trim().toLowerCase(), code, purpose, expiresAt).run();
}

async function register(address, secret = password) {
	await insertCode(address, "123456", "register");
	const response = await request("/v1/auth/register/verify", {
		body: { email: `  ${address.toUpperCase()} `, code: "123456", password: secret, device_name: "Test iPhone" },
	});
	return { response, json: await response.json() };
}

describe("password authentication", () => {
	it("registers with a one-time email code and normalizes email", async () => {
		const address = email();
		const result = await register(address);
		expect(result.response.status).toBe(200);
		expect(result.json.success).toBe(true);
		expect(result.json.data.user.email).toBe(address);
		expect(result.json.data.session_token).toMatch(/^sp_sess_/);
		const reused = await request("/v1/auth/register/verify", {
			body: { email: address, code: "123456", password },
		});
		expect((await reused.json()).error.code).toBe("INVALID_VERIFICATION_CODE");

		const row = await env.StudyPulseDB.prepare(
			"SELECT email_normalized FROM users WHERE email_normalized = ?",
		).bind(address).first();
		expect(row.email_normalized).toBe(address);
	});

	it("rejects duplicate registration and invalid or expired codes", async () => {
		const address = email();
		await register(address);
		await insertCode(address, "654321", "register");
		const duplicate = await request("/v1/auth/register/verify", {
			body: { email: address, code: "654321", password },
		});
		expect(duplicate.status).toBe(409);
		expect((await duplicate.json()).error.code).toBe("EMAIL_ALREADY_REGISTERED");

		const expiredAddress = email();
		await insertCode(expiredAddress, "111111", "register", new Date(Date.now() - 1_000).toISOString());
		const expired = await request("/v1/auth/register/verify", {
			body: { email: expiredAddress, code: "111111", password },
		});
		expect(expired.status).toBe(400);
		expect((await expired.json()).error.code).toBe("VERIFICATION_CODE_EXPIRED");

		const invalid = await request("/v1/auth/register/verify", {
			body: { email: expiredAddress, code: "222222", password },
		});
		expect((await invalid.json()).error.code).toBe("VERIFICATION_CODE_EXPIRED");
	});

	it("supports password login, old users without credentials, and generic failures", async () => {
		const address = email();
		await register(address);
		const login = await request("/v1/auth/login", {
			body: { email: ` ${address.toUpperCase()} `, password, device_name: "Laptop" },
		});
		const loginJson = await login.json();
		expect(login.status).toBe(200);
		expect(loginJson.data.user.email).toBe(address);

		const wrong = await request("/v1/auth/login", { body: { email: address, password: "wrong password" } });
		expect(wrong.status).toBe(401);
		expect((await wrong.json()).error.code).toBe("INVALID_CREDENTIALS");
		const missing = await request("/v1/auth/login", { body: { email: email(), password } });
		expect(missing.status).toBe(401);
		expect((await missing.json()).error.code).toBe("INVALID_CREDENTIALS");

		const oldAddress = email();
		const oldUserId = crypto.randomUUID();
		await env.StudyPulseDB.prepare(
			`INSERT INTO users (id, email, email_normalized, email_verified, role, membership_type)
			 VALUES (?, ?, ?, 1, 'user', 'free')`,
		).bind(oldUserId, oldAddress, oldAddress).run();
		const oldLogin = await request("/v1/auth/login", { body: { email: oldAddress, password } });
		expect(oldLogin.status).toBe(401);
	});

	it("changes and resets passwords while revoking old sessions", async () => {
		const address = email();
		const registered = await register(address);
		const firstToken = registered.json.data.session_token;
		const second = await request("/v1/auth/login", { body: { email: address, password } });
		const secondToken = (await second.json()).data.session_token;
		const wrongCurrent = await request("/v1/auth/password/change", {
			headers: { Authorization: `Bearer ${firstToken}` },
			body: { current_password: "wrong password", new_password: "新的安全密码 456" },
		});
		expect(wrongCurrent.status).toBe(401);
		const unchanged = await request("/v1/auth/password/change", {
			headers: { Authorization: `Bearer ${firstToken}` },
			body: { current_password: password, new_password: password },
		});
		expect(unchanged.status).toBe(409);

		const changed = await request("/v1/auth/password/change", {
			headers: { Authorization: `Bearer ${firstToken}` },
			body: { current_password: password, new_password: "新的安全密码 456" },
		});
		expect(changed.status).toBe(200);
		const newToken = (await changed.json()).data.session_token;

		const oldSession = await request("/v1/auth/me", { method: "GET", headers: { Authorization: `Bearer ${secondToken}` } });
		expect(oldSession.status).toBe(401);
		const currentSession = await request("/v1/auth/me", { method: "GET", headers: { Authorization: `Bearer ${newToken}` } });
		expect(currentSession.status).toBe(200);

		const resetCode = "777777";
		await insertCode(address, resetCode, "reset_password");
		const reset = await request("/v1/auth/password/reset", {
			body: { email: address, code: resetCode, new_password: "重置后的密码 789" },
		});
		expect(reset.status).toBe(200);
		const revokedAfterReset = await request("/v1/auth/me", { method: "GET", headers: { Authorization: `Bearer ${newToken}` } });
		expect(revokedAfterReset.status).toBe(401);
		const oldPassword = await request("/v1/auth/login", { body: { email: address, password: "新的安全密码 456" } });
		expect(oldPassword.status).toBe(401);
		const resetPassword = await request("/v1/auth/login", { body: { email: address, password: "重置后的密码 789" } });
		expect(resetPassword.status).toBe(200);
	});

	it("supports logout, logout-all, account locking, and lock expiry", async () => {
		const address = email();
		await register(address);
		const login = await request("/v1/auth/login", { body: { email: address, password } });
		const token = (await login.json()).data.session_token;
		const logout = await request("/v1/auth/logout", { headers: { Authorization: `Bearer ${token}` } });
		expect(logout.status).toBe(200);
		const logoutAgain = await request("/v1/auth/logout", { headers: { Authorization: `Bearer ${token}` } });
		expect(logoutAgain.status).toBe(401);

		const lockedAddress = email();
		await register(lockedAddress);
		for (let attempt = 0; attempt < 5; attempt++) {
			const wrong = await request("/v1/auth/login", { body: { email: lockedAddress, password: "bad password" } });
			expect(wrong.status).toBe(401);
		}
		const locked = await request("/v1/auth/login", { body: { email: lockedAddress, password } });
		expect(locked.status).toBe(401);
		await env.StudyPulseDB.prepare(
			"UPDATE user_credentials SET locked_until = ? WHERE user_id = (SELECT id FROM users WHERE email_normalized = ?)",
		).bind(new Date(Date.now() - 1_000).toISOString(), lockedAddress).run();
		const recovered = await request("/v1/auth/login", { body: { email: lockedAddress, password } });
		expect(recovered.status).toBe(200);

		const allA = await (await request("/v1/auth/login", { body: { email: address, password } })).json();
		const allB = await (await request("/v1/auth/login", { body: { email: address, password } })).json();
		const allLogout = await request("/v1/auth/logout-all", { headers: { Authorization: `Bearer ${allA.data.session_token}` } });
		expect(allLogout.status).toBe(200);
		const allRevoked = await request("/v1/auth/me", { method: "GET", headers: { Authorization: `Bearer ${allB.data.session_token}` } });
		expect(allRevoked.status).toBe(401);
	});

	it("keeps auth context unified and never exposes credential fields", async () => {
		const address = email();
		const registered = await register(address);
		const token = registered.json.data.session_token;
		const me = await request("/v1/auth/me", { method: "GET", headers: { Authorization: `Bearer ${token}` } });
		const meJson = await me.json();
		expect(meJson.data.login_methods).toEqual(["email_code", "password"]);
		expect(JSON.stringify(meJson)).not.toMatch(/password_hash|password_salt|session_token/i);

		const sessionContext = await authenticateRequest(
			new Request("http://localhost/v1/chat", { headers: { Authorization: `Bearer ${token}` } }),
			env,
		);
		expect(sessionContext).toMatchObject({ ok: true, userId: meJson.data.user.id, authType: "session", apiKeyId: null });
		const sessionHash = await sha256Hex(token);
		await env.StudyPulseDB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
			.bind(new Date(Date.now() - 1_000).toISOString(), sessionHash).run();
		const expired = await request("/v1/auth/me", { method: "GET", headers: { Authorization: `Bearer ${token}` } });
		expect(expired.status).toBe(401);

		const apiKeyHash = await sha256Hex("sp_beta_test001");
		const apiKeyRow = await env.StudyPulseDB.prepare("SELECT id FROM api_keys WHERE key_hash = ?").bind(apiKeyHash).first();
		const apiKeyContext = await authenticateRequest(
			new Request("http://localhost/v1/chat", { headers: { Authorization: "Bearer sp_beta_test001" } }),
			env,
		);
		expect(apiKeyContext).toMatchObject({ ok: true, authType: "api_key", apiKeyId: apiKeyRow.id });
		expect(apiKeyHash).toHaveLength(64);
	});

	it("rejects weak passwords by Unicode character length", async () => {
		const address = email();
		await insertCode(address, "888888", "register");
		const shortPassword = await request("/v1/auth/register/verify", {
			body: { email: address, code: "888888", password: "一二三四五六七八九" },
		});
		expect(shortPassword.status).toBe(400);
		expect((await shortPassword.json()).error.code).toBe("WEAK_PASSWORD");
	});
});
