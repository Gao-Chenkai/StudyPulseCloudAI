import { describe, expect, it } from "vitest";
import { renderLoginPage } from "../src/auth/login-page.js";

describe("auth login page", () => {
	it("emits an executable app callback matcher", async () => {
		const response = renderLoginPage();
		const html = await response.text();
		const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];

		expect(response.headers.get("Cache-Control")).toContain("no-store");
		expect(script).toBeTruthy();
		expect(script).toContain("/^studypulse:\\/\\/auth\\/callback(?:\\?.*)?$/");
		expect(script).toContain("fallback='studypulse://auth/callback'");
		expect(script).not.toContain("/^studypulse://auth/callback(?:?.*)?$/");
		expect(() => new Function(script)).not.toThrow();
	});
});
