#!/usr/bin/env node
/**
 * 列出所有 API Key
 *
 * Usage:
 *   node scripts/list-api-keys.js [--local|--remote]
 *
 * 输出表格，故意不显示 key_hash 与原始 Key，避免误用。
 * 如需定位某条记录，用其它脚本的 raw-key 参数（内部会算哈希）。
 *
 * 默认操作远程 D1。
 */
const { parseTarget, queryD1, die } = require("./_common");

const { target } = parseTarget(process.argv.slice(2));

console.log(`[Target: ${target}]`);

const sql = `SELECT id, name, enabled, request_count, request_limit,
                    user_id, expires_at, created_at, last_used_at
               FROM api_keys
           ORDER BY id;`;

let rows;
try {
	rows = queryD1(sql, target);
} catch (err) {
	die(err.message);
}

if (rows.length === 0) {
	console.log("\n(no API keys found)");
	process.exit(0);
}

console.log(`\nFound ${rows.length} API key(s):\n`);

// 简单的 markdown 风格表格，便于阅读
console.log(
	"| id | name | enabled | count | limit | user_id | expires_at | created_at | last_used_at |",
);
console.log(
	"|----|------|---------|-------|-------|---------|------------|------------|--------------|",
);
for (const r of rows) {
	const enabled = r.enabled ? "yes" : "no";
	const limit =
		r.request_limit === null ? "unlimited" : String(r.request_limit);
	const userId = r.user_id || "-";
	const expires = r.expires_at || "-";
	const lastUsed = r.last_used_at || "never";
	console.log(
		`| ${r.id} | ${r.name} | ${enabled} | ${r.request_count} | ${limit} | ${userId} | ${expires} | ${r.created_at} | ${lastUsed} |`,
	);
}
