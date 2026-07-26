import {
  getD1,
  getSession,
  json,
  parseTimecodeDuration,
  sha256,
} from "../../../lib/db";

export async function GET(request: Request) {
  const session = await getSession(request);
  const rows = await getD1()
    .prepare(`SELECT m.id, m.title, m.source, m.duration_seconds AS durationSeconds,
      m.state, m.created_at AS createdAt,
      a.id AS analysisId, a.status, a.task_id AS taskId, a.result_json AS resultJson
      FROM meetings m
      LEFT JOIN analyses a ON a.id = (
        SELECT id FROM analyses WHERE meeting_id = m.id ORDER BY created_at DESC LIMIT 1
      )
      WHERE m.session_id = ?
      ORDER BY m.created_at DESC LIMIT 30`)
    .bind(session.sessionId)
    .all();
  return json({ meetings: rows.results }, {}, session.cookie);
}

export async function POST(request: Request) {
  const session = await getSession(request);
  const payload = (await request.json()) as {
    title?: string;
    source?: string;
    transcript?: string;
    videoUrl?: string;
  };
  const videoUrl = payload.videoUrl?.trim() || "";
  let normalizedVideoUrl = "";
  if (videoUrl) {
    try {
      const parsed = new URL(videoUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      if (
        /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?$)/i.test(
          parsed.hostname
        )
      ) {
        throw new Error();
      }
      normalizedVideoUrl = parsed.toString();
    } catch {
      return json(
        { error: "请提供可公开访问的 http(s) 视频链接" },
        { status: 400 },
        session.cookie
      );
    }
  }
  const videoHost = normalizedVideoUrl ? new URL(normalizedVideoUrl).hostname.replace(/^www\./, "") : "";
  const title =
    payload.title?.trim() ||
    (videoHost ? `${videoHost} 视频` : "");
  const source =
    payload.source?.trim() ||
    (videoHost ? `视频链接 · ${videoHost}` : "用户导入");
  const transcript =
    payload.transcript?.trim() ||
    (normalizedVideoUrl ? `VIDEO_URL:${normalizedVideoUrl}` : "");
  if (!title) {
    return json({ error: "请输入会议标题" }, { status: 400 }, session.cookie);
  }
  if (!normalizedVideoUrl && transcript.length < 500) {
    return json(
      { error: "字幕内容太短，请至少提供 500 个字符" },
      { status: 400 },
      session.cookie
    );
  }
  if (transcript.length > 80_000) {
    return json(
      { error: "字幕超过 80,000 字符，请拆分后再分析" },
      { status: 413 },
      session.cookie
    );
  }
  const id = crypto.randomUUID();
  const transcriptHash = await sha256(transcript);
  const durationSeconds = normalizedVideoUrl ? 0 : parseTimecodeDuration(transcript);
  if (!normalizedVideoUrl && !durationSeconds) {
    return json(
      { error: "没有识别到有效时间码，请使用 SRT、VTT 或带 HH:MM:SS 的文本" },
      { status: 400 },
      session.cookie
    );
  }
  await getD1()
    .prepare(`INSERT INTO meetings
      (id, session_id, title, source, transcript, transcript_hash, duration_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      session.sessionId,
      title.slice(0, 180),
      source.slice(0, 180),
      transcript,
      transcriptHash,
      durationSeconds
    )
    .run();
  return json(
    {
      meeting: {
        id,
        title,
        source,
        videoUrl: normalizedVideoUrl || null,
        durationSeconds,
        state: "archived",
      },
    },
    { status: 201 },
    session.cookie
  );
}
