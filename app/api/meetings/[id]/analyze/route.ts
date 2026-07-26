import { getD1, getSession, sha256 } from "../../../../../lib/db";
import { startInfiniTask } from "../../../../../lib/infinisynapse";
import type { LearningProfile } from "../../../../../lib/types";

type MeetingRow = {
  id: string;
  title: string;
  transcript: string;
  transcriptHash: string;
  durationSeconds: number;
};

function sse(controller: ReadableStreamDefaultController, event: string, data: unknown) {
  controller.enqueue(
    new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  const { id } = await context.params;
  const db = getD1();
  const meeting = await db
    .prepare(`SELECT id, title, transcript, transcript_hash AS transcriptHash,
      duration_seconds AS durationSeconds
      FROM meetings WHERE id = ? AND session_id = ?`)
    .bind(id, session.sessionId)
    .first<MeetingRow>();
  if (!meeting) {
    return new Response(JSON.stringify({ error: "会议不存在" }), {
      status: 404,
      headers: { "content-type": "application/json", ...(session.cookie ? { "set-cookie": session.cookie } : {}) },
    });
  }
  if (!meeting.transcript || meeting.transcript.startsWith("[已按隐私策略清理]")) {
    return new Response(JSON.stringify({ error: "原字幕已清理，不能重复发起新分析" }), {
      status: 409,
      headers: { "content-type": "application/json", ...(session.cookie ? { "set-cookie": session.cookie } : {}) },
    });
  }
  const profile = await db
    .prepare(`SELECT direction, level, project, known_topics AS knownTopics,
      preferences FROM profiles WHERE session_id = ?`)
    .bind(session.sessionId)
    .first<LearningProfile>();
  if (!profile) {
    return new Response(JSON.stringify({ error: "个人画像不存在" }), {
      status: 400,
      headers: { "content-type": "application/json", ...(session.cookie ? { "set-cookie": session.cookie } : {}) },
    });
  }
  const today = await db
    .prepare(`SELECT COUNT(*) AS count FROM analyses
      WHERE session_id = ? AND date(created_at) = date('now')`)
    .bind(session.sessionId)
    .first<{ count: number }>();
  if (Number(today?.count || 0) >= 3) {
    return new Response(JSON.stringify({ error: "今日 3 次真实分析额度已用完，请明天再试" }), {
      status: 429,
      headers: { "content-type": "application/json", ...(session.cookie ? { "set-cookie": session.cookie } : {}) },
    });
  }
  const inputHash = await sha256(
    `${meeting.transcriptHash}:${profile.direction}:${profile.level}:${profile.project}:${profile.knownTopics}:${profile.preferences}`
  );
  const duplicate = await db
    .prepare(`SELECT id, status, task_id AS taskId, result_json AS resultJson
      FROM analyses WHERE session_id = ? AND input_hash = ?
      AND status IN ('queued', 'running', 'completed', 'recovering')
      ORDER BY created_at DESC LIMIT 1`)
    .bind(session.sessionId, inputHash)
    .first<{ id: string; status: string; taskId: string | null; resultJson: string | null }>();
  if (duplicate) {
    const stream = new ReadableStream({
      start(controller) {
        sse(controller, "deduplicated", {
          analysisId: duplicate.id,
          status: duplicate.status,
          taskId: duplicate.taskId,
          result: duplicate.resultJson ? JSON.parse(duplicate.resultJson) : null,
        });
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        ...(session.cookie ? { "set-cookie": session.cookie } : {}),
      },
    });
  }

  const analysisId = crypto.randomUUID();
  const connId = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO analyses
      (id, session_id, meeting_id, conn_id, input_hash, status, progress_text)
      VALUES (?, ?, ?, ?, ?, 'queued', '等待连接 Agent')`)
    .bind(analysisId, session.sessionId, meeting.id, connId, inputHash)
    .run();

  const stream = new ReadableStream({
    async start(controller) {
      sse(controller, "created", { analysisId, connId });
      try {
        await db
          .prepare(`UPDATE analyses SET status = 'running', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`)
          .bind(analysisId)
          .run();
        const run = await startInfiniTask({
          connId,
          transcript: meeting.transcript,
          meetingTitle: meeting.title,
          profile,
          durationSeconds: meeting.durationSeconds,
          onProgress: async (progress) => {
            await db
              .prepare(`UPDATE analyses SET progress_text = ?,
                task_id = COALESCE(?, task_id), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
              .bind(progress.stage, progress.taskId || null, analysisId)
              .run();
            sse(controller, "progress", { analysisId, ...progress });
          },
        });
        await db
          .prepare(`UPDATE analyses SET task_id = ?, status = 'recovering',
            progress_text = '真实任务运行中，可刷新恢复',
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(run.taskId, analysisId)
          .run();
        sse(controller, "started", {
          analysisId,
          taskId: run.taskId,
          status: "recovering",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "分析失败";
        const taskMatch = message.match(/[0-9a-f-]{20,}/i)?.[0] || null;
        await db
          .prepare(`UPDATE analyses SET status = ?, error_message = ?,
            task_id = COALESCE(?, task_id), progress_text = ?,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(
            taskMatch ? "recovering" : "failed",
            message.slice(0, 1000),
            taskMatch,
            taskMatch ? "任务可恢复" : "分析失败",
            analysisId
          )
          .run();
        sse(controller, "error", { analysisId, error: message, taskId: taskMatch });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      ...(session.cookie ? { "set-cookie": session.cookie } : {}),
    },
  });
}
