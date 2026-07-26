import { cookieValue, getD1, getSession, json } from "../../../../lib/db";

const MONTH = 60 * 60 * 24 * 30;

function sessionCookie(name: string, value: string, maxAge = MONTH) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function POST(request: Request) {
  const current = await getSession(request);
  const previousSessionId = cookieValue(request, "xianjian_previous_session");
  if (!previousSessionId || previousSessionId === current.sessionId) {
    return json({ error: "没有可恢复的原有空间。" }, { status: 400 }, current.cookie);
  }

  const previous = await getD1()
    .prepare("SELECT id FROM sessions WHERE id = ?")
    .bind(previousSessionId)
    .first<{ id: string }>();
  if (!previous) {
    return json({ error: "原有空间已不存在，无法恢复。" }, { status: 404 }, current.cookie);
  }

  const response = json({ ok: true, mode: "restored" });
  response.headers.append("set-cookie", sessionCookie("xianjian_session", previousSessionId));
  response.headers.append("set-cookie", sessionCookie("xianjian_previous_session", "", 0));
  return response;
}
