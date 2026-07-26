import { renderLoginPage as renderConsoleStyledPage } from "./login-page.js";

export async function renderLoginPage() {
	const response = renderConsoleStyledPage();
	const html = await response.text();
	const appHtml = html
		.replaceAll("StudyPulse Cloud AI", "StudyPulse App")
		.replaceAll("Cloud AI 控制台", "StudyPulse App")
		.replaceAll("登录 StudyPulse，", "登录 StudyPulse App，")
		.replaceAll("登录你的账号以继续", "登录你的 App 账号以继续")
		.replace("</script></body></html>", "const _originalReturnTo=getAppReturnTo;getAppReturnTo=function(){const fallback='studypulse://auth/callback',params=new URLSearchParams(location.search),value=params.get('redirect')||params.get('return_to');if(!value)return fallback;try{const url=new URL(value);if(url.protocol==='https:'&&url.hostname==='dash.studypulse.chenkai.space'){return url.pathname==='/'?url.origin+'/dashboard':url.pathname.startsWith('/dashboard')?value:fallback}}catch{}return _originalReturnTo()};</script></body></html>");

	return new Response(appHtml, {
		status: response.status,
		headers: response.headers,
	});
}
