import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { createContribution, reviewContribution } from "../src/contributions/service.js";

describe("code contribution review workflow", () => {
	it("submits a contribution and awards the selected membership on approval", async () => {
		const userId = crypto.randomUUID();
		const email = `contribution-${userId}@example.com`;
		await env.StudyPulseDB.prepare("INSERT INTO users (id,email,email_normalized,email_verified,membership_type) VALUES (?,?,?,1,'free')").bind(userId, email, email).run();
		const created = await createContribution(userId, { email, contribution_url: "https://github.com/studypulse/example/issues/1", contribution_type: "issue", description: "发现并报告问题" }, env);
		expect(created.success).toBe(true);
		const reviewed = await reviewContribution(created.id, "approved", "pro", 14, "感谢贡献", env);
		expect(reviewed.success).toBe(true);
		expect(reviewed.membership).toBe("pro");
		const user = await env.StudyPulseDB.prepare("SELECT membership_type,membership_expires_at FROM users WHERE id = ?").bind(userId).first();
		expect(user.membership_type).toBe("pro");
		expect(user.membership_expires_at).toBeTruthy();
		const ticket = await env.StudyPulseDB.prepare("SELECT status,awarded_membership FROM contribution_tickets WHERE id = ?").bind(created.id).first();
		expect(ticket).toMatchObject({ status: "approved", awarded_membership: "pro" });
	});
});
