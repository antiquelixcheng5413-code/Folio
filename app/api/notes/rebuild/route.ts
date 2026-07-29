import { getD1, getSession, json } from "../../../../lib/db";
import { buildStructuredNote } from "../../../../lib/notebook";
import type { XianjianAnalysisResult } from "../../../../lib/types";

export async function POST(request: Request) {
  const session = await getSession(request);
  const payload = await request.json().catch(() => ({})) as { meetingId?: string };
  if (!payload.meetingId) return json({ error: "缺少内容 ID" }, { status: 400 }, session.cookie);
  const db = getD1();
  const row = await db.prepare(`SELECT a.id AS analysisId, a.result_json AS resultJson
    FROM analyses a JOIN meetings m ON m.id = a.meeting_id
    WHERE m.id = ? AND m.session_id = ? AND a.result_json IS NOT NULL
    ORDER BY a.created_at DESC LIMIT 1`).bind(payload.meetingId, session.sessionId)
    .first<{ analysisId: string; resultJson: string }>();
  if (!row) return json({ error: "没有可用于重建笔记的分析报告" }, { status: 404 }, session.cookie);
  const segmentId = `analysis-summary:${row.analysisId}`;
  const content = buildStructuredNote(JSON.parse(row.resultJson) as XianjianAnalysisResult);
  const existing = await db.prepare(`SELECT id FROM notes WHERE session_id = ? AND meeting_id = ?
    AND segment_id LIKE 'analysis-summary:%' ORDER BY updated_at DESC LIMIT 1`)
    .bind(session.sessionId, payload.meetingId).first<{ id: string }>();
  if (existing) {
    await db.prepare(`UPDATE notes SET content = ?, segment_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND session_id = ?`).bind(content, segmentId, existing.id, session.sessionId).run();
  } else {
    await db.prepare(`INSERT INTO notes
      (id, session_id, meeting_id, segment_id, timecode_seconds, content)
      VALUES (?, ?, ?, ?, NULL, ?)`).bind(crypto.randomUUID(), session.sessionId, payload.meetingId, segmentId, content).run();
  }
  await db.prepare("DELETE FROM notebook_translations WHERE meeting_id = ? AND session_id = ?")
    .bind(payload.meetingId, session.sessionId).run();
  return json({ ok: true }, {}, session.cookie);
}
