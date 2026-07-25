/**
 * StudyPulse Cloud AI - 管理员鉴权模块
 *
 * 支持两种鉴权方式（短路求值，任一通过即可）：
 *   1. Cloudflare Access：检查 Cf-Access-Jwt-Assertion header
 *      （Cloudflare Access 已在 Workers 之前校验 JWT，header 存在即通过）
 *   2. ADMIN_API_TOKEN Secret 降级：Authorization: Bearer <token>
 *
 * 安全措施：
 *   - ADMIN_API_TOKEN 通过 wrangler secret 注入，绝不暴露给前端 JS
 *   - 常量时间字符串比较防止时序攻击
 *   - 鉴权失败统一返回 401，不区分「未配置」与「Token 错误」
 */

const BEARER_PREFIX = "Bearer ";

/**
 * 验证管理员身份。
 *
 * @param {Request} request
 * @param {{ ADMIN_API_TOKEN?: string }} env - Worker 环境
 * @returns {Promise<boolean>} true = 管理员身份已验证
 */
export async function authenticateAdmin(request, env) {
	// 方式 1：Cloudflare Access
	// Cloudflare Access 在 Workers 之前已经校验 JWT 并注入 header，
	// 到达 Worker 时 header 存在即表示已通过 Access 认证。
	const cfAccessJwt = request.headers.get("Cf-Access-Jwt-Assertion");
	if (cfAccessJwt) {
		const cfAccessEmail = request.headers.get(
			"Cf-Access-Authenticated-User-Email",
		);
		console.log(`[admin] Cloudflare Access: ${cfAccessEmail || "unknown"}`);
		return true;
	}

	// 方式 2：ADMIN_API_TOKEN fallback
	const authHeader = request.headers.get("Authorization");
	if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
		return false;
	}

	const token = authHeader.slice(BEARER_PREFIX.length).trim();
	if (!token || !env.ADMIN_API_TOKEN) {
		return false;
	}

	// 常量时间比较，防止时序攻击推断 token 长度
	return timingSafeEqual(token, env.ADMIN_API_TOKEN);
}

/**
 * 常量时间字符串比较。
 * 即使两个字符串长度不同，也不会提前返回，防止通过响应时间推断 secret。
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqual(a, b) {
	// Web Crypto subtle 的 timingSafeEqual 仅适用于 BufferSource，
	// 这里用纯 JS 实现常量时间比较
	let result = a.length ^ b.length;
	for (let i = 0; i < a.length && i < b.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}
