/**
 * StudyPulse Cloud AI - 管理后台 API 测试
 *
 * 测试范围：
 *   - 未授权访问
 *   - 列出 Key
 *   - 创建 Key（rawKey 仅创建时返回）
 *   - 禁用 Key
 *   - 删除 Key
 *   - 重置配额
 *   - key_hash 绝不暴露
 */

import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { sha256Hex } from "../src/auth.js";

const ADMIN_TOKEN = "test-admin-token-12345";

// 辅助函数：发送管理 API 请求
async function adminFetch(path, options = {}) {
	const { method = "GET", body, token = ADMIN_TOKEN } = options;
	const headers = {
		"Content-Type": "application/json",
		"X-CSRF-Token": "test-csrf",
	};
	if (token) {
		headers["Authorization"] = `Bearer ${token}`;
	}
	// 同时设置 Cookie 以通过 CSRF 校验
	if (options.csrfCookie) {
		headers["Cookie"] = `admin_csrf=${options.csrfCookie}`;
	}

	const opts = { method, headers };
	if (body) opts.body = JSON.stringify(body);

	return SELF.fetch(`http://localhost${path}`, opts);
}

// 种子一些测试 Key
beforeAll(async () => {
	// 创建几个测试 Key
	const keys = [
		{ name: "Test Key 1", request_limit: 100 },
		{ name: "Test Key 2", request_limit: null },
		{ name: "Disabled Key", request_limit: 50 },
	];

	for (const k of keys) {
		const rawKey = "sp_test_" + crypto.randomUUID().slice(0, 8);
		const hash = await sha256Hex(rawKey);
		await env.StudyPulseDB.prepare(
			`INSERT OR IGNORE INTO api_keys (key_hash, name, enabled, request_count, request_limit)
			 VALUES (?, ?, ?, 0, ?)`,
		)
			.bind(hash, k.name, k.name === "Disabled Key" ? 0 : 1, k.request_limit ?? null)
			.run();
	}

	// 创建一个已超额 Key
	const exceededKey = "sp_test_exceeded_" + crypto.randomUUID().slice(0, 8);
	const exceededHash = await sha256Hex(exceededKey);
	await env.StudyPulseDB.prepare(
		`INSERT OR IGNORE INTO api_keys (key_hash, name, enabled, request_count, request_limit)
		 VALUES (?, ?, 1, 10, 10)`,
	)
		.bind(exceededHash, "Exceeded Key")
		.run();
});

describe("Admin API - 鉴权", () => {
	it("无 Authorization header 返回 401", async () => {
		const res = await adminFetch("/api/admin/keys", { token: "" });
		expect(res.status).toBe(401);
	});

	it("错误的 ADMIN_API_TOKEN 返回 401", async () => {
		const res = await adminFetch("/api/admin/keys", { token: "wrong-token" });
		expect(res.status).toBe(401);
	});

	it("正确的 ADMIN_API_TOKEN 可以访问管理 API", async () => {
		const res = await adminFetch("/api/admin/keys", {
			csrfCookie: "test-csrf",
		});
		expect(res.status).toBe(200);
	});

	it("状态变更接口需要 CSRF Token", async () => {
		const res = await adminFetch("/api/admin/keys/create", {
			method: "POST",
			body: { name: "Test" },
			// 不传 CSRF Cookie，X-CSRF-Token header 依然有但 Cookie 没有
			csrfCookie: "",
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "CSRF validation failed" });
	});
});

describe("Admin API - 仪表盘统计", () => {
	it("返回正确的统计数据", async () => {
		const res = await adminFetch("/api/admin/stats");
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.data.totalKeys).toBeGreaterThanOrEqual(4);
		expect(json.data.enabledKeys).toBeGreaterThanOrEqual(3);
		expect(json.data.enabledKeys).toBeLessThanOrEqual(json.data.totalKeys);
		expect(typeof json.data.totalRequests).toBe("number");
		expect(json.data.exceededQuotaKeys).toBeGreaterThanOrEqual(1);
	});
});

describe("Admin API - Key 列表", () => {
	it("列出所有 Key，不包含 key_hash", async () => {
		const res = await adminFetch("/api/admin/keys");
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(Array.isArray(json.data)).toBe(true);
		expect(json.data.length).toBeGreaterThanOrEqual(4);

		// 验证每个 Key 都不含 key_hash
		for (const key of json.data) {
			expect(key).not.toHaveProperty("key_hash");
			expect(key).toHaveProperty("id");
			expect(key).toHaveProperty("name");
			expect(key).toHaveProperty("enabled");
			expect(key).toHaveProperty("request_count");
			expect(key).toHaveProperty("request_limit");
		}
	});
});

describe("Admin API - 创建 Key", () => {
	it("成功创建 Key 并返回 rawKey", async () => {
		const res = await adminFetch("/api/admin/keys/create", {
			method: "POST",
			body: { name: "New Test Key", request_limit: 200, notes: "单元测试" },
			csrfCookie: "test-csrf",
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.data).toHaveProperty("id");
		expect(json.data).toHaveProperty("rawKey");
		expect(json.data.rawKey).toMatch(/^sp_beta_/);
		expect(json.data.rawKey.length).toBeGreaterThan(20);

		// 验证 rawKey 不会再次出现（重新列表不包含 rawKey）
		const listRes = await adminFetch("/api/admin/keys");
		const list = await listRes.json();
		const created = list.data.find((k) => k.id === json.data.id);
		expect(created).toBeTruthy();
		expect(created).not.toHaveProperty("rawKey");
		expect(created).not.toHaveProperty("key_hash");
	});

	it("缺少 name 返回 400", async () => {
		const res = await adminFetch("/api/admin/keys/create", {
			method: "POST",
			body: {},
			csrfCookie: "test-csrf",
		});
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toContain("name");
	});
});

describe("Admin API - 更新 Key", () => {
	let targetKeyId;

	beforeAll(async () => {
		// 先获取一个已知 Key 的 ID
		const res = await adminFetch("/api/admin/keys");
		const list = await res.json();
		const target = list.data.find((k) => k.name === "Test Key 1");
		targetKeyId = target.id;
	});

	it("成功更新 Key 的名称和状态", async () => {
		// 禁用 Key
		const res = await adminFetch("/api/admin/keys/update", {
			method: "POST",
			body: { id: targetKeyId, enabled: 0, name: "Test Key 1 (Disabled)" },
			csrfCookie: "test-csrf",
		});
		expect(res.status).toBe(200);

		// 验证更新生效
		const listRes = await adminFetch("/api/admin/keys");
		const list = await listRes.json();
		const updated = list.data.find((k) => k.id === targetKeyId);
		expect(updated.enabled).toBe(0);
		expect(updated.name).toBe("Test Key 1 (Disabled)");

		// 恢复状态
		await adminFetch("/api/admin/keys/update", {
			method: "POST",
			body: { id: targetKeyId, enabled: 1, name: "Test Key 1" },
			csrfCookie: "test-csrf",
		});
	});

	it("更新不存在的 Key 返回 404", async () => {
		const res = await adminFetch("/api/admin/keys/update", {
			method: "POST",
			body: { id: 99999, name: "Ghost" },
			csrfCookie: "test-csrf",
		});
		expect(res.status).toBe(404);
	});
});

describe("Admin API - 禁用 Key", () => {
	it("禁用 Key 后 enabled = 0", async () => {
		const listRes = await adminFetch("/api/admin/keys");
		const list = await listRes.json();
		const target = list.data.find((k) => k.name === "Test Key 2");
		expect(target.enabled).toBe(1);

		const res = await adminFetch("/api/admin/keys/update", {
			method: "POST",
			body: { id: target.id, enabled: 0 },
			csrfCookie: "test-csrf",
		});
		expect(res.status).toBe(200);

		const updatedList = await adminFetch("/api/admin/keys");
		const updated = (await updatedList.json()).data.find((k) => k.id === target.id);
		expect(updated.enabled).toBe(0);

		// 恢复
		await adminFetch("/api/admin/keys/update", {
			method: "POST",
			body: { id: target.id, enabled: 1 },
			csrfCookie: "test-csrf",
		});
	});
});

describe("Admin API - 重置配额", () => {
	let exceededKeyId;

	beforeAll(async () => {
		const res = await adminFetch("/api/admin/keys");
		const list = await res.json();
		const target = list.data.find((k) => k.name === "Exceeded Key");
		exceededKeyId = target.id;
		expect(target.request_count).toBe(10);
	});

	it("重置配额后 request_count = 0", async () => {
		const res = await adminFetch("/api/admin/keys/reset-quota", {
			method: "POST",
			body: { id: exceededKeyId },
			csrfCookie: "test-csrf",
		});
		expect(res.status).toBe(200);

		const listRes = await adminFetch("/api/admin/keys");
		const updated = (await listRes.json()).data.find((k) => k.id === exceededKeyId);
		expect(updated.request_count).toBe(0);
	});

	it("重置不存在的 Key 返回 404", async () => {
		const res = await adminFetch("/api/admin/keys/reset-quota", {
			method: "POST",
			body: { id: 99999 },
			csrfCookie: "test-csrf",
		});
		expect(res.status).toBe(404);
	});
});

describe("Admin API - 删除 Key", () => {
	let deleteTargetId;

	beforeAll(async () => {
		// 创建一个临时 Key 用于删除测试
		const rawKey = "sp_delete_test_" + crypto.randomUUID().slice(0, 8);
		const hash = await sha256Hex(rawKey);
		const result = await env.StudyPulseDB.prepare(
			"INSERT INTO api_keys (key_hash, name, enabled) VALUES (?, ?, 1) RETURNING id",
		)
			.bind(hash, "To Be Deleted")
			.first("id");
		deleteTargetId = result;
	});

	it("成功删除 Key", async () => {
		const res = await adminFetch("/api/admin/keys/delete", {
			method: "POST",
			body: { id: deleteTargetId },
			csrfCookie: "test-csrf",
		});
		expect(res.status).toBe(200);

		// 验证已删除
		const listRes = await adminFetch("/api/admin/keys");
		const list = await listRes.json();
		expect(list.data.find((k) => k.id === deleteTargetId)).toBeUndefined();
	});

	it("删除不存在的 Key 返回 404", async () => {
		const res = await adminFetch("/api/admin/keys/delete", {
			method: "POST",
			body: { id: 99999 },
			csrfCookie: "test-csrf",
		});
		expect(res.status).toBe(404);
	});
});

describe("Admin API - rawKey 安全性", () => {
	it("创建 Key 时返回 rawKey", async () => {
		const res = await adminFetch("/api/admin/keys/create", {
			method: "POST",
			body: { name: "Raw Key Test" },
			csrfCookie: "test-csrf",
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.data.rawKey).toBeTruthy();
		expect(json.data.rawKey).toMatch(/^sp_beta_/);
	});

	it("列表和更新接口绝不返回 rawKey 或 key_hash", async () => {
		// 列表
		const listRes = await adminFetch("/api/admin/keys");
		const list = await listRes.json();
		for (const key of list.data) {
			expect(key).not.toHaveProperty("rawKey");
			expect(key).not.toHaveProperty("key_hash");
		}

		// 仪表盘统计
		const statsRes = await adminFetch("/api/admin/stats");
		const stats = await statsRes.json();
		expect(stats.data).not.toHaveProperty("key_hash");
		expect(stats.data).not.toHaveProperty("rawKey");
	});

	it("更新 Key 响应不包含 rawKey 或 key_hash", async () => {
		const listRes = await adminFetch("/api/admin/keys");
		const list = await listRes.json();
		const target = list.data[0];

		const res = await adminFetch("/api/admin/keys/update", {
			method: "POST",
			body: { id: target.id, name: target.name },
			csrfCookie: "test-csrf",
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).not.toHaveProperty("rawKey");
		expect(json).not.toHaveProperty("key_hash");
	});
});

describe("Admin API - 请求日志", () => {
	it("可以查询请求日志", async () => {
		const res = await adminFetch("/api/admin/logs");
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(Array.isArray(json.data)).toBe(true);
	});

	it("日志不包含敏感字段", async () => {
		// 先触发一次 chat 请求来生成日志
		const chatRes = await SELF.fetch("http://example.com/v1/chat", {
			method: "POST",
			headers: {
				Authorization: "Bearer sp_beta_test001",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ message: "test" }),
		});

		// 等待异步日志写入完成
		await new Promise((r) => setTimeout(r, 500));

		const res = await adminFetch("/api/admin/logs");
		const json = await res.json();
		for (const log of json.data) {
			expect(log).not.toHaveProperty("key_hash");
			expect(log).not.toHaveProperty("rawKey");
			expect(log).not.toHaveProperty("prompt");
			expect(log).not.toHaveProperty("response");
		}
	});
});
