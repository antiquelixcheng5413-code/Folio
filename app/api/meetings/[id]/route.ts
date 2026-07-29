import { getD1, getSession, json } from "../../../../lib/db";
import { skillKey } from "../../../../lib/personalization";
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
    const engagementFactor = nextState === "completed" ? 0.55 : nextState === "shelved" ? 0.25 : 0.1;
    const knowledge = result.skillAssessment
      ? result.skillAssessment.skills.map((item) => {
          const masteryBefore = Math.max(0, Math.min(100, item.userMasteryBefore || 0));
          const learningDelta =
            (100 - masteryBefore) *
            (item.coverage / 100) *
            (item.depth / 100) *
            engagementFactor;
          return {
            topic: item.name,
            status: item.relation,
            evidence: item.evidence.join("；") || item.description,
            key: item.key || skillKey(item.domain, item.name),
            domain: item.domain,
            skillType: item.type,
            description: item.description,
            prerequisitesJson: JSON.stringify(item.prerequisites),
            masteryLevel: Math.round(Math.min(100, masteryBefore + learningDelta)),
            confidence: item.confidence,
            coverage: item.coverage,
            depth: item.depth,
            sourceValue: result.signals.value,
          };
        })
      : [
          ...(result.newKnowledge || []).map((item) => ({ ...item, status: "new" })),
          ...(result.repeatedKnowledge || []).map((item) => ({ ...item, status: "reinforce" })),
        ].map((item) => ({
          topic: item.topic,
          status: item.status,
          evidence: item.evidence,
          key: skillKey("未分类", item.topic),
          domain: "未分类",
          skillType: "concept",
          description: item.evidence,
          prerequisitesJson: "[]",
          masteryLevel: item.status === "reinforce" ? 55 : 15,
          confidence: 40,
          coverage: 50,
          depth: result.signals.depth,
          sourceValue: result.signals.value,
        }));
    for (const item of knowledge) {
      statements.push(
        db
          .prepare(`INSERT INTO knowledge_items
            (id, session_id, meeting_id, analysis_id, topic, status, evidence,
              skill_key, domain, skill_type, description, prerequisites_json,
              mastery_level, confidence, coverage, depth, source_value)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM knowledge_items
              WHERE session_id = ? AND analysis_id = ? AND skill_key = ?
            )`)
          .bind(
            crypto.randomUUID(),
            session.sessionId,
            id,
            meeting.analysisId,
            item.topic,
            item.status,
            item.evidence,
            item.key,
            item.domain,
            item.skillType,
            item.description,
            item.prerequisitesJson,
            item.masteryLevel,
            item.confidence,
            item.coverage,
            item.depth,
            item.sourceValue,
            session.sessionId,
            meeting.analysisId,
            item.key
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
  await db
    .prepare("DELETE FROM analysis_translations WHERE session_id = ?")
    .bind(session.sessionId)
    .run();
  const derived = await db
    .prepare(`SELECT k.topic, k.domain, k.mastery_level AS mastery
      FROM knowledge_items k JOIN meetings m ON m.id = k.meeting_id
      WHERE k.session_id = ? AND m.state IN ('shelved', 'later', 'completed')
      ORDER BY k.created_at DESC LIMIT 120`)
    .bind(session.sessionId)
    .all<{ topic: string; domain: string; mastery: number }>();
  const domains = [...new Set(derived.results.map((item) => item.domain).filter(Boolean))].slice(0, 8);
  const topics = [...new Set(derived.results.map((item) => item.topic).filter(Boolean))].slice(0, 40);
  const averageMastery = derived.results.length
    ? Math.round(
        derived.results.reduce((sum, item) => sum + Number(item.mastery || 0), 0) /
          derived.results.length
      )
    : 0;
  await db
    .prepare(`UPDATE profiles SET direction = ?, level = ?, known_topics = ?,
      preferences = CASE WHEN preferences = '' THEN ? ELSE preferences END,
      updated_at = CURRENT_TIMESTAMP WHERE session_id = ?`)
    .bind(
      domains.length ? `重点领域：${domains.join("、")}` : "",
      topics.length ? `${topics.length} 个专业技能点，平均掌握度估计 ${averageMastery}%` : "",
      topics.join("、"),
      "优先信息密度高、来源可信、少推广且能产生明确知识增益的内容",
      session.sessionId
    )
    .run();
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
