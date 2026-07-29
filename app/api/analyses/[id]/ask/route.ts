import { getD1, getSession, json } from "../../../../../lib/db";
import { answerLearningQuestion } from "../../../../../lib/learning-assistant";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  const { id } = await context.params;
  const payload = await request.json().catch(() => ({})) as { question?: string; language?: string };
  const question = payload.question?.trim() || "";
  if (question.length < 2 || question.length > 800) return json({ error: "问题长度应为 2–800 字" }, { status: 400 }, session.cookie);
  const row = await getD1().prepare(`SELECT a.result_json AS resultJson, m.title,
    substr(m.transcript, 1, 60000) AS sourceText
    FROM analyses a JOIN meetings m ON m.id = a.meeting_id
    WHERE a.id = ? AND a.session_id = ?`).bind(id, session.sessionId)
    .first<{ resultJson: string | null; title: string; sourceText: string }>();
  if (!row?.resultJson) return json({ error: "分析报告尚未完成" }, { status: 409 }, session.cookie);
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
