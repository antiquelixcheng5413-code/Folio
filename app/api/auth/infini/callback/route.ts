import { bindInfiniUser, exchangeInfiniCode, sessionCookie } from "../../../../../lib/auth";
import { cookieValue, getSession } from "../../../../../lib/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = cookieValue(request, "peek_oauth_state");
  if (!code || !state || !expectedState || state !== expectedState) {
    return Response.redirect(new URL("/?auth=error&reason=登录校验失败，请重试", request.url), 302);
  }

  try {
    const session = await getSession(request);
    const payload = await exchangeInfiniCode(code);
    const targetSessionId = await bindInfiniUser(session.sessionId, payload.user);
    const headers = new Headers({ location: "/?auth=success" });
    headers.append("set-cookie", sessionCookie(targetSessionId));
    headers.append("set-cookie", "peek_oauth_state=; Path=/api/auth/infini/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    return new Response(null, { status: 302, headers });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "登录失败，请重试";
    return Response.redirect(new URL(`/?auth=error&reason=${encodeURIComponent(reason)}`, request.url), 302);
  }
}

