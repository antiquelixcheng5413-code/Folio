import { createInfiniLoginSession, infiniAuthConfigured } from "../../../../../lib/auth";
import { getSession } from "../../../../../lib/db";

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!infiniAuthConfigured()) {
    return Response.redirect(new URL("/?auth=not-configured", request.url), 302);
  }

  const state = crypto.randomUUID().replaceAll("-", "");
  const origin = new URL(request.url).origin;
  try {
    const login = await createInfiniLoginSession({
      returnUrl: `${origin}/api/auth/infini/callback`,
      cancelUrl: `${origin}/?auth=cancelled`,
      state,
      sessionId: session.sessionId,
    });
    const headers = new Headers({ location: login.entryUrl });
    headers.append("set-cookie", `peek_oauth_state=${state}; Path=/api/auth/infini/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    if (session.cookie) headers.append("set-cookie", session.cookie);
    return new Response(null, { status: 302, headers });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "登录服务暂时不可用";
    return Response.redirect(new URL(`/?auth=error&reason=${encodeURIComponent(reason)}`, request.url), 302);
  }
}

