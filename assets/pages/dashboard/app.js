const AUTH='https://auth.chenkai.space/login',PAGE=location.pathname,$=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),num=v=>new Intl.NumberFormat('zh-CN').format(Number(v||0)),tok=v=>{v=Number(v||0);return v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':num(v)},date=v=>v?new Date(v).toLocaleString('zh-CN'):'永久';
function token(){const q=new URLSearchParams(location.search),t=q.get('access_token');if(t){localStorage.setItem('sp_session_token',t);history.replaceState({},'',location.pathname)}return localStorage.getItem('sp_session_token')}function login(){location.replace(AUTH+'?redirect='+encodeURIComponent(location.origin+location.pathname))}function logout(){const t=token();localStorage.removeItem('sp_session_token');if(t)fetch('/api/v1/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+t}}).finally(login);else login()}async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token(),...(opts.headers||{})}}),j=await r.json();if(!r.ok)throw Error(j.error||'请求失败');return j}function activateNav(){document.querySelectorAll('.tab').forEach(item=>item.classList.toggle('active',item.dataset.page===PAGE))}function refreshPage(){PAGE==='/contributions'?loadContributions():loadDashboard()}function setApp(html){$('app').className='';$('app').innerHTML=html}function setError(error){$('app').innerHTML='<div class="loading error-text">'+esc(error.message||'加载失败')+'</div>';if(/Session|Unauthorized|Invalid/i.test(error.message||''))login()}
async function loadDashboard(){activateNav();$('pageTitle').textContent='仪表盘';try{const d=(await api('/api/user/dashboard')).data,u=d.user,s=d.subscription,t=d.usage,dp=s.daily_request_limit==null?0:Math.min(100,Math.round(t.today.requests/s.daily_request_limit*100)),mp=s.monthly_token_limit==null?0:Math.min(100,Math.round(t.month.tokens/s.monthly_token_limit*100)),avatar=u.avatar?'<img class="avatar" src="'+esc(u.avatar)+'">':'<div class="avatar">'+esc((u.username||u.email||'S')[0].toUpperCase())+'</div>';setApp('<div class="page-heading"><div><h2>账户概览</h2><p>查看你的账号、会员状态与 API 使用情况。</p></div><button class="btn" onclick="refreshPage()">↻ 刷新数据</button></div><div class="grid"><div class="card"><div class="card-head"><span class="icon">◎</span><span class="hint">账号</span></div><div class="label">当前用户</div><div class="value">'+esc(u.username||u.email.split('@')[0])+'</div><div class="foot">'+esc(u.email)+'</div></div><div class="card"><div class="card-head"><span class="icon">◆</span><span class="hint">会员</span></div><div class="label">当前套餐</div><div class="value">'+esc(s.plan)+'</div><div class="foot">'+esc(s.status==='active'?'有效':'已过期')+'</div></div><div class="card"><div class="card-head"><span class="icon">↗</span><span class="hint">今日</span></div><div class="label">今日请求</div><div class="value">'+num(t.today.requests)+'</div><div class="foot">'+(s.daily_request_limit==null?'不限额度':num(s.daily_request_limit)+' 次额度')+'</div></div><div class="card"><div class="card-head"><span class="icon">◈</span><span class="hint">本月</span></div><div class="label">本月 Token</div><div class="value">'+tok(t.month.tokens)+'</div><div class="foot">'+(s.monthly_token_limit==null?'不限额度':tok(s.monthly_token_limit)+' Token 额度')+'</div></div></div><div class="two"><section class="panel"><h3>用户信息</h3><p class="sub">账号基本资料</p><div class="profile">'+avatar+'<div><h3>'+esc(u.username||'StudyPulse 用户')+'</h3><p>'+esc(u.email)+'</p><span class="status">'+esc(u.status==='active'?'账号正常':u.status)+'</span></div></div><p class="info">注册时间：'+date(u.created_at)+'<br>邮箱状态：'+(u.email_verified?'已验证':'未验证')+'</p></section><section class="panel"><h3>当前套餐</h3><p class="sub">当前权益与有效期</p><div class="plan-name">'+esc(s.plan)+'</div><div class="plan-meta">状态：<strong>'+esc(s.status==='active'?'有效':'已过期')+'</strong><br>有效期：'+date(s.expire_time)+'</div></section></div><div class="two"><section class="panel"><h3>今日使用量</h3><p class="sub">北京时间 00:00 至当前时间</p><div class="row"><span>请求次数</span><strong>'+num(t.today.requests)+' / '+(s.daily_request_limit==null?'∞':num(s.daily_request_limit))+'</strong></div><div class="meter"><span style="width:'+dp+'%"></span></div><div class="copy"><span>已使用 '+dp+'%</span><span>'+tok(t.today.tokens)+' Token</span></div></section><section class="panel"><h3>本月使用量</h3><p class="sub">输入、输出与总 Token</p><div class="row"><span>请求次数</span><strong>'+num(t.month.requests)+'</strong></div><div class="row"><span>输入 Token</span><strong>'+tok(t.month.input_tokens)+'</strong></div><div class="row"><span>输出 Token</span><strong>'+tok(t.month.output_tokens)+'</strong></div><div class="row"><span>总 Token</span><strong>'+tok(t.month.tokens)+' / '+(s.monthly_token_limit==null?'∞':tok(s.monthly_token_limit))+'</strong></div><div class="meter"><span style="width:'+mp+'%"></span></div></section></div><section class="panel" style="margin-top:18px"><h3>最近调用记录</h3><p class="sub">仅显示你自己的最近 8 次调用</p><div class="tablewrap"><table><thead><tr><th>时间</th><th>模型</th><th>输入 Token</th><th>输出 Token</th><th>总 Token</th><th>状态</th></tr></thead><tbody>'+(d.recent_calls.length?d.recent_calls.map(x=>'<tr><td>'+date(x.created_at)+'</td><td>'+esc(x.model||'-')+'</td><td>'+tok(x.input_tokens)+'</td><td>'+tok(x.output_tokens)+'</td><td>'+tok(x.tokens)+'</td><td><span class="status">'+(Number(x.status)>=200&&Number(x.status)<300?'成功':'失败')+'</span></td></tr>').join(''):'<tr><td colspan="6" style="text-align:center;padding:30px">暂无调用记录</td></tr>')+'</tbody></table></div></section>')}catch(e){setError(e)}}
async function loadContributions(){activateNav();$('pageTitle').textContent='代码贡献';try{const dashboard=(await api('/api/user/dashboard')).data,u=dashboard.user,items=(await api('/api/user/contributions')).data||[],labels={pending:'待审核',approved:'已通过',rejected:'已打回'},rows=items.length?items.map(c=>'<div class="history-item"><strong>'+esc(c.contribution_type)+'</strong> <span class="status">'+labels[c.status]+'</span><br><a href="'+esc(c.contribution_url)+'" target="_blank" rel="noopener">查看贡献链接</a>'+(c.awarded_membership?'<br>已发放 '+esc(c.awarded_membership.toUpperCase())+'，有效期至 '+date(c.membership_expires_at):'')+(c.admin_reply?'<br><span class="sub">审核回复：'+esc(c.admin_reply)+'</span>':'')+'</div>').join(''):'<p class="sub">暂无贡献记录</p>';setApp('<div class="page-heading"><div><h2>代码贡献</h2><p>提交 Fork、Issue 或 Pull Request 等公开贡献，审核通过后可获得免费会员权益。</p></div><button class="btn" onclick="refreshPage()">↻ 刷新数据</button></div><div class="two"><section class="panel"><h3>提交贡献</h3><p class="sub">请填写可公开访问的代码贡献链接和账号邮箱。</p><form onsubmit="submitContribution(event)"><div class="form-grid"><div class="field"><label>贡献类型</label><select name="type"><option value="fork">Fork</option><option value="issue">Issue</option><option value="pull_request">Pull Request</option><option value="other">其他</option></select></div><div class="field"><label>邮箱</label><input name="email" type="email" required value="'+esc(u.email)+'"></div></div><div class="field"><label>贡献 URL</label><input name="url" type="url" required maxlength="2048" placeholder="https://github.com/..."></div><div class="field"><label>说明（可选）</label><textarea name="description" maxlength="2000" placeholder="请说明你做出的贡献"></textarea></div><div class="actions"><button class="btn btn-primary">提交贡献</button><span id="contributionMsg" class="msg"></span></div></form></section><section class="panel"><h3>审核记录</h3><p class="sub">审核完成后工单会自动关闭，结果会通过邮件反馈。</p><div>'+rows+'</div></section></div>')}catch(e){setError(e)}}async function submitContribution(e){e.preventDefault();const f=e.target,m=$('contributionMsg');try{await api('/api/user/contributions',{method:'POST',body:JSON.stringify({contribution_url:f.url.value,email:f.email.value,contribution_type:f.type.value,description:f.description.value})});f.reset();f.email.value='';m.textContent='贡献已提交，等待审核';m.style.color='var(--success)';loadContributions()}catch(x){m.textContent=x.message;m.style.color='var(--danger)'}}

function base64UrlToBuffer(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}
function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function credentialToJSON(credential) {
  if (typeof credential.toJSON === "function") return credential.toJSON();
  const response = credential.response;
  const result = { id: credential.id, rawId: bufferToBase64Url(credential.rawId), type: credential.type, clientExtensionResults: credential.getClientExtensionResults(), response: { clientDataJSON: bufferToBase64Url(response.clientDataJSON) } };
  if ("attestationObject" in response) {
    result.response.attestationObject = bufferToBase64Url(response.attestationObject);
    if (response.getTransports) result.response.transports = response.getTransports();
  } else {
    result.response.authenticatorData = bufferToBase64Url(response.authenticatorData);
    result.response.signature = bufferToBase64Url(response.signature);
    if (response.userHandle) result.response.userHandle = bufferToBase64Url(response.userHandle);
  }
  return result;
}
function decodeRegistrationOptions(options) {
  return { ...options, challenge: base64UrlToBuffer(options.challenge), user: { ...options.user, id: base64UrlToBuffer(options.user.id) }, excludeCredentials: (options.excludeCredentials || []).map(item => ({ ...item, id: base64UrlToBuffer(item.id) })) };
}
async function addPasskey() {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) { passkeyMessage("当前浏览器不支持 Passkey", true); return; }
  const button = $("addPasskey");
  const name = $("passkeyName").value.trim() || "Passkey";
  button.disabled = true;
  try {
    const options = await api("/api/user/passkeys/register/options", { method: "POST", body: JSON.stringify({ name }) });
    const credential = await navigator.credentials.create({ publicKey: decodeRegistrationOptions(options.data.public_key) });
    if (!credential) throw Error("未创建 Passkey");
    await api("/api/user/passkeys/register/verify", { method: "POST", body: JSON.stringify({ challenge_token: options.data.challenge_token, response: credentialToJSON(credential) }) });
    passkeyMessage("Passkey 已绑定");
    loadSecurity();
  } catch (error) {
    passkeyMessage(error?.name === "NotAllowedError" ? "Passkey 绑定已取消" : "绑定失败: " + error.message, true);
  } finally { button.disabled = false; }
}
async function removePasskey(id) {
  if (!confirm("确定删除这个 Passkey 吗？删除后仍可使用其他登录方式。")) return;
  try { await api("/api/user/passkeys/" + encodeURIComponent(id), { method: "DELETE" }); passkeyMessage("Passkey 已删除"); loadSecurity(); } catch (error) { passkeyMessage("删除失败: " + error.message, true); }
}
function passkeyMessage(text, bad = false) { const node = $("securityMessage"); if (node) { node.textContent = text; node.style.color = bad ? "var(--danger)" : "var(--success)"; } }
async function loadSecurity() {
  activateNav(); $("pageTitle").textContent = "安全设置";
  try {
    const { data } = await api("/api/user/passkeys");
    const rows = (data.passkeys || []).map(item => '<article class="history-item"><div class="row" style="margin-top:0"><strong>' + esc(item.name || "Passkey") + '</strong><button class="btn" onclick="removePasskey(\'' + esc(item.id) + '\')">删除</button></div><p class="sub">设备：' + esc(item.device_type || "未知") + ' · 创建：' + date(item.created_at) + ' · 最近使用：' + (item.last_used_at ? date(item.last_used_at) : '未使用') + '</p></article>').join("");
    setApp('<div class="page-heading"><div><h2>安全设置</h2><p>管理用于登录 StudyPulse 的 Passkey。</p></div><button class="btn" onclick="loadSecurity()">↻ 刷新</button></div><section class="panel"><h3>Passkey</h3><p class="sub">支持在多个设备上绑定 Passkey。私钥始终保存在你的设备或密码管理器中。</p><div class="form-grid"><div class="field"><label>设备名称</label><input id="passkeyName" maxlength="80" placeholder="例如：我的 iPhone"></div><div class="field" style="display:flex;align-items:end"><button class="btn btn-primary" id="addPasskey" onclick="addPasskey()">添加 Passkey</button></div></div><p id="securityMessage" class="msg" role="status"></p><div style="margin-top:20px">' + (rows || '<p class="sub">暂未绑定 Passkey。</p>') + '</div></section>');
  } catch (error) { setError(error); }
}

const feedbackNav = '<a class="tab" data-page="/feedback" href="/feedback"><span class="nav-icon">⚠</span><span>异常反馈</span></a>';
document.querySelector('.tabs')?.insertAdjacentHTML('beforeend', feedbackNav);
if (PAGE === '/feedback') {
  const originalSetApp = setApp, originalSetError = setError;
  setApp = html => { if (!html.includes('账户概览')) originalSetApp(html); };
  setError = error => { if (PAGE === '/feedback') originalSetError(error); };
}
async function loadFeedback() {
  activateNav(); $('pageTitle').textContent = '异常反馈';
  try {
    const dashboard = (await api('/api/user/dashboard')).data;
    const items = (await api('/api/user/feedback')).data.tickets || [];
    const priority = { normal: '普通', urgent: '紧急', top: '顶级' };
    const status = { pending: '待处理', processed: '已处理' };
    const tickets = items.length ? items.map(t => '<article class="history-item"><div class="row" style="margin-top:0"><strong>' + esc(t.subject) + '</strong><span class="status">' + (status[t.status] || t.status) + '</span></div><p class="sub">' + date(t.created_at) + ' · ' + (priority[t.priority] || t.priority) + '</p><p style="white-space:pre-wrap;line-height:1.7">' + esc(t.content) + '</p>' + (t.admin_reply ? '<div class="reply-box"><strong>处理回复</strong><br>' + esc(t.admin_reply) + '</div>' : '') + '</article>').join('') : '<p class="sub">暂无异常反馈记录</p>';
    setApp('<div class="page-heading"><div><h2>异常反馈</h2><p>提交使用中遇到的问题，并跟踪处理进度。</p></div><button class="btn" onclick="refreshPage()">↻ 刷新数据</button></div><div class="two"><section class="panel"><h3>提交反馈</h3><p class="sub">请描述复现步骤、发生时间和期望结果。</p><form onsubmit="submitFeedback(event)"><div class="field"><label>主题</label><input name="subject" maxlength="120" required placeholder="例如：对话页面无法加载"></div><div class="form-grid"><div class="field"><label>优先级</label><select name="priority"><option value="normal">普通</option><option value="urgent">紧急</option><option value="top">顶级 · Pro 专享</option></select></div><div class="field"><label>账号</label><input value="' + esc(dashboard.user.email) + '" disabled></div></div><div class="field"><label>反馈内容</label><textarea name="content" maxlength="5000" required placeholder="请描述遇到的异常..."></textarea></div><div class="actions"><button class="btn btn-primary">提交反馈</button><span id="feedbackMsg" class="msg"></span></div></form></section><section class="panel"><h3>反馈记录</h3><p class="sub">处理完成后会在这里显示回复内容。</p><div>' + tickets + '</div></section></div>');
  } catch (e) { setError(e); }
}
async function submitFeedback(e) { e.preventDefault(); const form = e.target, msg = $('feedbackMsg'); try { await api('/api/user/feedback', { method: 'POST', body: JSON.stringify({ subject: form.subject.value, content: form.content.value, priority: form.priority.value }) }); form.reset(); msg.textContent = '反馈已提交，等待处理'; msg.style.color = 'var(--success)'; loadFeedback(); } catch (error) { msg.textContent = error.message; msg.style.color = 'var(--danger)'; } }
if (PAGE === '/feedback') { refreshPage = loadFeedback; loadFeedback(); }
if (PAGE === '/security') refreshPage = loadSecurity;
if (PAGE !== '/feedback') { activateNav(); (PAGE === '/contributions' ? loadContributions : PAGE === '/security' ? loadSecurity : loadDashboard)(); }
