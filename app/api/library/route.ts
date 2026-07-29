import { getD1, getSession, json } from "../../../lib/db";
import { extractLegacySkillPoints } from "../../../lib/skill-taxonomy";
import type { XianjianAnalysisResult } from "../../../lib/types";

async function repairLegacyKnowledge(db: D1Database, sessionId: string) {
  const legacy = await db
    .prepare(`SELECT DISTINCT k.analysis_id AS analysisId, k.meeting_id AS meetingId,
      a.result_json AS resultJson, m.state
      FROM knowledge_items k
      JOIN analyses a ON a.id = k.analysis_id
      JOIN meetings m ON m.id = k.meeting_id
      WHERE k.session_id = ? AND k.taxonomy_version != 'peek.taxonomy.v2'
      AND a.result_json IS NOT NULL
      LIMIT 20`)
    .bind(sessionId)
    .all<{ analysisId: string; meetingId: string; resultJson: string; state: string }>();
  for (const row of legacy.results) {
    const result = JSON.parse(row.resultJson) as XianjianAnalysisResult;
    const skills = extractLegacySkillPoints(result);
    if (!skills.length) continue;
    const engagement = row.state === "completed" ? 0.45 : 0.18;
    const statements = [
      db
        .prepare(`DELETE FROM knowledge_items WHERE session_id = ? AND analysis_id = ?
          AND taxonomy_version != 'peek.taxonomy.v2'`)
        .bind(sessionId, row.analysisId),
    ];
    for (const skill of skills) {
      const mastery = Math.round(
        (100 - skill.userMasteryBefore) *
          (skill.coverage / 100) *
          (skill.depth / 100) *
          engagement
      );
      statements.push(
        db
          .prepare(`INSERT INTO knowledge_items
            (id, session_id, meeting_id, analysis_id, topic, status, evidence,
              skill_key, category, domain, skill_type, description, prerequisites_json,
              mastery_level, confidence, coverage, depth, source_value, taxonomy_version)
            VALUES (?, ?, ?, ?, ?, 'exposed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'peek.taxonomy.v2')`)
          .bind(
            crypto.randomUUID(),
            sessionId,
            row.meetingId,
            row.analysisId,
            skill.name,
            skill.evidence.join("；"),
            skill.key,
            skill.category,
            skill.domain,
            skill.type,
            skill.description,
            JSON.stringify(skill.prerequisites),
            mastery,
            skill.confidence,
            skill.coverage,
            skill.depth,
            result.signals.value
          )
      );
    }
    await db.batch(statements);
  }
}

export async function GET(request: Request) {
  const session = await getSession(request);
  const view = new URL(request.url).searchParams.get("view") || "meetings";
  const db = getD1();
  if (view === "notes") {
    const rows = await db
      .prepare(`SELECT n.id, n.meeting_id AS meetingId, n.segment_id AS segmentId,
        n.timecode_seconds AS timecodeSeconds, n.content,
        n.created_at AS createdAt, n.updated_at AS updatedAt, m.title
        FROM notes n JOIN meetings m ON m.id = n.meeting_id
        WHERE n.session_id = ? ORDER BY n.updated_at DESC LIMIT 100`)
      .bind(session.sessionId)
      .all();
    return json({ view, items: rows.results }, {}, session.cookie);
  }
  if (view === "knowledge") {
    await repairLegacyKnowledge(db, session.sessionId);
    const rows = await db
      .prepare(`SELECT k.id, k.meeting_id AS meetingId, k.analysis_id AS analysisId,
        k.topic, k.status, k.evidence, k.skill_key AS skillKey, k.category, k.domain,
        k.skill_type AS skillType, k.description,
        k.prerequisites_json AS prerequisitesJson,
        k.mastery_level AS masteryLevel, k.confidence, k.coverage, k.depth,
        k.source_value AS sourceValue, k.created_at AS createdAt, m.title
        FROM knowledge_items k JOIN meetings m ON m.id = k.meeting_id
        WHERE k.session_id = ?
        AND m.state IN ('shelved', 'later', 'completed')
        ORDER BY k.created_at DESC LIMIT 100`)
      .bind(session.sessionId)
      .all();
    return json({ view, items: rows.results }, {}, session.cookie);
  }
  const rows = await db
    .prepare(`SELECT m.id, m.title, m.source, m.content_type AS contentType,
      m.video_url AS contentUrl, m.video_url AS videoUrl, m.duration_seconds AS durationSeconds,
      m.state, m.created_at AS createdAt, a.id AS analysisId, a.status,
      a.progress_text AS progressText, a.task_id AS taskId, a.result_json AS resultJson,
      (SELECT COUNT(*) FROM notes n WHERE n.meeting_id = m.id AND n.session_id = ?) AS noteCount
      FROM meetings m
      LEFT JOIN analyses a ON a.id = (
        SELECT id FROM analyses WHERE meeting_id = m.id ORDER BY created_at DESC LIMIT 1
      )
      WHERE m.session_id = ? ORDER BY m.created_at DESC LIMIT 100`)
    .bind(session.sessionId, session.sessionId)
    .all();
  const items = rows.results.map((row: Record<string, unknown>) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      result: item.resultJson ? JSON.parse(String(item.resultJson)) : null,
      resultJson: undefined,
    };
  });
  return json({ view: "meetings", items }, {}, session.cookie);
}
