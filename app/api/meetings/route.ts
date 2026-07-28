import {
  getD1,
  getSession,
  json,
  parseTimecodeDuration,
  sha256,
} from "../../../lib/db";
import type { ContentType } from "../../../lib/types";

const CONTENT_TYPES = new Set<ContentType>(["video", "article", "paper"]);

export async function GET(request: Request) {
  const session = await getSession(request);
  const rows = await getD1()
    .prepare(`SELECT m.id, m.title, m.source, m.content_type AS contentType,
      m.video_url AS contentUrl, m.video_url AS videoUrl, m.duration_seconds AS durationSeconds,
      m.state, m.created_at AS createdAt,
      a.id AS analysisId, a.status, a.progress_text AS progressText,
      a.task_id AS taskId, a.result_json AS resultJson
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
    contentUrl?: string;
    contentType?: ContentType;
  };
  const contentType = CONTENT_TYPES.has(payload.contentType || "video")
    ? (payload.contentType || "video")
    : "video";
  const contentUrl = payload.contentUrl?.trim() || payload.videoUrl?.trim() || "";
  let normalizedContentUrl = "";
  if (contentUrl) {
    try {
      const parsed = new URL(contentUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      if (
        /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?$)/i.test(
          parsed.hostname
        )
      ) {
        throw new Error();
      }
      normalizedContentUrl = parsed.toString();
    } catch {
      return json(
        { error: "请提供可公开访问的 http(s) 内容链接" },
        { status: 400 },
        session.cookie
      );
    }
  }
  const contentHost = normalizedContentUrl ? new URL(normalizedContentUrl).hostname.replace(/^www\./, "") : "";
  const typeLabel = contentType === "video" ? "视频" : contentType === "paper" ? "论文" : "文章";
  const title =
    payload.title?.trim() ||
    (contentHost ? `${contentHost} ${typeLabel}` : "");
  const titleIsManual = Boolean(payload.title?.trim());
  const source =
    payload.source?.trim() ||
    (contentHost ? `${typeLabel}链接 · ${contentHost}` : "用户导入");
  const marker = contentType === "video" ? "VIDEO_URL" : contentType === "paper" ? "PAPER_URL" : "ARTICLE_URL";
  const transcript =
    payload.transcript?.trim() ||
    (normalizedContentUrl ? `${marker}:${normalizedContentUrl}` : "");
  if (!title) {
    return json({ error: "请输入会议标题" }, { status: 400 }, session.cookie);
  }
  if (!normalizedContentUrl && transcript.length < 500) {
    return json(
      { error: "内容太短，请至少提供 500 个字符" },
      { status: 400 },
      session.cookie
    );
  }
  if (transcript.length > 80_000) {
    return json(
      { error: "内容超过 80,000 字符，请拆分后再分析" },
      { status: 413 },
      session.cookie
    );
  }
  const id = crypto.randomUUID();
  const transcriptHash = await sha256(transcript);
  const durationSeconds = contentType === "video" && !normalizedContentUrl
    ? parseTimecodeDuration(transcript)
    : 0;
  if (contentType === "video" && !normalizedContentUrl && !durationSeconds) {
    return json(
      { error: "没有识别到有效时间码，请使用 SRT、VTT 或带 HH:MM:SS 的文本" },
      { status: 400 },
      session.cookie
    );
  }
  await getD1()
    .prepare(`INSERT INTO meetings
      (id, session_id, title, source, content_type, video_url, title_is_manual, transcript, transcript_hash, duration_seconds, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
    .bind(
      id,
      session.sessionId,
      title.slice(0, 180),
      source.slice(0, 180),
      contentType,
      normalizedContentUrl || null,
      titleIsManual ? 1 : 0,
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
        contentType,
        contentUrl: normalizedContentUrl || null,
        videoUrl: contentType === "video" ? normalizedContentUrl || null : null,
        durationSeconds,
        state: "pending",
      },
    },
    { status: 201 },
    session.cookie
  );
}
