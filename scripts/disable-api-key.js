#!/usr/bin/env node
/**
 * 禁用某个 API Key（soft delete，保留记录便于审计）
 *
 * Usage:
 *   node scripts/disable-api-key.js <raw-key> [--local|--remote]
 *
 * 通过原始 Key 计算 SHA-256 后定位记录，原始 Key 不进数据库。
 * 如需彻底删除请用 delete-api-key.js。
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

if (!rawKey) {
	die(
		"Usage: node scripts/disable-api-key.js <raw-key> [--local|--remote]",
	);
}

console.log(`[Target: ${target}]`);

const hash = sha256Hex(rawKey);
const sql = `UPDATE api_keys SET enabled = 0 WHERE key_hash = '${sqlEscape(hash)}' RETURNING id;`;

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

console.log("\n✓ API Key disabled.");
console.log(`  key_hash : ${hash}`);
console.log(`  rows     : ${changes}`);
