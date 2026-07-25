#!/usr/bin/env node
/**
 * 创建新的 API Key
 *
 * Usage:
 *   node scripts/create-api-key.js <name> [--local|--remote]
 *
 * 流程：
 *   1. 生成 sp_beta_ + 20 位随机 hex（共 28 字符，熵足够）
 *   2. 计算 SHA-256
 *   3. INSERT 到 D1（只存哈希，不存原始 Key）
 *   4. 打印原始 Key（仅此一次）+ 哈希 + SQL
 *
 * 默认操作远程 D1。
 */
const crypto = require("crypto");
const {
	sha256Hex,
	parseTarget,
	sqlEscape,
	execD1,
	die,
} = require("./_common");

const { target, args } = parseTarget(process.argv.slice(2));
const name = args[0];

if (!name) {
	die("Usage: node scripts/create-api-key.js <name> [--local|--remote]");
}

console.log(`[Target: ${target}]`);

// 生成 sp_beta_ + 20 位随机 hex
const rawKey = "sp_beta_" + crypto.randomBytes(10).toString("hex");
const hash = sha256Hex(rawKey);

const sql = `INSERT INTO api_keys (key_hash, name, enabled, request_count, request_limit) VALUES ('${sqlEscape(hash)}', '${sqlEscape(name)}', 1, 0, NULL) RETURNING id;`;

let changes;
try {
	changes = execD1(sql, target);
} catch (err) {
	die(err.message);
}

if (changes === 0) {
	die("INSERT affected 0 rows (unexpected).");
}

console.log("\n✓ API Key created successfully\n");
console.log(`Raw key  : ${rawKey}`);
console.log(`SHA-256  : ${hash}`);
console.log(`Name     : ${name}`);
console.log(`\n⚠️  Raw key 仅此一次显示，请立即交付给用户并安全保存。`);
console.log(`\nExecuted SQL:`);
console.log(`  ${sql}`);
