#!/usr/bin/env node
/**
 * StudyPulse Cloud AI - 管理脚本共用工具
 *
 * 所有脚本通过 `wrangler d1 execute` CLI 操作 D1，不直接连数据库文件。
 * 原始 API Key 永远不进数据库，脚本内通过 SHA-256 哈希定位记录。
 *
 * 默认操作远程 D1（--remote），加 --local 操作本地开发库。
 * 管理脚本的典型场景是管生产数据，故以 remote 为默认。
 */

const { spawnSync } = require("child_process");
const crypto = require("crypto");

// wrangler.jsonc 里的 D1 数据库名（不是 binding 名）
const DB_NAME = "studypulse-cloud-ai-db";

/**
 * 计算字符串的 SHA-256 hex 摘要。
 * 必须与 Worker 端 src/auth.js 的 sha256Hex 行为完全一致。
 */
function sha256Hex(text) {
	return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * 解析命令行参数，识别 --local / --remote 标志。
 * 其余位置参数原样保留。
 * 默认 target = remote（管理脚本典型场景是管生产数据）。
 *
 * @returns {{ target: 'remote' | 'local', args: string[] }}
 */
function parseTarget(argv) {
	const args = [];
	let target = "remote";
	for (const a of argv) {
		if (a === "--local") target = "local";
		else if (a === "--remote") target = "remote";
		else args.push(a);
	}
	return { target, args };
}

/**
 * 转义 SQL 字符串字面量中的单引号。
 * D1 execute 不支持参数化查询，只能拼字符串，需手动转义。
 */
function sqlEscape(s) {
	return String(s).replace(/'/g, "''");
}

/**
 * 调用 wrangler d1 execute，返回原始 JSON 输出数组。
 * @param {string} sql
 * @param {'remote'|'local'} target
 * @returns {Array<{results: any[], success: boolean, meta: any}>}
 */
function runD1(sql, target) {
	const flag = target === "local" ? "--local" : "--remote";
	const result = spawnSync(
		"npx",
		[
			"wrangler",
			"d1",
			"execute",
			DB_NAME,
			flag,
			"--command",
			sql,
			"--json",
		],
		{ encoding: "utf8" },
	);

	if (result.error) {
		// npx 未找到等系统级错误
		throw new Error(`Failed to spawn wrangler: ${result.error.message}`);
	}
	if (result.status !== 0) {
		process.stderr.write(result.stderr || result.stdout);
		throw new Error(
			`wrangler d1 execute failed (exit ${result.status})`,
		);
	}

	const out = result.stdout.trim();
	if (!out) return [];
	try {
		return JSON.parse(out);
	} catch {
		// 非 JSON 输出（罕见），返回空让上层兜底
		return [];
	}
}

/**
 * SELECT 查询：返回行数组。
 */
function queryD1(sql, target) {
	const entries = runD1(sql, target);
	return entries[0]?.results || [];
}

/**
 * INSERT / UPDATE / DELETE：返回影响行数。
 *
 * ⚠️  wrangler d1 execute 的 meta 不返回 changes 字段（只有 duration），
 *     无法直接拿到影响行数。因此约定：所有写 SQL 必须带 `RETURNING id`，
 *     本函数通过 results 数组长度推算匹配行数。
 *     （SQLite 3.35+ / D1 支持 RETURNING）
 */
function execD1(sql, target) {
	const entries = runD1(sql, target);
	return (entries[0]?.results || []).length;
}

/**
 * 打印错误并退出。
 */
function die(msg) {
	console.error(`Error: ${msg}`);
	process.exit(1);
}

module.exports = {
	DB_NAME,
	sha256Hex,
	parseTarget,
	sqlEscape,
	runD1,
	queryD1,
	execD1,
	die,
};
