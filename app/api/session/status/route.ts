import { cookieValue, getD1, getSession, json } from "../../../../lib/db";

export async function GET(request: Request) {
  const session = await getSession(request);
  const previousSessionId = cookieValue(request, "xianjian_previous_session");
  let canRestore = false;

  if (previousSessionId && previousSessionId !== session.sessionId) {
    const previous = await getD1()
      .prepare("SELECT id FROM sessions WHERE id = ?")
      .bind(previousSessionId)
      .first<{ id: string }>();
    canRestore = Boolean(previous);
  }

  return json({ canRestore }, {}, session.cookie);
}
