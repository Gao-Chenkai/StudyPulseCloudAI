import { getAppealByToken, submitAppeal } from "./service.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function handleAppealPage(request, env, token) {
	const appeal = await getAppealByToken(token, env);
	const valid = appeal && appeal.ban_status === "active";
	const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>账号封禁申诉 - StudyPulse Cloud AI</title><style>body{margin:0;background:#f7f7f8;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial}main{max-width:560px;margin:60px auto;padding:40px;background:#fff;border-radius:16px;box-shadow:0 12px 40px #0000000d}h1{font-size:28px;margin:0 0 36px}h2{font-size:22px}label{display:block;margin:24px 0 8px;color:#555;font-size:14px}input,textarea{box-sizing:border-box;width:100%;padding:12px;border:1px solid #d4d4d8;border-radius:8px;font:inherit}textarea{min-height:150px;resize:vertical}button{margin-top:24px;border:0;border-radius:8px;padding:13px 22px;background:#10a37f;color:#fff;font-weight:600;cursor:pointer}.muted{color:#666;line-height:1.7}.error{color:#b42318}</style></head><body><main><h1>StudyPulse Cloud AI</h1>${valid ? `<h2>账号封禁申诉</h2><p class="muted">账号：${esc(appeal.email)}<br>封禁原因：${esc(appeal.reason)}</p>${appeal.appeal_id ? `<p class="muted">此申诉已提交，当前状态：${esc(appeal.status)}</p>` : `<form id="form"><label for="content">申诉说明</label><textarea id="content" maxlength="5000" required placeholder="请说明情况以及希望我们重新审核的原因"></textarea><button>提交申诉</button><p id="message" class="muted"></p></form>`}` : `<p class="error">申诉链接无效、已处理或已过期。</p>`}</main>${valid && !appeal.appeal_id ? `<script>document.getElementById('form').addEventListener('submit',async e=>{e.preventDefault();const m=document.getElementById('message');try{const r=await fetch('/api/appeals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(token)},content:document.getElementById('content').value})});const j=await r.json();if(!r.ok)throw new Error(j.error||'提交失败');m.textContent='申诉已提交，我们会尽快审核。';e.target.remove()}catch(err){m.className='error';m.textContent=err.message}})</script>` : ""}</body></html>`;
	return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

export async function handleSubmitAppeal(request, env) {
	let body;
	try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
	if (typeof body?.token !== "string" || typeof body?.content !== "string" || body.content.trim().length < 10) return Response.json({ error: "token and content are required" }, { status: 400 });
	const result = await submitAppeal(body.token, body.content, env);
	return Response.json(result.success ? result : { error: result.error }, { status: result.success ? 201 : result.status });
}
