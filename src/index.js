/**
 * StudyPulse Cloud AI - Worker 入口
 *
 * v0.5：主机名路由
 *   - admin.chenkai.space  → 管理后台（WebUI + API）
 *   - spapi.chenkai.space  → 公开 AI API（健康检查 + /v1/chat）
 *   - localhost（开发）     → 路径路由（兼容旧行为，全部可访问）
 *
 * 目录结构：
 *   src/
 *    ├── index.js              路由 + 请求处理
 *    ├── auth.js               API Key 鉴权（公开 API）
 *    ├── providers/minimax.js  AI 调用（MiniMax-M3，OpenAI 兼容协议）
 *    ├── database/api_keys.js  额度自增
 *    └── admin/
 *         ├── auth.js          管理员鉴权
 *         ├── database.js      管理后台 D1 操作
 *         ├── routes.js        管理后台 API 路由
 *         └── ui.js            管理后台 WebUI
 */

import { authenticate } from "./auth.js";
import { chat as minimaxChat, chatStream as minimaxChatStream } from "./providers/minimax.js";
import { incrementApiKeyUsage } from "./database/api_keys.js";
import { handleAdminApi } from "./admin/routes.js";
import { serveAdminPage } from "./admin/ui.js";
import { writeRequestLog } from "./admin/database.js";

// 服务元信息
const SERVICE_META = {
	service: "StudyPulse Cloud AI",
	version: "0.5-beta-github",
};

// 生产环境自定义域名
const SPAPI_HOSTNAME = "spapi.chenkai.space";
const ADMIN_HOSTNAME = "admin.chenkai.space";

/**
 * Worker 默认导出（Cloudflare Workers 标准格式）
 */
export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const { pathname } = url;
		const method = request.method.toUpperCase();
		const hostname = url.hostname;

		// ── 管理后台子域名：仅 admin.chenkai.space ──
		if (hostname === ADMIN_HOSTNAME) {
			return handleAdmin(request, env, ctx, pathname, method);
		}

		// ── 公开 API 子域名：仅 spapi.chenkai.space ──
		if (hostname === SPAPI_HOSTNAME) {
			return handlePublicApi(request, env, ctx, pathname, method);
		}

		// ── 本地开发 & Workers.dev 调试：路径路由（兼容全部功能）──
		if (
			hostname === "localhost" ||
			hostname.startsWith("127.0.0.1") ||
			hostname.endsWith(".workers.dev")
		) {
			if (
				pathname.startsWith("/api/admin/") ||
				pathname.startsWith("/admin")
			) {
				return handleAdmin(request, env, ctx, pathname, method);
			}
			return handlePublicApi(request, env, ctx, pathname, method);
		}

		// ── 未知主机名 → 404 ──
		return Response.json({ error: "Not Found" }, { status: 404 });
	},
};

// ────────────────────────────────────────────────────────────────────────────
// 管理后台路由（仅 admin.chenkai.space 可访问）
// ────────────────────────────────────────────────────────────────────────────

function handleAdmin(request, env, ctx, pathname, method) {
	// 管理后台 WebUI
	if ((pathname === "/admin" || pathname === "/admin/") && method === "GET") {
		return serveAdminPage(request, env);
	}

	// 管理后台 API
	if (pathname.startsWith("/api/admin/")) {
		return handleAdminApi(request, env, pathname);
	}

	return Response.json({ error: "Not Found" }, { status: 404 });
}

// ────────────────────────────────────────────────────────────────────────────
// 公开 API 路由（仅 spapi.chenkai.space 可访问）
// ────────────────────────────────────────────────────────────────────────────

function handlePublicApi(request, env, ctx, pathname, method) {
	// 健康检查
	if (pathname === "/" && method === "GET") {
		return handleHealth();
	}

	// AI 聊天接口
	if (pathname === "/v1/chat" && method === "POST") {
		return handleChat(request, env, ctx);
	}

	// 其余路径（包括 /admin）→ 404
	return Response.json({ error: "Not Found" }, { status: 404 });
}

// ────────────────────────────────────────────────────────────────────────────
// 健康检查
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET / 健康检查
 */
function handleHealth() {
	return Response.json({
		success: true,
		...SERVICE_META,
		status: "online",
	});
}

// ────────────────────────────────────────────────────────────────────────────
// POST /v1/chat
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /v1/chat
 *
 * 流程：鉴权 -> 校验 Secret -> 解析 Body -> 调用 MiniMax -> 计次 -> 写日志 -> 返回回复
 *
 * Body 支持两种形态（多模态向后兼容）：
 *   1. 纯文本：      { "message": "你好" }
 *   2. 多模态数组：  { "content": [...] }
 *   同时存在时 content 优先；两者都缺则视为空文本。
 *
 * 错误码：
 *   400  Invalid JSON Body        Body 非合法 JSON
 *   401  Missing API Key          未带 Authorization
 *   403  Invalid API Key          Key 无效 / Key 已禁用
 *   429  API quota exceeded       请求次数已达上限
 *   500  Server not configured    未配置 MINIMAX_API_KEY
 *   502  AI request failed        上游 AI 调用失败
 *
 * 额度规则：仅在 MiniMax 调用成功后才自增 request_count。
 *           鉴权失败、上游失败、内部错误一律不计次。
 * 日志规则：成功或失败都写 request_logs（通过 ctx.waitUntil 异步不阻塞响应）。
 */
async function handleChat(request, env, ctx) {
	const startTime = Date.now();
	const clientIp = request.headers.get("CF-Connecting-IP") || "";
	const clientUa = request.headers.get("User-Agent") || "";

	// 1. API Key 鉴权（含 enabled 与额度校验，详见 src/auth.js）
	const auth = await authenticate(request, env);
	if (!auth.ok) {
		return auth.response;
	}
	const { apiKey } = auth;

	// 2. 校验 Worker Secret 是否已注入
	if (!env || !env.MINIMAX_API_KEY) {
		return Response.json(
			{ error: "Server not configured: MINIMAX_API_KEY missing" },
			{ status: 500 },
		);
	}

	// 3. 解析 Body
	let body;
	try {
		body = await request.json();
	} catch {
		return Response.json(
			{ error: "Invalid JSON Body" },
			{ status: 400 },
		);
	}

	// 4. 组装 user 消息：多模态 content 数组优先，其次纯文本 message
	let userContent;
	if (Array.isArray(body?.content)) {
		userContent = body.content;
	} else {
		userContent =
			typeof body?.message === "string" ? body.message : "";
	}

	const messages = [{ role: "user", content: userContent }];

	// 5. 流式分支：body.stream === true 时走 SSE 流式传输
	if (body.stream === true) {
		return handleChatStream(request, env, ctx, apiKey, messages);
	}

	// 6. 调用 AI Provider（非流式）
	let result;
	const model = "MiniMax-M3";
	const provider = "minimax";

	try {
		result = await minimaxChat(messages, env);
	} catch (err) {
		// 上游 AI 调用失败 -> 502
		// 错误细节输出到 stderr，响应体只返回通用提示
		console.error("AI provider error:", err?.message || err);

		// 异步写失败日志（不阻塞响应）
		const latency = Date.now() - startTime;
		ctx.waitUntil(
			writeRequestLog(env, {
				api_key_id: apiKey.id,
				model,
				provider,
				status: 502,
				latency_ms: latency,
				ip: clientIp,
				user_agent: clientUa,
				error_message: (err?.message || "Unknown error").slice(0, 500),
			}).catch((e) => console.error("Failed to write error log:", e?.message || e)),
		);

		return Response.json(
			{ error: "AI request failed" },
			{ status: 502 },
		);
	}

	const { reply, usage } = result;

	// 7. 上游成功，自增额度计数并刷新 last_used_at
	try {
		await incrementApiKeyUsage(env, apiKey.id, usage?.total_tokens);
	} catch (err) {
		console.error("Failed to increment API key usage:", err?.message || err);
	}

	// 8. 异步写成功日志（不阻塞响应）
	const latency = Date.now() - startTime;
	ctx.waitUntil(
		writeRequestLog(env, {
			api_key_id: apiKey.id,
			model,
			provider,
			status: 200,
			latency_ms: latency,
			ip: clientIp,
			user_agent: clientUa,
			prompt_tokens: usage?.prompt_tokens ?? null,
			completion_tokens: usage?.completion_tokens ?? null,
			total_tokens: usage?.total_tokens ?? null,
		}).catch((e) => console.error("Failed to write request log:", e?.message || e)),
	);

	// 9. 返回模型回复
	return Response.json({
		success: true,
		data: {
			reply,
		},
	});
}

// ────────────────────────────────────────────────────────────────────────────
// POST /v1/chat (stream: true) — SSE 流式传输
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /v1/chat 流式分支
 *
 * 与 handleChat 共享鉴权、Secret 校验、Body 解析和消息组装。
 * 差异在于 AI 调用和响应格式：
 *   - 调用 minimaxChatStream() 获取上游 SSE ReadableStream
 *   - 维护 buffer 按 "\n\n" 分割完整 SSE 事件（避免网络分片导致数据丢失）
 *   - 透传 MiniMax 原始 SSE 格式给客户端
 *   - 从最后一个含 usage 的非 [DONE] chunk 提取 token 数据
 *   - 流结束后通过 ctx.waitUntil 异步执行计次和日志
 *   - 检测客户端断开（request.signal "abort"），中止时不计数
 *   - usage 缺失时仍正常计次，日志标记 error_message="usage_missing"
 *
 * @param {Request} request
 * @param {object} env
 * @param {ExecutionContext} ctx
 * @param {object} apiKey - 已鉴权的 API Key D1 记录
 * @param {Array} messages - 已组装的消息数组
 * @returns {Promise<Response>} SSE 流式响应或错误 JSON
 */
async function handleChatStream(request, env, ctx, apiKey, messages) {
	const startTime = Date.now();
	const clientIp = request.headers.get("CF-Connecting-IP") || "";
	const clientUa = request.headers.get("User-Agent") || "";
	const model = "MiniMax-M3";
	const provider = "minimax";

	// 1. 发起上游流式请求
	let upstreamResponse;
	try {
		upstreamResponse = await minimaxChatStream(messages, env);
	} catch (err) {
		// 上游连接失败 → 502（流尚未开始，可返回 JSON）
		console.error("AI provider stream error:", err?.message || err);
		const latency = Date.now() - startTime;
		ctx.waitUntil(
			writeRequestLog(env, {
				api_key_id: apiKey.id,
				model,
				provider,
				status: 502,
				latency_ms: latency,
				ip: clientIp,
				user_agent: clientUa,
				error_message: (err?.message || "Unknown error").slice(0, 500),
			}).catch((e) => console.error("Failed to write error log:", e?.message || e)),
		);
		return Response.json(
			{ error: "AI request failed" },
			{ status: 502 },
		);
	}

	const reader = upstreamResponse.body.getReader();
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();

	// SSE 事件缓冲区：按 "\n\n" 分割完整事件，尾部残留留在 buffer 中
	let buffer = "";
	// 最后一个包含 usage 的 SSE data JSON 字符串
	let lastUsageEvent = null;
	// 客户端是否已断开
	let aborted = false;

	// 监听客户端断开
	request.signal.addEventListener("abort", () => {
		aborted = true;
		reader.cancel().catch(() => {});
	});

	/**
	 * 处理单个完整 SSE 事件：
	 *   - 追踪含 usage 的事件，供流结束后计次使用
	 *   - 透传完整事件给客户端
	 * @param {string} event - 以 "\n\n" 分隔的完整 SSE 事件（不含尾部 "\n\n"）
	 * @param {ReadableStreamDefaultController} controller
	 */
	function processEvent(event, controller) {
		// 提取 data: 行，追踪含 usage 的事件
		const dataLine = event
			.split("\n")
			.find((line) => line.startsWith("data: "));
		if (dataLine) {
			const json = dataLine.slice(6);
			if (json !== "[DONE]") {
				try {
					const parsed = JSON.parse(json);
					if (parsed.usage) {
						lastUsageEvent = json;
					}
				} catch {
					/* 非 JSON 行忽略 */
				}
			}
		}
		// 透传完整 SSE 事件（还原 "\n\n" 分隔符）
		controller.enqueue(encoder.encode(event + "\n\n"));
	}

	/**
	 * 将新到达的字节追加到 buffer，按 "\n\n" 分割完整事件并逐个处理。
	 * 尾部未完成的部分保留在 buffer 中。
	 * @param {ReadableStreamDefaultController} controller
	 */
	function processBuffer(controller) {
		const parts = buffer.split("\n\n");
		// 最后一段是尾部残留，放回 buffer
		buffer = parts.pop();

		for (const event of parts) {
			processEvent(event, controller);
		}
	}

	const wrapped = new ReadableStream({
		async pull(controller) {
			if (aborted) {
				reader.cancel().catch(() => {});
				controller.close();
				return;
			}

			let done;
			let value;

			try {
				({ done, value } = await reader.read());
			} catch (err) {
				// 流读取出错 → 不计次，异步写失败日志
				console.error("Stream read error:", err?.message || err);
				const latency = Date.now() - startTime;
				ctx.waitUntil(
					writeRequestLog(env, {
						api_key_id: apiKey.id,
						model,
						provider,
						status: 502,
						latency_ms: latency,
						ip: clientIp,
						user_agent: clientUa,
						error_message: (err?.message || "Stream read error").slice(0, 500),
					}).catch((e) => console.error("Failed to write error log:", e?.message || e)),
				);
				controller.error(err);
				return;
			}

			// 1. 先处理 value（done === true 时 value 通常为 undefined，
			//    但防御性处理：即使 done 为 true 也先解码可能附带的数据）
			if (value) {
				buffer += decoder.decode(value, { stream: true });
				processBuffer(controller);
			}

			if (done) {
				// 2. 流结束：flush TextDecoder 内部缓存
				//    decode() 无参数 → stream: false，flush 所有内部缓冲的
				//    不完整多字节序列，确保最后几个字节不丢失
				buffer += decoder.decode();
				processBuffer(controller);

				// 3. 处理 buffer 中最后残留的内容（可能不以 \n\n 结尾）
				if (buffer.trim()) {
					processEvent(buffer, controller);
				}

				// 4. 提取 usage
				let usage = null;
				if (lastUsageEvent) {
					try {
						usage = JSON.parse(lastUsageEvent).usage;
					} catch {
						/* JSON 解析失败视为无 usage */
					}
				}

				// 5. post-processing：计次 + 写日志（异步，不阻塞流关闭）
				const latency = Date.now() - startTime;
				const logEntry = {
					api_key_id: apiKey.id,
					model,
					provider,
					status: 200,
					latency_ms: latency,
					ip: clientIp,
					user_agent: clientUa,
					prompt_tokens: usage?.prompt_tokens ?? null,
					completion_tokens: usage?.completion_tokens ?? null,
					total_tokens: usage?.total_tokens ?? null,
				};

				if (!usage) {
					// usage 缺失：仍计入次数（防止绕过），但标记异常
					logEntry.error_message = "usage_missing";
					console.warn(
						`Stream completed but usage missing for api_key_id=${apiKey.id}`,
					);
				}

				ctx.waitUntil(
					Promise.all([
						incrementApiKeyUsage(env, apiKey.id, usage?.total_tokens),
						writeRequestLog(env, logEntry),
					]).catch((e) =>
						console.error("Stream post-processing error:", e?.message || e),
					),
				);

				controller.close();
				return;
			}
		},

		cancel() {
			aborted = true;
			reader.cancel().catch(() => {});
		},
	});

	return new Response(wrapped, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}
