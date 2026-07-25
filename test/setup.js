/**
 * Vitest 全局 setup：在所有测试前应用 migration 并种子一把 Beta Key。
 *
 * cloudflare:test 提供的 env.StudyPulseDB 是 miniflare 内存 D1，
 * 每个 vitest 进程独立，不会污染本地 .wrangler/state 数据。
 */
import { env } from "cloudflare:test";
import { beforeAll } from "vitest";
import { sha256Hex } from "../src/auth.js";
import migration1Sql from "../migrations/0001_create_api_keys.sql?raw";
import migration2Sql from "../migrations/0002_create_request_logs.sql?raw";

// 与 v0.2 内存 Set 时期一致的 Beta Key，保证旧测试不破
const BETA_TEST_KEY = "sp_beta_test001";

beforeAll(async () => {
	// 1. 应用所有 migration（建表 + 索引，幂等）
	for (const sql of [migration1Sql, migration2Sql]) {
		const statements = sql
			.split(";")
			.map((chunk) =>
				chunk
					.split("\n")
					.filter((line) => !line.trim().startsWith("--"))
					.join("\n")
					.trim(),
			)
			.filter((s) => s.length > 0);

		for (const stmt of statements) {
			await env.StudyPulseDB.prepare(stmt).run();
		}
	}

	// 2. 种子 Beta Key：只存哈希，原始 Key 不进 DB
	const hash = await sha256Hex(BETA_TEST_KEY);
	await env.StudyPulseDB.prepare(
		`INSERT OR IGNORE INTO api_keys (key_hash, name, enabled)
		 VALUES (?, ?, 1)`,
	)
		.bind(hash, "Beta Test Key 001")
		.run();
});
