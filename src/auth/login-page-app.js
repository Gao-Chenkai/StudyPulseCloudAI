import { renderLoginPage as renderConsoleStyledPage } from "./login-page.js";

export async function renderLoginPage() {
	const response = renderConsoleStyledPage();
	const html = await response.text();
	const appHtml = html
		.replaceAll("StudyPulse Cloud AI", "StudyPulse App")
		.replaceAll("Cloud AI 控制台", "StudyPulse App")
		.replaceAll("登录 StudyPulse，", "登录 StudyPulse App，")
		.replaceAll("登录你的账号以继续", "登录你的 App 账号以继续");

	return new Response(appHtml, {
		status: response.status,
		headers: response.headers,
	});
}
