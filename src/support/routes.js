import { authenticateRequest, requireSessionAuth } from "../auth/middleware.js";
import { sendVerificationCode, verifyCode } from "../auth/email.js";
import { createSession } from "../auth/session.js";
import { getUserById } from "../users/users.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export function handleSupportPage() {
  const html = SUPPORT_HTML
    .replaceAll('<div class="mark">S</div>', '<img class="mark" src="/StudyPulseLogo.png" alt="StudyPulse Logo" style="object-fit:cover">');
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

export async function handleSupportSendCode(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const result = await sendVerificationCode(email, env, "login");
  if (!result.success) return json({ error: result.error === "Please wait before requesting a new code" ? "请稍后再试" : result.error === "Email delivery failed" ? "验证码发送失败" : result.error }, result.error === "Please wait before requesting a new code" ? 429 : 400);
  return json({ success: true });
}

export async function handleSupportVerifyCode(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  // verifyCode consumes the code and resolves the existing user (or creates
  // the same account identity as the legacy login flow), returning userId.
  const result = await verifyCode(email, code, env, "login");
  if (!result.success) return json({ error: "验证码无效或已过期" }, 400);
  const session = await createSession(result.userId, env);
  const user = await getUserById(result.userId, env);
  if (user?.status === "banned") return json({ error: "账号已被暂停" }, 403);
  return json({ success: true, data: { token: session.token, user: { id: user.id, email: user.email }, membership_type: user.membership_type } });
}

export async function handleSupportMe(request, env) {
  const auth = await requireSessionAuth(request, env); if (!auth.ok) return auth.response;
  const user = await getUserById(auth.userId, env); if (!user) return json({ error: "用户不存在" }, 404);
  return json({ success: true, data: { id: user.id, email: user.email, membership_type: user.membership_type, membership_expires_at: user.membership_expires_at } });
}

function effectivePlan(user) {
  if (user.membership_type !== "free" && user.membership_expires_at && new Date() >= new Date(user.membership_expires_at)) return "free";
  return user.membership_type;
}

export async function handleListTickets(request, env) {
  const auth = await requireSessionAuth(request, env); if (!auth.ok) return auth.response;
  const user = await getUserById(auth.userId, env); if (!user) return json({ error: "用户不存在" }, 404);
  const result = await env.StudyPulseDB.prepare(`SELECT id,subject,content,priority,status,admin_reply,created_at,processed_at FROM feedback_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`).bind(auth.userId).all();
  return json({ success: true, data: { user: { email: user.email, membership_type: effectivePlan(user) }, tickets: result.results } });
}

export async function handleCreateTicket(request, env) {
  const auth = await requireSessionAuth(request, env); if (!auth.ok) return auth.response;
  const user = await getUserById(auth.userId, env); if (!user) return json({ error: "用户不存在" }, 404);
  if (user.status === "banned") return json({ error: "账号已被暂停" }, 403);
  let body; try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 120) : "";
  const content = typeof body?.content === "string" ? body.content.trim().slice(0, 5000) : "";
  const priority = ["normal", "urgent", "top"].includes(body?.priority) ? body.priority : "normal";
  if (!subject || !content) return json({ error: "请填写主题和反馈内容" }, 400);
  if (priority === "top" && effectivePlan(user) !== "pro") return json({ error: "仅 Pro 用户可以提交顶级工单" }, 403);
  const id = crypto.randomUUID();
  await env.StudyPulseDB.prepare(`INSERT INTO feedback_tickets (id,user_id,subject,content,priority) VALUES (?,?,?,?,?)`).bind(id, auth.userId, subject, content, priority).run();
  return json({ success: true, data: { id } }, 201);
}

const SUPPORT_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>异常反馈 · StudyPulse</title><style>
:root{--blue:#2563eb;--ink:#111827;--muted:#64748b;--line:#e5e7eb;--soft:#f8fafc;--red:#dc2626;--green:#059669}*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}.wrap{max-width:1120px;margin:auto;padding:30px 24px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:30px}.brand{display:flex;gap:11px;align-items:center;font-weight:700}.mark{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,#2563eb,#60a5fa);color:white;font-size:20px}.brand small{display:block;color:#94a3b8;font-size:11px;font-weight:500}.user{color:var(--muted)}h1{font-size:28px;letter-spacing:-.04em;margin:0 0 7px}.lead{color:var(--muted);margin:0 0 24px}.grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr);gap:20px}.card{background:white;border:1px solid var(--line);border-radius:16px;padding:24px;box-shadow:0 8px 24px #0f172a08}.card h2{margin:0 0 5px;font-size:18px}.hint{color:var(--muted);font-size:13px;margin:0 0 18px}label{display:block;font-size:13px;font-weight:650;margin:16px 0 7px}input,textarea,select{width:100%;border:1px solid #dbe1ea;border-radius:9px;padding:11px 12px;font:inherit;color:inherit;background:#fff}textarea{min-height:150px;resize:vertical}.row{display:grid;grid-template-columns:1fr 180px;gap:12px}.btn{border:0;border-radius:9px;padding:11px 17px;font-weight:650;cursor:pointer}.primary{background:var(--blue);color:white}.ghost{background:white;border:1px solid var(--line);color:var(--ink)}.btn:disabled{opacity:.5;cursor:not-allowed}.actions{display:flex;gap:10px;align-items:center;margin-top:20px}.msg{font-size:13px;color:var(--muted)}.error{color:var(--red)}.login{max-width:440px;margin:12vh auto}.ticket{padding:18px 0;border-top:1px solid var(--line)}.ticket:first-child{border-top:0;padding-top:0}.ticket-head{display:flex;justify-content:space-between;gap:12px}.ticket h3{font-size:15px;margin:0 0 4px}.ticket p{white-space:pre-wrap;color:#475569;margin:7px 0}.meta{color:#94a3b8;font-size:12px}.pill{display:inline-block;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:650;white-space:nowrap}.normal{background:#eef2ff;color:#4f46e5}.urgent{background:#fff7ed;color:#c2410c}.top{background:#fef2f2;color:#b91c1c}.pending{background:#eff6ff;color:#2563eb}.processed{background:#ecfdf5;color:#047857}.reply{border-left:3px solid #34d399;background:#f0fdf4;padding:10px 12px;margin-top:12px;color:#166534;white-space:pre-wrap}.hidden{display:none}@media(max-width:800px){.grid{grid-template-columns:1fr}.row{grid-template-columns:1fr}.wrap{padding:20px 15px}.top{align-items:flex-start}.user{font-size:12px;text-align:right}}
</style></head><body><div class="wrap"><div id="loginView" class="login card"><div class="brand"><div class="mark">S</div><div>StudyPulse<small>Cloud AI · Support</small></div></div><h1 style="margin-top:30px">异常反馈</h1><p class="lead">登录后提交反馈，并跟踪处理进度。</p><div id="loginForm"><label>邮箱</label><input id="email" type="email" autocomplete="email" placeholder="you@example.com"><label>密码登录</label><input id="password" type="password" autocomplete="current-password" placeholder="输入账号密码"><div class="actions"><button class="btn primary" onclick="loginPassword()">密码登录</button><button class="btn ghost" onclick="toggleCode()">验证码登录</button></div></div><div id="codeForm" class="hidden"><label>邮箱</label><input id="codeEmail" type="email" placeholder="you@example.com"><div class="actions"><button class="btn ghost" onclick="sendCode()">发送验证码</button><input id="code" inputmode="numeric" maxlength="6" placeholder="6 位验证码"></div><button class="btn primary" style="margin-top:12px" onclick="loginCode()">验证码登录</button><p class="hint" style="margin-top:16px">没有账号？可在主站完成注册后登录。</p></div><p id="loginMsg" class="msg"></p></div><div id="appView" class="hidden"><div class="top"><div class="brand"><div class="mark">S</div><div>StudyPulse<small>Cloud AI · Support</small></div></div><div class="user"><span id="userEmail"></span> · <button class="btn ghost" style="padding:6px 10px" onclick="logout()">退出</button></div></div><h1>异常反馈</h1><p class="lead">提交后，管理团队会按优先级和提交时间处理。</p><div class="grid"><section class="card"><h2>新建反馈工单</h2><p class="hint">请尽量描述复现步骤、发生时间和期望结果。</p><form onsubmit="createTicket(event)"><div class="row"><div><label>主题</label><input id="subject" maxlength="120" required placeholder="例如：对话页面无法加载"></div><div><label>优先级</label><select id="priority"><option value="normal">普通</option><option value="urgent">紧急</option><option value="top">顶级 · Pro 专享</option></select></div></div><label>反馈内容</label><textarea id="content" maxlength="5000" required placeholder="请描述遇到的异常..."></textarea><div class="actions"><button class="btn primary">提交工单</button><span id="ticketMsg" class="msg"></span></div></form></section><section class="card"><h2>我的反馈</h2><p class="hint">处理完成后会在这里显示处理内容。</p><div id="ticketList"><p class="msg">加载中...</p></div></section></div></div></div><script>
const API='';let token=localStorage.getItem('sp_support_token');const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const date=s=>new Date(String(s).replace(' ','T')+'Z').toLocaleString('zh-CN',{hour12:false});async function api(path,opts={}){opts.headers={'Content-Type':'application/json',...(opts.headers||{}),...(token?{Authorization:'Bearer '+token}:{})};const r=await fetch(API+path,opts);const j=await r.json();if(!r.ok)throw Error(j.error||j.message||'请求失败');return j}function msg(id,text,bad=false){$(id).textContent=text;$(id).className='msg'+(bad?' error':'')}function toggleCode(){ $('loginForm').classList.add('hidden');$('codeForm').classList.remove('hidden');$('codeEmail').value=$('email').value}async function sendCode(){try{await api('/api/support/auth/send-code',{method:'POST',body:JSON.stringify({email:$('codeEmail').value})});msg('loginMsg','验证码已发送，请查收邮箱')}catch(e){msg('loginMsg',e.message,true)}}async function loginCode(){try{const j=await api('/api/support/auth/verify-code',{method:'POST',body:JSON.stringify({email:$('codeEmail').value,code:$('code').value})});token=j.data.token;localStorage.setItem('sp_support_token',token);showApp(j.data.user)}catch(e){msg('loginMsg',e.message,true)}}async function loginPassword(){try{const j=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('email').value,password:$('password').value})});token=j.data.session_token;localStorage.setItem('sp_support_token',token);showApp(j.data.user)}catch(e){msg('loginMsg',e.message,true)}}async function showApp(user){$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('userEmail').textContent=user.email;loadTickets()}async function boot(){if(!token)return;try{const j=await api('/api/support/me');showApp({email:j.data.email})}catch{localStorage.removeItem('sp_support_token');token=null}}async function loadTickets(){try{const j=await api('/api/support/tickets');$('ticketList').innerHTML=j.data.tickets.length?j.data.tickets.map(t=>'<article class="ticket"><div class="ticket-head"><div><h3>'+esc(t.subject)+'</h3><span class="meta">'+date(t.created_at)+'</span></div><span class="pill '+t.priority+'">'+({normal:'普通',urgent:'紧急',top:'顶级'}[t.priority])+'</span></div><p>'+esc(t.content)+'</p><div><span class="pill '+t.status+'">'+(t.status==='pending'?'待处理':'已处理')+'</span></div>'+(t.admin_reply?'<div class="reply"><strong>处理内容</strong><br>'+esc(t.admin_reply)+'</div>':'')+'</article>').join(''):'<p class="msg">还没有反馈工单</p>'}catch(e){$('ticketList').innerHTML='<p class="msg error">'+esc(e.message)+'</p>'}}async function createTicket(e){e.preventDefault();try{await api('/api/support/tickets',{method:'POST',body:JSON.stringify({subject:$('subject').value,content:$('content').value,priority:$('priority').value})});e.target.reset();msg('ticketMsg','工单已提交');loadTickets()}catch(e){msg('ticketMsg',e.message,true)}}async function logout(){try{await api('/api/auth/logout',{method:'POST'})}catch{}localStorage.removeItem('sp_support_token');location.reload()}boot();
</script></body></html>`;
