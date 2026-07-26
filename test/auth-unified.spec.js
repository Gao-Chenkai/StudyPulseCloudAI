import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

async function request(path, options = {}) {
	return SELF.fetch(options.url || `http://localhost${path}`, {
		method: options.method || "POST",
		headers: { "Content-Type": "application/json", ...(options.headers || {}) },
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
}

describe("unified identity endpoints", () => {
	it("logs in with a code, returns access/refresh tokens, and rotates refresh tokens", async () => {
		const email = `code-${crypto.randomUUID()}@example.com`;
		await env.StudyPulseDB.prepare(`INSERT INTO email_verification_codes (email, email_normalized, code, purpose, used, attempts, delivery_status, expires_at) VALUES (?, ?, '123456', 'login', 0, 0, 'sent', ?)`)
			.bind(email, email, new Date(Date.now() + 600_000).toISOString()).run();
		const login = await request("/auth/login/code", { body: { email, code: "123456" } });
		const body = await login.json();
		expect(login.status).toBe(200);
		expect(body.data.requires_password_setup).toBe(true);
		expect(body.data.setup_token).toMatch(/^sp_challenge_/);
		const setup = await request("/auth/password/set-after-code", { body: { setup_token: body.data.setup_token, password: "首次设置的安全密码 123" } });
		const setupBody = await setup.json();
		expect(setup.status).toBe(200);
		expect(setupBody.data.access_token).toMatch(/^sp_sess_/);
		const refreshed = await request("/auth/refresh", { body: { refresh_token: setupBody.data.refresh_token } });
		const refreshedBody = await refreshed.json();
		expect(refreshed.status).toBe(200);
		const reused = await request("/auth/refresh", { body: { refresh_token: setupBody.data.refresh_token } });
		expect(reused.status).toBe(401);
		expect(refreshedBody.data.user.id).toBe(body.data.user.id);
	});

	it("serves the auth center on the configured hostname", async () => {
		const response = await request("/login", { method: "GET", url: "https://auth.chenkai.space/login" });
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(await response.text()).toContain("GitHub");
	});
});
