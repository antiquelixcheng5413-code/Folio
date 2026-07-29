import { getD1, getSession, json } from "../../../../lib/db";
import type { XianjianAnalysisResult } from "../../../../lib/types";

function structuredNote(result: XianjianAnalysisResult) {
  const lines = [
    "# 核心结论",
    result.summary,
    "",
    "## 文章／视频核心总结",
    ...result.evidence.slice(0, 6).map((item) => `- ${item}`),
    "",
    "## 关键概念与具体内容",
    ...result.segments.filter((item) => item.decision === "watch").slice(0, 7)
      .map((item) => `- ${item.title}：${item.value}${item.evidence ? `（依据：${item.evidence}）` : ""}`),
    "",
    "## 新增知识",
    ...(result.newKnowledge.length ? result.newKnowledge.slice(0, 7).map((item) => `- ${item.topic}：${item.evidence}`) : ["- 暂无明确新增知识。"]),
    "",
    "## 专业技能点",
    ...((result.skillAssessment?.skills || []).length
      ? result.skillAssessment!.skills.slice(0, 10).map(
          (item) => `- ${item.domain}／${item.name}：${item.description}；学习结果：${item.learningOutcome}；覆盖 ${item.coverage}%，深度 ${item.depth}%`
        )
      : ["- 旧报告尚未包含专业技能点模型，可重新分析后生成。"]),
    "",
    "## 判断依据",
    `- 匹配度 ${result.signals.match}%：${result.signals.matchReason}`,
    `- 内容含金量 ${result.signals.value}%：${result.signals.valueReason}`,
    ...(result.personalization ? [`- 动态匹配公式：${result.personalization.basis}`] : []),
    "",
    "## 可继续追问",
    "- 哪个概念最值得深入？它与我已有知识有什么关系？",
    "- 报告中的结论有哪些前提或证据限制？",
  ];
  return lines.join("\n").slice(0, 4000);
}

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
  const content = structuredNote(JSON.parse(row.resultJson));
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
  return json({ ok: true }, {}, session.cookie);
}
