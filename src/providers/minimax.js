/**
 * StudyPulse Cloud AI - AI Provider: MiniMax-M3
 *
 * 通过 MiniMax 官方 OpenAI 兼容接口调用 MiniMax-M3。
 * 官方文档：https://platform.minimaxi.com/
 *
 * 关键配置（按需求）：
 *   - 模型：MiniMax-M3（原生多模态，支持文本/图片/视频输入）
 *   - 多模态：M3 原生支持，messages.content 既可传字符串，
 *            也可传 OpenAI 风格的 content 数组
 *            （{type:"text"} / {type:"image_url"} / {type:"video_url"}）
 *   - Thinking：关闭（thinking.type = "disabled"）
 *
 * Secret 通过 env 注入，绝不硬编码：
 *   wrangler secret put MINIMAX_API_KEY
 *   本地开发写到 .dev.vars
 */

// MiniMax OpenAI 兼容 Chat Completions 端点（国内版：api.minimaxi.com）
const MINIMAX_CHAT_URL = "https://api.minimaxi.com/v1/chat/completions";

// 模型名
const MODEL = "MiniMax-M3";

/**
 * 调用 MiniMax-M3 Chat Completions。
 *
 * @param {Array} messages - OpenAI 风格消息数组，content 可为字符串或多模态数组
 * @param {{ MINIMAX_API_KEY: string }} env - Worker 环境，必须包含 MINIMAX_API_KEY
 * @returns {Promise<string>} 模型回复文本
 * @throws {Error} 上游非 2xx 或返回结构异常时抛出，由调用方转成 502
 */
export async function chat(messages, env) {
	const response = await fetch(MINIMAX_CHAT_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${env.MINIMAX_API_KEY}`,
		},
		body: JSON.stringify({
			model: MODEL,
			messages,
			// 关闭 Thinking：M3 默认开启思考，显式 disabled 后直接给最终回复
			thinking: { type: "disabled" },
		}),
	});

	// 上游错误：抛错交由 index.js 统一转 502
	if (!response.ok) {
		const errText = await response.text().catch(() => "");
		throw new Error(
			`MiniMax API error ${response.status}: ${errText.slice(0, 200)}`,
		);
	}

	const data = await response.json();

	// OpenAI 标准返回结构：choices[0].message.content
	const reply = data?.choices?.[0]?.message?.content;
	if (typeof reply !== "string") {
		throw new Error("MiniMax API returned unexpected shape");
	}

	// 返回回复文本和 token 用量，供 index.js 写入 request_logs
	return {
		reply,
		usage: data?.usage ?? null,
	};
}

/**
 * 调用 MiniMax-M3 Chat Completions（流式 SSE）。
 *
 * 与 chat() 的差异：
 *   1. 请求体增加 "stream": true
 *   2. 返回原始 fetch Response，body 为 SSE ReadableStream
 *   3. 上游错误仍然抛 Error（由调用方在流开始前捕获）
 *   4. index.js 负责包装 ReadableStream、提取 usage、计次、写日志
 *
 * @param {Array} messages - OpenAI 风格消息数组
 * @param {{ MINIMAX_API_KEY: string }} env - Worker 环境
 * @returns {Promise<Response>} 上游原始 Response（body 可读流）
 * @throws {Error} 上游非 2xx 时抛出，由调用方转 502
 */
export async function chatStream(messages, env) {
	const response = await fetch(MINIMAX_CHAT_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${env.MINIMAX_API_KEY}`,
		},
		body: JSON.stringify({
			model: MODEL,
			messages,
			stream: true,
			// 请求在流中返回 token 用量（最后一个非 [DONE] chunk 包含 usage 字段）
			stream_options: { include_usage: true },
			// 关闭 Thinking：M3 默认开启思考，显式 disabled 后直接给最终回复
			thinking: { type: "disabled" },
		}),
	});

	// 上游非 2xx：读错误正文后抛错，交由 index.js 统一处理
	if (!response.ok) {
		const errText = await response.text().catch(() => "");
		throw new Error(
			`MiniMax API error ${response.status}: ${errText.slice(0, 200)}`,
		);
	}

	// 返回原始 Response，body 是 SSE ReadableStream
	// index.js 将创建包装流来提取 usage 并做 post-processing
	return response;
}
