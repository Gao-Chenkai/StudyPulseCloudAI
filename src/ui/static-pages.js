import { applySecurityHeaders, generateCsrfToken } from "../admin/routes.js";

const ADMIN_CSRF_COOKIE = "admin_csrf";

export async function serveStaticPage(request, env, assetPath, options = {}) {
	if (!env.ASSETS) {
		return Response.json({ error: "Static assets binding is not configured" }, { status: 500 });
	}

	const assetUrl = new URL(request.url);
	assetUrl.pathname = assetPath;
	assetUrl.search = "";
	const assetRequest = new Request(assetUrl, {
		method: "GET",
		headers: request.headers,
	});
	const assetResponse = await env.ASSETS.fetch(assetRequest);
	if (!assetResponse.ok) return assetResponse;

	let body = assetResponse.body;
	if (options.replacements) {
		let html = await assetResponse.text();
		for (const [from, to] of Object.entries(options.replacements)) {
			html = html.replaceAll(from, to);
		}
		body = html;
	}

	const headers = new Headers(assetResponse.headers);
	headers.set("Content-Type", "text/html; charset=utf-8");
	headers.set("Cache-Control", "no-store");
	headers.set("X-Content-Type-Options", "nosniff");
	if (options.securityHeaders) applySecurityHeaders(headers);
	if (options.contentSecurityPolicy) headers.set("Content-Security-Policy", options.contentSecurityPolicy);

	return new Response(body, {
		status: assetResponse.status,
		statusText: assetResponse.statusText,
		headers,
	});
}

export async function serveAdminPage(request, env) {
	const csrfToken = generateCsrfToken();
	const secure = new URL(request.url).protocol === "https:";
	const response = await serveStaticPage(request, env, "/pages/admin/index.html", {
		securityHeaders: true,
		replacements: {
			"__CSRF_TOKEN__": csrfToken,
			"__HAS_CF_ACCESS__": request.headers.get("Cf-Access-Jwt-Assertion") ? "1" : "0",
		},
	});
	const headers = new Headers(response.headers);
	headers.append(
		"Set-Cookie",
		ADMIN_CSRF_COOKIE + "=" + csrfToken + "; Path=/api/admin; SameSite=Strict; Max-Age=3600" + (secure ? "; Secure" : ""),
	);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function authPageOptions() {
	return {
		contentSecurityPolicy: "default-src 'none'; style-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://auth.chenkai.space https://cloudflareinsights.com; form-action 'self'; base-uri 'none'",
	};
}
