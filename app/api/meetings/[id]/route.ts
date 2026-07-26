import { getD1, getSession, json } from "../../../../lib/db";

const STATES = new Set(["archived", "later", "completed", "skipped"]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  const { id } = await context.params;
  const payload = (await request.json()) as { state?: string };
  if (!payload.state || !STATES.has(payload.state)) {
    return json({ error: "无效的学习状态" }, { status: 400 }, session.cookie);
  }
  const result = await getD1()
    .prepare(`UPDATE meetings SET state = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND session_id = ?`)
    .bind(payload.state, id, session.sessionId)
    .run();
  if (!result.meta.changes) {
    return json({ error: "会议不存在" }, { status: 404 }, session.cookie);
  }
  return json({ meeting: { id, state: payload.state } }, {}, session.cookie);
}
