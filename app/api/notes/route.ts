import { getD1, getSession, json } from "../../../lib/db";

export async function POST(request: Request) {
  const session = await getSession(request);
  const payload = (await request.json()) as {
    meetingId?: string;
    segmentId?: string;
    timecodeSeconds?: number | null;
    content?: string;
  };
  const content = payload.content?.trim() || "";
  if (!payload.meetingId || !content) {
    return json({ error: "会议和笔记内容不能为空" }, { status: 400 }, session.cookie);
  }
  if (content.length > 4000) {
    return json({ error: "单条笔记不能超过 4,000 字" }, { status: 413 }, session.cookie);
  }
  const owned = await getD1()
    .prepare("SELECT id FROM meetings WHERE id = ? AND session_id = ?")
    .bind(payload.meetingId, session.sessionId)
    .first();
  if (!owned) return json({ error: "会议不存在" }, { status: 404 }, session.cookie);
  const id = crypto.randomUUID();
  await getD1()
    .prepare(`INSERT INTO notes
      (id, session_id, meeting_id, segment_id, timecode_seconds, content)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      session.sessionId,
      payload.meetingId,
      payload.segmentId || null,
      Number.isFinite(payload.timecodeSeconds) ? Math.round(payload.timecodeSeconds!) : null,
      content
    )
    .run();
  return json(
    {
      note: {
        id,
        meetingId: payload.meetingId,
        segmentId: payload.segmentId || null,
        timecodeSeconds: payload.timecodeSeconds ?? null,
        content,
      },
    },
    { status: 201 },
    session.cookie
  );
}
