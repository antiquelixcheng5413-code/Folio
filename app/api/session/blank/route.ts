import { cookieValue, getD1, getSession, json } from "../../../../lib/db";

const MONTH = 60 * 60 * 24 * 30;

function sessionCookie(name: string, value: string, maxAge = MONTH) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function POST(request: Request) {
  const current = await getSession(request);
  const existingPrevious = cookieValue(request, "xianjian_previous_session");
  if (existingPrevious && existingPrevious !== current.sessionId) {
    return json(
      { error: "你已经在空白核验空间中，可以先恢复原有空间。" },
      { status: 409 },
      current.cookie
    );
  }

  const db = getD1();
  const nextSessionId = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO sessions (id) VALUES (?)").bind(nextSessionId),
    db.prepare(`INSERT INTO profiles
      (session_id, direction, level, project, known_topics, preferences)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(nextSessionId, "", "", "", "", ""),
  ]);

  const response = json({ ok: true, mode: "blank" });
  response.headers.append("set-cookie", sessionCookie("xianjian_previous_session", current.sessionId));
  response.headers.append("set-cookie", sessionCookie("xianjian_session", nextSessionId));
  return response;
}
