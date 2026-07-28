import { getD1, getSession, json } from "../../../../lib/db";
import type { XianjianAnalysisResult } from "../../../../lib/types";

const STATES = new Set(["pending", "archived", "shelved", "later", "completed", "skipped"]);
const SHELF_STATES = new Set(["shelved", "later", "completed"]);

type MeetingRow = {
  state: string;
  analysisId: string | null;
  resultJson: string | null;
};

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
  const db = getD1();
  const meeting = await db
    .prepare(`SELECT m.state, a.id AS analysisId, a.result_json AS resultJson
      FROM meetings m
      LEFT JOIN analyses a ON a.id = (
        SELECT id FROM analyses WHERE meeting_id = m.id AND status = 'completed'
        ORDER BY created_at DESC LIMIT 1
      )
      WHERE m.id = ? AND m.session_id = ?`)
    .bind(id, session.sessionId)
    .first<MeetingRow>();
  if (!meeting) {
    return json({ error: "会议不存在" }, { status: 404 }, session.cookie);
  }

  const nextState = payload.state;
  const statements = [
    db
      .prepare(`UPDATE meetings SET state = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND session_id = ?`)
      .bind(nextState, id, session.sessionId),
  ];

  if (SHELF_STATES.has(nextState)) {
    if (!meeting.analysisId || !meeting.resultJson) {
      return json({ error: "分析完成后才能纳入书架" }, { status: 409 }, session.cookie);
    }
    const result = JSON.parse(meeting.resultJson) as XianjianAnalysisResult;
    const knowledge = [
      ...(result.newKnowledge || []).map((item) => ({ ...item, status: "new" })),
      ...(result.repeatedKnowledge || []).map((item) => ({ ...item, status: "repeated" })),
    ];
    for (const item of knowledge) {
      statements.push(
        db
          .prepare(`INSERT INTO knowledge_items
            (id, session_id, meeting_id, analysis_id, topic, status, evidence)
            SELECT ?, ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM knowledge_items
              WHERE session_id = ? AND analysis_id = ? AND topic = ? AND status = ?
            )`)
          .bind(
            crypto.randomUUID(),
            session.sessionId,
            id,
            meeting.analysisId,
            item.topic,
            item.status,
            item.evidence,
            session.sessionId,
            meeting.analysisId,
            item.topic,
            item.status
          )
      );
    }
  } else {
    statements.push(
      db
        .prepare("DELETE FROM knowledge_items WHERE meeting_id = ? AND session_id = ?")
        .bind(id, session.sessionId)
    );
  }

  const results = await db.batch(statements);
  const knowledgeChanged = results
    .slice(1)
    .reduce(
      (total: number, result: unknown) =>
        total + Number((result as { meta?: { changes?: number } }).meta?.changes || 0),
      0
    );
  return json(
    { meeting: { id, state: nextState }, knowledgeChanged },
    {},
    session.cookie
  );
}
