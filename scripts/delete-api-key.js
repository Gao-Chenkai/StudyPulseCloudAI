#!/usr/bin/env node
/**
 * 彻底删除某个 API Key（hard delete）
 *
 * Usage:
 *   node scripts/delete-api-key.js <raw-key> [--local|--remote]
 *
 * ⚠️  这是硬删除，历史记录无法恢复。
 *     如需临时停用请用 disable-api-key.js（enabled=0）。
 *
 * 通过原始 Key 计算 SHA-256 后定位记录，原始 Key 不进数据库。
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

if (!rawKey) {
	die(
		"Usage: node scripts/delete-api-key.js <raw-key> [--local|--remote]\n" +
			"  ⚠️  Hard delete. Use disable-api-key.js for soft delete.",
	);
}

console.log(`[Target: ${target}]`);
console.log(`⚠️  About to DELETE the API key permanently.`);

const hash = sha256Hex(rawKey);
const sql = `DELETE FROM api_keys WHERE key_hash = '${sqlEscape(hash)}' RETURNING id;`;

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

console.log("\n✓ API Key deleted.");
console.log(`  key_hash : ${hash}`);
console.log(`  rows     : ${changes}`);
