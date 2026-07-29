import { getD1, getSession, getWorkspaceSettings, json } from "../../../../lib/db";
import {
  recoverInfiniTask,
  requestInfiniRepair,
} from "../../../../lib/infinisynapse";
import {
  recalculatePersonalMatch,
  skillKey,
  type StoredProfileSkill,
} from "../../../../lib/personalization";
import type { ContentType, XianjianAnalysisResult } from "../../../../lib/types";

type AnalysisRow = {
  id: string;
  meetingId: string;
  meetingState: string;
  title: string;
  source: string;
  videoUrl: string | null;
  contentUrl: string | null;
  contentType: ContentType;
  titleIsManual: number;
  durationSeconds: number;
  status: string;
  progressText: string;
  taskId: string | null;
  connId: string;
  resultJson: string | null;
  errorMessage: string | null;
  createdAt: string;
};

function automaticNoteContent(result: XianjianAnalysisResult) {
  const highlights = result.evidence.slice(0, 6).map((item) => `- ${item}`);
  const coreSegments = result.segments
    .filter((segment) => segment.decision === "watch")
    .slice(0, 6)
    .map((segment) => `- ${segment.title}：${segment.value}${segment.evidence ? `（依据：${segment.evidence}）` : ""}`);
  const newKnowledge = result.newKnowledge.slice(0, 6).map((item) => `- ${item.topic}：${item.evidence}`);
  const repeated = result.repeatedKnowledge.slice(0, 4).map((item) => `- ${item.topic}：${item.evidence}`);
  const professionalSkills = (result.skillAssessment?.skills || []).slice(0, 10).map(
    (item) =>
      `- ${item.domain}／${item.name}（${item.type}）：${item.description}；学完可做到：${item.learningOutcome}；覆盖 ${item.coverage}%，深度 ${item.depth}%`
  );
  return [
    "# 核心结论",
    result.summary,
    "",
    "## 文章／视频核心总结",
    ...(highlights.length ? highlights : ["- 暂无可独立提取的核心结论。"]),
    "",
    "## 关键概念与具体内容",
    ...(coreSegments.length ? coreSegments : ["- 本次报告没有标出建议保留的核心片段。"]),
    "",
    "## 新增知识",
    ...(newKnowledge.length ? newKnowledge : ["- 暂无明确新增知识。"]),
    "",
    "## 专业技能点",
    ...(professionalSkills.length
      ? professionalSkills
      : ["- 旧报告尚未包含专业技能点模型，可重新分析后生成。"]),
    ...(repeated.length ? ["", "## 已知或重复内容", ...repeated] : []),
    "",
    "## 判断依据",
    `- 匹配度 ${result.signals.match}%：${result.signals.matchReason}`,
    `- 内容含金量 ${result.signals.value}%：${result.signals.valueReason}`,
    ...(result.personalization
      ? [`- 动态匹配公式：${result.personalization.basis}`]
      : []),
    "",
    "## 可继续追问",
    "- 哪个概念最值得深入？它与我已有知识有什么关系？",
    "- 报告中的结论有哪些前提或证据限制？",
  ].join("\n");
}

async function createAutomaticNote(
  db: D1Database,
  sessionId: string,
  meetingId: string,
  analysisId: string,
  result: XianjianAnalysisResult
) {
  const settings = await getWorkspaceSettings(sessionId);
  if (!settings.autoCreateNote) return;
  const segmentId = `analysis-summary:${analysisId}`;
  await db
    .prepare(`INSERT INTO notes
      (id, session_id, meeting_id, segment_id, timecode_seconds, content)
      SELECT ?, ?, ?, ?, NULL, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM notes WHERE session_id = ? AND meeting_id = ? AND segment_id = ?
      )`)
    .bind(
      crypto.randomUUID(),
      sessionId,
      meetingId,
      segmentId,
      automaticNoteContent(result).slice(0, 4000),
      sessionId,
      meetingId,
      segmentId
    )
    .run();
}

async function applyAutomaticTitle(
  db: D1Database,
  sessionId: string,
  meetingId: string,
  titleIsManual: number,
  result: XianjianAnalysisResult
) {
  const generatedTitle = result.contentTitle?.trim();
  if (titleIsManual || !generatedTitle) return null;
  const settings = await getWorkspaceSettings(sessionId);
  if (settings.titleMode !== "automatic") return null;
  const title = generatedTitle.slice(0, 180);
  await db
    .prepare(`UPDATE meetings SET title = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND session_id = ? AND title_is_manual = 0`)
    .bind(title, meetingId, sessionId)
    .run();
  return title;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  const { id } = await context.params;
  const db = getD1();
  const row = await db
    .prepare(`SELECT a.id, a.meeting_id AS meetingId, m.title, m.source,
      m.content_type AS contentType, m.video_url AS contentUrl, m.video_url AS videoUrl,
      m.state AS meetingState, m.title_is_manual AS titleIsManual,
      m.duration_seconds AS durationSeconds, a.status,
      a.progress_text AS progressText, a.task_id AS taskId,
      a.conn_id AS connId,
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
    ["running", "recovering", "repairing"].includes(row.status)
  ) {
    try {
      const recovered = await recoverInfiniTask(row.taskId, row.durationSeconds, row.contentType);
      if (recovered.result) {
        row.status = "completed";
        row.progressText = "已从 InfiniSynapse 恢复";
        row.resultJson = JSON.stringify(recovered.result);
        await db
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
        try {
          await createAutomaticNote(db, session.sessionId, row.meetingId, id, recovered.result);
        } catch {
          // A note should never prevent an otherwise completed analysis from opening.
        }
        const generatedTitle = await applyAutomaticTitle(
          db,
          session.sessionId,
          row.meetingId,
          row.titleIsManual,
          recovered.result
        );
        if (generatedTitle) row.title = generatedTitle;
        await db
          .prepare(`UPDATE meetings SET transcript = '[已按隐私策略清理]',
            updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?`)
          .bind(row.meetingId, session.sessionId)
          .run();
      } else if (
        row.status === "recovering" &&
        (recovered.taskInfo as { status?: string } | null)?.status === "completed"
      ) {
        row.status = "repairing";
        row.progressText = "Agent 已完成，正在修复 JSON 结果";
        const claimed = await db
          .prepare(`UPDATE analyses SET status = 'repairing', progress_text = ?,
            updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?
            AND status = 'recovering'`)
          .bind(row.progressText, id, session.sessionId)
          .run();
        if ((claimed.meta?.changes || 0) > 0) {
          await requestInfiniRepair(row.taskId, row.connId, row.contentType);
        }
      }
    } catch {
      // Keep the durable local state and allow a later retry.
    }
  }

  if (row.resultJson) {
    const profileRows = await db
      .prepare(`SELECT k.meeting_id AS meetingId, k.topic, k.skill_key AS skillKey,
        k.domain, k.mastery_level AS mastery, k.confidence
        FROM knowledge_items k JOIN meetings m ON m.id = k.meeting_id
        WHERE k.session_id = ? AND k.meeting_id != ?
        AND m.state IN ('shelved', 'later', 'completed')
        ORDER BY k.created_at DESC LIMIT 200`)
      .bind(session.sessionId, row.meetingId)
      .all<{
        meetingId: string;
        topic: string;
        skillKey: string;
        domain: string;
        mastery: number;
        confidence: number;
      }>();
    const profileMap = new Map<string, StoredProfileSkill>();
    for (const item of profileRows.results) {
      const key = item.skillKey || skillKey(item.domain || "未分类", item.topic);
      const previous = profileMap.get(key);
      profileMap.set(key, {
        meetingId: item.meetingId,
        key,
        name: item.topic,
        domain: item.domain || "未分类",
        mastery: Math.max(previous?.mastery || 0, Number(item.mastery || 0)),
        confidence: Math.max(previous?.confidence || 0, Number(item.confidence || 0)),
      });
    }
    const current = JSON.parse(row.resultJson) as XianjianAnalysisResult;
    const personalized = recalculatePersonalMatch(current, [...profileMap.values()]);
    const fingerprintChanged =
      current.personalization?.profileFingerprint !==
      personalized.personalization?.profileFingerprint;
    const scoreChanged = current.signals.match !== personalized.signals.match;
    if (fingerprintChanged || scoreChanged) {
      row.resultJson = JSON.stringify(personalized);
      await db
        .prepare(`UPDATE analyses SET result_json = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND session_id = ?`)
        .bind(row.resultJson, id, session.sessionId)
        .run();
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
