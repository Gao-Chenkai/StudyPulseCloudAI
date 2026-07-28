import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("auth login page", () => {
	it("serves the auth shell and executable external app script", async () => {
		const response = await SELF.fetch("https://auth.chenkai.space/login");
		const html = await response.text();
		const scriptResponse = await SELF.fetch("https://auth.chenkai.space/pages/auth/app.js");
		const script = await scriptResponse.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toContain("no-store");
		expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
		expect(html).toContain('<link rel="stylesheet" href="/pages/auth/styles.css">');
		expect(html).toContain('<script src="/pages/auth/app.js" defer></script>');
		expect(html).not.toContain("<style>");
		expect(html).not.toContain("<script>");
		expect(script).toContain("getAppReturnTo");
		expect(() => new Function(script)).not.toThrow();
	});
});
