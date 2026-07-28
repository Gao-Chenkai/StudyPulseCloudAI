const $=s=>document.querySelector(s),message=$('#message');function show(text,type=''){message.textContent=text;message.className='message '+type}function setVisible(id){document.querySelectorAll('.form,.aux').forEach(x=>x.classList.toggle('active',x.id===id));show('')}async function request(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),j=await r.json().catch(()=>null);if(!r.ok)throw Error(j?.error?.message||j?.error||'请求失败');return j}function getAppReturnTo(){const fallback='studypulse://auth/callback',value=new URLSearchParams(location.search).get('return_to');return !value||/^studypulse:\/\/auth\/callback(?:\?.*)?$/.test(value)?value||fallback:fallback}function finishLogin(data){const returnTo=getAppReturnTo();const params=new URLSearchParams({access_token:data.access_token,refresh_token:data.refresh_token});location.replace(returnTo+(returnTo.includes('?')?'&':'?')+params.toString())}document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===t));setVisible(t.dataset.tab)});$('#forgot').onclick=()=>setVisible('reset');document.querySelectorAll('.form,.aux').forEach(form=>form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('.submit');b.disabled=true;try{const j=await request(form.id==='password'?'/auth/login/password':form.id==='code'?'/auth/login/code':form.id==='setup'?'/auth/password/set-after-code':'/v1/auth/password/reset',Object.fromEntries(new FormData(form)));if(j.data?.requires_password_setup){$('#setup [name=setup_token]').value=j.data.setup_token;setVisible('setup');show('验证成功，请设置密码','success')}else if(form.id==='reset'){setVisible('password');show('密码重置成功，请使用新密码登录','success')}else if(j.data?.access_token){finishLogin(j.data)}else show('操作成功','success')}catch(err){show(err.message,'error')}finally{b.disabled=false}});document.querySelectorAll('.send-code').forEach(button=>button.onclick=async()=>{const form=button.closest('form'),email=form.querySelector('[name=email]').value.trim();if(!email)return show('请先输入邮箱地址','error');const purpose=form.id==='reset'?'reset_password':'login';button.disabled=true;try{await request('/auth/send-code',{email,purpose});show('验证码已发送，请查收邮箱','success');let n=60;const timer=setInterval(()=>{button.textContent=n?'重新发送 '+n--+'s':'获取验证码';if(!n){clearInterval(timer);button.disabled=false}},1000)}catch(err){show(err.message,'error');button.disabled=false}});
const originalReturnTo = getAppReturnTo;
getAppReturnTo = function () {
  const fallback = 'studypulse://auth/callback';
  const params = new URLSearchParams(location.search);
  const value = params.get('redirect') || params.get('return_to');
  if (!value) return fallback;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'dash.studypulse.chenkai.space') {
      return url.pathname === '/' ? url.origin + '/dashboard' : url.pathname.startsWith('/dashboard') ? value : fallback;
    }
  } catch {}
  return originalReturnTo();
};
const github = document.querySelector('.github');
const redirect = new URLSearchParams(location.search).get('redirect');
if (github && redirect) github.href = '/oauth/github/start?return_to=' + encodeURIComponent(getAppReturnTo());
