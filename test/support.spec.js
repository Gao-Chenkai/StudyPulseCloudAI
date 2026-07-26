import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

async function request(path, options = {}) {
  return SELF.fetch(`https://support.chenkai.space${path}`, {
    method: options.method || "POST",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe("support feedback", () => {
  it("logs in with an email code and returns an empty ticket list", async () => {
    const address = `support-${crypto.randomUUID()}@example.com`;
    await env.StudyPulseDB.prepare(
      `INSERT INTO email_verification_codes
       (email,email_normalized,code,purpose,used,attempts,delivery_status,expires_at)
       VALUES (?,?,?,'login',0,0,'sent',?)`,
    ).bind(address, address, "123456", new Date(Date.now() + 600000).toISOString()).run();

    const login = await request("/api/support/auth/verify-code", { body: { email: address, code: "123456" } });
    expect(login.status).toBe(200);
    const loginJson = await login.json();
    expect(loginJson.data.token).toMatch(/^sp_sess_/);

    const tickets = await request("/api/support/tickets", {
      method: "GET",
      headers: { Authorization: `Bearer ${loginJson.data.token}` },
    });
    expect(tickets.status).toBe(200);
    expect((await tickets.json()).data.tickets).toEqual([]);
  });
});
