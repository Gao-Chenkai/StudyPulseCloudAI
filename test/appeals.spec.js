import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const headers = { "Content-Type": "application/json", Authorization: "Bearer test-admin-token-12345", "X-CSRF-Token": "test-csrf", Cookie: "admin_csrf=test-csrf" };

describe("account bans and appeals", () => {
	it("creates a random-token ban and completes the appeal workflow", async () => {
		const userId = crypto.randomUUID();
		await env.StudyPulseDB.prepare("INSERT INTO users (id,email,email_normalized,email_verified) VALUES (?,?,?,1)").bind(userId, `${userId}@example.com`, `${userId}@example.com`).run();
		const banResponse = await SELF.fetch("http://localhost/api/admin/bans/create", { method: "POST", headers, body: JSON.stringify({ user_id: userId, reason: "测试原因" }) });
		expect(banResponse.status).toBe(200);
		const ban = await banResponse.json();
		expect(ban.data.appealToken).toMatch(/^BAN_[0-9a-f]{64}$/);
		const page = await SELF.fetch(`http://localhost/appeal/${ban.data.appealToken}`);
		expect(page.status).toBe(200);
		expect(await page.text()).toContain("账号封禁申诉");
		const submit = await SELF.fetch("http://localhost/api/appeals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: ban.data.appealToken, content: "我认为这是误判，请重新审核我的账号。" }) });
		expect(submit.status).toBe(201);
		const appeals = await SELF.fetch("http://localhost/api/admin/appeals", { headers });
		const list = await appeals.json();
		const appeal = list.data.find((item) => item.user_id === userId);
		expect(appeal.status).toBe("pending");
		const review = await SELF.fetch("http://localhost/api/admin/appeals/review", { method: "POST", headers, body: JSON.stringify({ id: appeal.id, decision: "approved", admin_reply: "已恢复" }) });
		expect(review.status).toBe(200);
		const user = await env.StudyPulseDB.prepare("SELECT status FROM users WHERE id=?").bind(userId).first();
		expect(user.status).toBe("active");
	});

	it("accepts a short but non-empty appeal and trims request fields", async () => {
		const userId = crypto.randomUUID();
		await env.StudyPulseDB.prepare("INSERT INTO users (id,email,email_normalized,email_verified) VALUES (?,?,?,1)").bind(userId, `${userId}@example.com`, `${userId}@example.com`).run();
		const banResponse = await SELF.fetch("http://localhost/api/admin/bans/create", { method: "POST", headers, body: JSON.stringify({ user_id: userId, reason: "测试原因" }) });
		const ban = await banResponse.json();
		const submit = await SELF.fetch("http://localhost/api/appeals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: `  ${ban.data.appealToken}  `, content: "  误判  " }) });
		expect(submit.status).toBe(201);
	});
});
