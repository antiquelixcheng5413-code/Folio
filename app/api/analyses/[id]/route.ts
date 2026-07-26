import { getD1, getSession, json } from "../../../../lib/db";
import { recoverInfiniTask } from "../../../../lib/infinisynapse";

type AnalysisRow = {
  id: string;
  meetingId: string;
  title: string;
  source: string;
  durationSeconds: number;
  status: string;
  progressText: string;
  taskId: string | null;
  resultJson: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  const { id } = await context.params;
  const db = getD1();
  const row = await db
    .prepare(`SELECT a.id, a.meeting_id AS meetingId, m.title, m.source,
      m.duration_seconds AS durationSeconds, a.status,
      a.progress_text AS progressText, a.task_id AS taskId,
      a.result_json AS resultJson, a.error_message AS errorMessage,
      a.created_at AS createdAt
      FROM analyses a JOIN meetings m ON m.id = a.meeting_id
      WHERE a.id = ? AND a.session_id = ?`)
    .bind(id, session.sessionId)
    .first<AnalysisRow>();
  if (!row) return json({ error: "分析任务不存在" }, { status: 404 }, session.cookie);

  if (
    row.taskId &&
    !row.resultJson &&
    ["running", "recovering"].includes(row.status)
  ) {
    try {
      const recovered = await recoverInfiniTask(row.taskId, row.durationSeconds);
      if (recovered.result) {
        row.status = "completed";
        row.progressText = "已从 InfiniSynapse 恢复";
        row.resultJson = JSON.stringify(recovered.result);
        const saved = await db
          .prepare(`UPDATE analyses SET status = 'completed', progress_text = ?,
            result_json = ?, raw_messages_json = ?, workspace_json = ?,
            updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?
            AND status != 'completed'`)
          .bind(
            row.progressText,
            row.resultJson,
            JSON.stringify(recovered.messages).slice(0, 120_000),
            JSON.stringify(recovered.workspace).slice(0, 80_000),
            id,
            session.sessionId
          )
          .run();
        if ((saved.meta?.changes || 0) > 0) {
          const knowledgeStatements = [
            ...recovered.result.newKnowledge.map((item) =>
              db
                .prepare(`INSERT INTO knowledge_items
                  (id, session_id, meeting_id, analysis_id, topic, status, evidence)
                  VALUES (?, ?, ?, ?, ?, 'new', ?)`)
                .bind(
                  crypto.randomUUID(),
                  session.sessionId,
                  row.meetingId,
                  id,
                  item.topic,
                  item.evidence
                )
            ),
            ...recovered.result.repeatedKnowledge.map((item) =>
              db
                .prepare(`INSERT INTO knowledge_items
                  (id, session_id, meeting_id, analysis_id, topic, status, evidence)
                  VALUES (?, ?, ?, ?, ?, 'repeated', ?)`)
                .bind(
                  crypto.randomUUID(),
                  session.sessionId,
                  row.meetingId,
                  id,
                  item.topic,
                  item.evidence
                )
            ),
          ];
          if (knowledgeStatements.length) await db.batch(knowledgeStatements);
          await db
            .prepare(`UPDATE meetings SET transcript = '[已按隐私策略清理]',
              updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?`)
            .bind(row.meetingId, session.sessionId)
            .run();
        }
      }
    } catch {
      // Keep the durable local state and allow a later retry.
    }
  }

  return json(
    {
      analysis: {
        ...row,
        result: row.resultJson ? JSON.parse(row.resultJson) : null,
        resultJson: undefined,
      },
    },
    {},
    session.cookie
  );
}
