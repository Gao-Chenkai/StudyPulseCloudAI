const app = document.getElementById('app');
const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api = async (path, options = {}) => {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '请求失败');
  return body;
};
function render(data) {
  const appeal = data.data;
  const status = appeal.appeal_id ? '<p class="muted">此申诉已提交，当前状态：' + esc(appeal.status) + '</p>' : '<form id="form"><label for="content">申诉说明</label><textarea id="content" maxlength="5000" required placeholder="请说明情况以及希望我们重新审核的原因"></textarea><button>提交申诉</button><p id="message" class="muted"></p></form>';
  app.innerHTML = '<h2>账号封禁申诉</h2><p class="muted">账号：' + esc(appeal.email) + '<br>封禁原因：' + esc(appeal.reason) + '</p>' + status;
  document.getElementById('form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const message = document.getElementById('message');
    try {
      await api('/api/appeals', { method: 'POST', body: JSON.stringify({ token, content: document.getElementById('content').value }) });
      message.textContent = '申诉已提交，我们会尽快审核。';
      event.target.remove();
    } catch (error) {
      message.className = 'error';
      message.textContent = error.message;
    }
  });
}
api('/api/appeals?token=' + encodeURIComponent(token)).then(render).catch(error => {
  app.innerHTML = '<p class="error">申诉链接无效、已处理或已过期。</p>';
});
