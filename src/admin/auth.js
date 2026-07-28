/**
 * StudyPulse Cloud AI - 管理员鉴权模块
 *
 * 支持两种鉴权方式（短路求值，任一通过即可）：
 *   1. Cloudflare Access：使用 Access 团队公钥校验 Cf-Access-Jwt-Assertion
 *      的签名、issuer 和 audience
 *   2. ADMIN_API_TOKEN Secret 降级：Authorization: Bearer <token>
 *
 * 安全措施：
 *   - ADMIN_API_TOKEN 通过 wrangler secret 注入，绝不暴露给前端 JS
 *   - 常量时间字符串比较防止时序攻击
 *   - 鉴权失败统一返回 401，不区分「未配置」与「Token 错误」
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

const BEARER_PREFIX = "Bearer ";

/**
 * 验证管理员身份。
 *
 * @param {Request} request
 * @param {{ ADMIN_API_TOKEN?: string, CF_ACCESS_TEAM_DOMAIN?: string, CF_ACCESS_AUDIENCE?: string, TEAM_DOMAIN?: string, POLICY_AUD?: string }} env - Worker 环境
 * @returns {Promise<boolean>} true = 管理员身份已验证
 */
export async function authenticateAdmin(request, env) {
	// 方式 1：Cloudflare Access
	const cfAccessJwt = request.headers.get("Cf-Access-Jwt-Assertion");
	if (cfAccessJwt && await verifyCloudflareAccessJwt(cfAccessJwt, env)) {
		console.log("[admin] Cloudflare Access JWT verified");
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

const accessJwksCache = new Map();

/**
 * 使用 Cloudflare Access 团队公钥验证 JWT。
 *
 * Cloudflare Access 只负责把 JWT 放入请求头，Worker 仍必须验证该 JWT，
 * 否则请求方可以伪造同名 header。公钥通过 JWKS 自动缓存并在轮换后刷新。
 *
 * 支持 CF_ACCESS_* 命名；TEAM_DOMAIN/POLICY_AUD 与 Cloudflare 官方示例兼容。
 *
 * @param {string} token
 * @param {{ CF_ACCESS_TEAM_DOMAIN?: string, CF_ACCESS_AUDIENCE?: string, TEAM_DOMAIN?: string, POLICY_AUD?: string }} env
 * @returns {Promise<boolean>}
 */
async function verifyCloudflareAccessJwt(token, env) {
	const teamDomain = normalizeHttpsOrigin(
		env.CF_ACCESS_TEAM_DOMAIN || env.TEAM_DOMAIN,
	);
	const audience = env.CF_ACCESS_AUDIENCE || env.POLICY_AUD;
	if (!teamDomain || !audience) {
		console.warn("[admin] Cloudflare Access JWT verification is not configured");
		return false;
	}

	try {
		let jwks = accessJwksCache.get(teamDomain);
		if (!jwks) {
			jwks = createRemoteJWKSet(
				new URL(`${teamDomain}/cdn-cgi/access/certs`),
			);
			accessJwksCache.set(teamDomain, jwks);
		}

		await jwtVerify(token, jwks, {
			issuer: teamDomain,
			audience,
			algorithms: ["RS256"],
		});
		return true;
	} catch (error) {
		console.warn(`[admin] Cloudflare Access JWT rejected: ${error?.code || "invalid"}`);
		return false;
	}
}

function normalizeHttpsOrigin(value) {
	if (typeof value !== "string" || !value) return null;

	try {
		const url = new URL(value);
		if (
			url.protocol !== "https:" ||
			url.pathname !== "/" ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		) {
			return null;
		}
		return url.origin;
	} catch {
		return null;
	}
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
