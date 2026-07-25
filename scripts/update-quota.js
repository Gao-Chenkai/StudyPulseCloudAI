#!/usr/bin/env node
/**
 * 更新某个 API Key 的请求额度上限
 *
 * Usage:
 *   node scripts/update-quota.js <raw-key> <limit> [--local|--remote]
 *
 * limit 取值：
 *   - 正整数（如 500）：设为该上限
 *   - 'null'（字符串）：设为不限量
 *
 * 通过原始 Key 计算 SHA-256 后定位记录，原始 Key 不进数据库。
 * 仅修改 request_limit，不重置 request_count。
 *
 * 默认操作远程 D1。
 */
const {
	sha256Hex,
	parseTarget,
	sqlEscape,
	execD1,
	die,
} = require("./_common");

const { target, args } = parseTarget(process.argv.slice(2));
const rawKey = args[0];
const limitInput = args[1];

if (!rawKey || !limitInput) {
	die(
		"Usage: node scripts/update-quota.js <raw-key> <limit> [--local|--remote]\n" +
			"  limit: 正整数，或 'null' 表示不限量",
	);
}

// 解析额度：'null' -> NULL，否则需为非负整数
let limitSql;
let limitDisplay;
if (limitInput.toLowerCase() === "null") {
	limitSql = "NULL";
	limitDisplay = "NULL (unlimited)";
} else {
	const n = Number.parseInt(limitInput, 10);
	if (!Number.isInteger(n) || n < 0) {
		die(
			`Invalid limit: ${limitInput}. Must be a non-negative integer or 'null'.`,
		);
	}
	limitSql = String(n);
	limitDisplay = String(n);
}

console.log(`[Target: ${target}]`);

const hash = sha256Hex(rawKey);
const sql = `UPDATE api_keys SET request_limit = ${limitSql} WHERE key_hash = '${sqlEscape(hash)}' RETURNING id;`;

let changes;
try {
	changes = execD1(sql, target);
} catch (err) {
	die(err.message);
}

if (changes === 0) {
	die(
		`No API key matched the given raw key (target: ${target}).`,
	);
}

console.log("\n✓ API Key quota updated.");
console.log(`  key_hash      : ${hash}`);
console.log(`  request_limit : ${limitDisplay}`);
console.log(`  rows          : ${changes}`);
