import { getD1, getSession, json } from "../../../lib/db";
import { discoverForSession } from "../../../lib/discovery";

export async function GET(request: Request) {
  const session = await getSession(request);
  const rows = await getD1()
    .prepare(`SELECT d.id, d.keyword, d.title, d.video_url AS videoUrl, d.source,
      d.snippet, d.status, d.meeting_id AS meetingId, d.analysis_id AS analysisId,
      d.error_message AS errorMessage, d.created_at AS createdAt,
      a.status AS analysisStatus, a.result_json AS resultJson
      FROM discovery_candidates d
      LEFT JOIN analyses a ON a.id = d.analysis_id
      WHERE d.session_id = ? AND d.status != 'dismissed'
      ORDER BY d.created_at DESC LIMIT 20`)
    .bind(session.sessionId)
    .all<Record<string, unknown>>();
  const items = rows.results.map((item) => ({
    ...item,
    result: item.resultJson ? JSON.parse(String(item.resultJson)) : null,
    resultJson: undefined,
  }));
  return json({ items }, {}, session.cookie);
}

export async function POST(request: Request) {
  const session = await getSession(request);
  const payload = (await request.json().catch(() => ({}))) as { action?: string; id?: string };
  if (payload.action === "run") {
    try {
      const candidate = await discoverForSession(getD1(), session.sessionId);
      return json({ candidate }, { status: 201 }, session.cookie);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "自动发现失败" }, { status: 409 }, session.cookie);
    }
  }
  if (payload.action === "dismiss" && payload.id) {
    const result = await getD1()
      .prepare(`UPDATE discovery_candidates SET status = 'dismissed', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND session_id = ?`)
      .bind(payload.id, session.sessionId)
      .run();
    if (!result.meta.changes) return json({ error: "候选视频不存在" }, { status: 404 }, session.cookie);
    return json({ dismissed: true }, {}, session.cookie);
  }
  return json({ error: "无效的候选操作" }, { status: 400 }, session.cookie);
}
