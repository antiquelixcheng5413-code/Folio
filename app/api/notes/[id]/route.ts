import { getD1, getSession, json } from "../../../../lib/db";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  const { id } = await context.params;
  const payload = (await request.json()) as { content?: string };
  const content = payload.content?.trim() || "";
  if (!content || content.length > 4000) {
    return json({ error: "笔记需为 1–4,000 字" }, { status: 400 }, session.cookie);
  }
  const db = getD1();
  const note = await db
    .prepare("SELECT meeting_id AS meetingId FROM notes WHERE id = ? AND session_id = ?")
    .bind(id, session.sessionId)
    .first<{ meetingId: string }>();
  const result = await db
    .prepare(`UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND session_id = ?`)
    .bind(content, id, session.sessionId)
    .run();
  if (!result.meta.changes) {
    return json({ error: "笔记不存在" }, { status: 404 }, session.cookie);
  }
  if (note) {
    await db.prepare("DELETE FROM notebook_translations WHERE meeting_id = ? AND session_id = ?")
      .bind(note.meetingId, session.sessionId).run();
  }
  return json({ note: { id, content } }, {}, session.cookie);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  const { id } = await context.params;
  const db = getD1();
  const note = await db
    .prepare("SELECT meeting_id AS meetingId FROM notes WHERE id = ? AND session_id = ?")
    .bind(id, session.sessionId)
    .first<{ meetingId: string }>();
  const result = await db
    .prepare("DELETE FROM notes WHERE id = ? AND session_id = ?")
    .bind(id, session.sessionId)
    .run();
  if (!result.meta.changes) {
    return json({ error: "笔记不存在" }, { status: 404 }, session.cookie);
  }
  if (note) {
    await db.prepare("DELETE FROM notebook_translations WHERE meeting_id = ? AND session_id = ?")
      .bind(note.meetingId, session.sessionId).run();
  }
  return json({ deleted: true }, {}, session.cookie);
}
