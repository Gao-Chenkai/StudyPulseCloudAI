import { env, createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

describe("StudyPulse Cloud AI v0.2-beta", () => {
	describe("GET / (health check)", () => {
		it("returns online status with service meta", async () => {
			const response = await SELF.fetch("http://localhost/");
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				success: true,
				service: "StudyPulse Cloud AI",
				version: "0.5-beta-github",
				status: "online",
			});
		});
	});

	describe("POST /v1/chat auth failures", () => {
		it("returns 401 when Authorization header is missing", async () => {
			const response = await SELF.fetch("http://localhost/v1/chat", {
				method: "POST",
			});
			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: "Missing API Key" });
		});

		it("returns 403 when API Key is invalid", async () => {
			const response = await SELF.fetch("http://localhost/v1/chat", {
				method: "POST",
				headers: { Authorization: "Bearer test" },
			});
			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({ error: "Invalid API Key" });
		});
	});

	describe("POST /v1/chat server config failures", () => {
		// 注：.dev.vars 已配置 MINIMAX_API_KEY（测试用假 Key），
		// 鉴权通过后会实际调用 MiniMax API，因 Key 无效返回 502
		it("returns 502 when MiniMax API key is invalid", async () => {
			const request = new Request("http://localhost/v1/chat", {
				method: "POST",
				headers: {
					Authorization: "Bearer sp_beta_test001",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ message: "你好" }),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			expect(response.status).toBe(502);
			const json = await response.json();
			expect(json.error).toBe("AI request failed");
		});
	});
});
