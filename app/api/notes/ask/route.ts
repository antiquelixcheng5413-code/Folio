import { getD1, getSession, json } from "../../../../lib/db";
import { answerLearningQuestion } from "../../../../lib/learning-assistant";

export async function POST(request: Request) {
  const session = await getSession(request);
  const payload = await request.json().catch(() => ({})) as {
    meetingId?: string;
    question?: string;
    language?: string;
  };
  const question = payload.question?.trim() || "";
  if (!payload.meetingId) return json({ error: "请先选择一篇笔记" }, { status: 400 }, session.cookie);
  if (question.length < 2 || question.length > 800) {
    return json({ error: "问题长度应为 2–800 字" }, { status: 400 }, session.cookie);
  }
  const row = await getD1().prepare(`SELECT m.title, substr(m.transcript, 1, 60000) AS sourceText,
    a.result_json AS resultJson
    FROM meetings m JOIN analyses a ON a.id = (
      SELECT id FROM analyses WHERE meeting_id = m.id AND result_json IS NOT NULL
      ORDER BY created_at DESC LIMIT 1
    )
    WHERE m.id = ? AND m.session_id = ?`)
    .bind(payload.meetingId, session.sessionId)
    .first<{ title: string; sourceText: string; resultJson: string | null }>();
  if (!row?.resultJson) return json({ error: "这篇内容还没有可用的分析结果" }, { status: 409 }, session.cookie);
  try {
    const response = await answerLearningQuestion({
      title: row.title,
      question,
      language: payload.language === "en" ? "en" : "zh",
      resultJson: row.resultJson,
      sourceText: row.sourceText || "",
    });
    return json({ ...response.answer, taskId: response.taskId }, {}, session.cookie);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Peek 暂时没有整理出回答，请重试" },
      { status: 502 },
      session.cookie
    );
  }
}
