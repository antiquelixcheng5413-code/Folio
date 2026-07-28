import { sha256 } from "./db";
import { startInfiniTask } from "./infinisynapse";
import type { LearningProfile } from "./types";

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type DiscoverySettingsRow = {
  autoDiscoverVideos: number;
  autoAnalyzeDiscoveries: number;
};

type TopicRow = { topic: string };

type HtmlRewriterLike = {
  on(selector: string, handlers: Record<string, (value: { text?: string }) => void>): HtmlRewriterLike;
  transform(response: Response): Response;
};

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isPublicVideoUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return (
      ((host === "youtube.com" || host === "m.youtube.com") && url.pathname === "/watch") ||
      host === "youtu.be" ||
      (host.endsWith("bilibili.com") && url.pathname.startsWith("/video/")) ||
      host === "vimeo.com"
    );
  } catch {
    return false;
  }
}

async function searchPublicVideos(keyword: string): Promise<SearchResult[]> {
  const query = `${keyword} (site:youtube.com/watch OR site:bilibili.com/video OR site:vimeo.com)`;
  const response = await fetch(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, {
    headers: {
      accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      "user-agent": "Xianjian-Discovery/1.0",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`公开检索失败（${response.status}）`);

  const items: SearchResult[] = [];
  let index = -1;
  const runtime = globalThis as unknown as {
    HTMLRewriter: new () => HtmlRewriterLike;
  };
  const rewriter = new runtime.HTMLRewriter();
  rewriter.on("item", {
    element() {
      index = items.push({ title: "", url: "", snippet: "" }) - 1;
    },
  });
  rewriter.on("item title", {
    text(value) {
      if (index >= 0) items[index].title += value.text || "";
    },
  });
  rewriter.on("item link", {
    text(value) {
      if (index >= 0) items[index].url += value.text || "";
    },
  });
  rewriter.on("item description", {
    text(value) {
      if (index >= 0) items[index].snippet += value.text || "";
    },
  });
  await rewriter.transform(response).arrayBuffer();
  return items
    .map((item) => ({ title: clean(item.title), url: clean(item.url), snippet: clean(item.snippet) }))
    .filter((item) => item.title && isPublicVideoUrl(item.url));
}

async function loadTopics(db: D1Database, sessionId: string) {
  const topics = await db
    .prepare(`SELECT k.topic FROM knowledge_items k JOIN meetings m ON m.id = k.meeting_id
      WHERE k.session_id = ? AND m.state IN ('shelved', 'later', 'completed')
      ORDER BY k.created_at DESC LIMIT 20`)
    .bind(sessionId)
    .all<TopicRow>();
  return [...new Set(topics.results.map((item) => clean(item.topic)).filter(Boolean))];
}

async function startCandidateAnalysis(
  db: D1Database,
  sessionId: string,
  candidateId: string,
  candidate: SearchResult,
  topics: string[]
) {
  const today = await db
    .prepare(`SELECT COUNT(*) AS count FROM analyses
      WHERE session_id = ? AND date(created_at) = date('now')`)
    .bind(sessionId)
    .first<{ count: number }>();
  if (Number(today?.count || 0) >= 3) {
    await db.prepare(`UPDATE discovery_candidates SET error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind("今日分析额度已用完，候选已保留待确认", candidateId)
      .run();
    return;
  }

  const meetingId = crypto.randomUUID();
  const analysisId = crypto.randomUUID();
  const connId = crypto.randomUUID();
  const transcript = `VIDEO_URL:${candidate.url}`;
  const transcriptHash = await sha256(transcript);
  const profile: LearningProfile = {
    direction: `从已入架视频累计的主题：${topics.slice(0, 10).join("、")}`,
    level: `已累计 ${topics.length} 个兴趣主题`,
    project: "根据已入架视频持续推断",
    knownTopics: topics.join("、"),
    preferences: "优先信息密度高、来源可信、少推广和少重复的内容",
  };
  const inputHash = await sha256(`${transcriptHash}:${profile.knownTopics}:automatic-discovery`);
  const host = new URL(candidate.url).hostname.replace(/^www\./, "");

  await db.batch([
    db.prepare(`INSERT INTO meetings
      (id, session_id, title, source, video_url, transcript, transcript_hash, duration_seconds, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending')`)
      .bind(meetingId, sessionId, candidate.title.slice(0, 180), `自动发现 · ${host}`, candidate.url, transcript, transcriptHash),
    db.prepare(`INSERT INTO analyses
      (id, session_id, meeting_id, conn_id, input_hash, status, progress_text)
      VALUES (?, ?, ?, ?, ?, 'queued', '自动发现候选，等待连接 Agent')`)
      .bind(analysisId, sessionId, meetingId, connId, inputHash),
    db.prepare(`UPDATE discovery_candidates SET status = 'analyzing', meeting_id = ?, analysis_id = ?,
      error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?`)
      .bind(meetingId, analysisId, candidateId, sessionId),
  ]);

  try {
    const run = await startInfiniTask({
      connId,
      transcript,
      meetingTitle: candidate.title,
      profile,
      durationSeconds: 0,
      onProgress: async (progress) => {
        await db.prepare(`UPDATE analyses SET progress_text = ?, task_id = COALESCE(?, task_id),
          updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(progress.stage, progress.taskId || null, analysisId)
          .run();
      },
    });
    await db.prepare(`UPDATE analyses SET task_id = ?, status = 'recovering',
      progress_text = '自动分析运行中，可从推荐或历史记录恢复', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(run.taskId, analysisId)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "自动分析启动失败";
    await db.batch([
      db.prepare(`UPDATE analyses SET status = 'failed', error_message = ?, progress_text = '自动分析未启动',
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(message.slice(0, 1000), analysisId),
      db.prepare(`UPDATE discovery_candidates SET status = 'recommended', error_message = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(message.slice(0, 500), candidateId),
    ]);
  }
}

export async function discoverForSession(db: D1Database, sessionId: string) {
  const settings = await db.prepare(`SELECT auto_discover_videos AS autoDiscoverVideos,
    auto_analyze_discoveries AS autoAnalyzeDiscoveries FROM workspace_settings WHERE session_id = ?`)
    .bind(sessionId)
    .first<DiscoverySettingsRow>();
  if (!settings?.autoDiscoverVideos) throw new Error("请先在设置中开启自动发现视频");

  const existingToday = await db.prepare(`SELECT id FROM discovery_candidates
    WHERE session_id = ? AND date(created_at) = date('now') LIMIT 1`)
    .bind(sessionId)
    .first<{ id: string }>();
  if (existingToday) throw new Error("今天已经发现 1 条候选视频，明天再继续");

  const topics = await loadTopics(db, sessionId);
  if (!topics.length) throw new Error("请先将一个已分析视频纳入书架，用它形成兴趣关键词");
  const keyword = topics[new Date().getUTCDate() % topics.length];
  const results = await searchPublicVideos(keyword);
  let selected: SearchResult | null = null;
  for (const candidate of results.slice(0, 12)) {
    const duplicate = await db.prepare(`SELECT 1 AS found FROM discovery_candidates WHERE session_id = ? AND video_url = ?
      UNION SELECT 1 AS found FROM meetings WHERE session_id = ? AND video_url = ? LIMIT 1`)
      .bind(sessionId, candidate.url, sessionId, candidate.url)
      .first();
    if (!duplicate) {
      selected = candidate;
      break;
    }
  }
  if (!selected) throw new Error("这次没有找到新的公开视频，稍后会换关键词继续");

  const id = crypto.randomUUID();
  const source = new URL(selected.url).hostname.replace(/^www\./, "");
  await db.prepare(`INSERT INTO discovery_candidates
    (id, session_id, keyword, title, video_url, source, snippet, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'recommended')`)
    .bind(id, sessionId, keyword, selected.title.slice(0, 180), selected.url, source, selected.snippet.slice(0, 600))
    .run();
  if (settings.autoAnalyzeDiscoveries) {
    await startCandidateAnalysis(db, sessionId, id, selected, topics);
  }
  return { id, keyword, title: selected.title, videoUrl: selected.url, source };
}

export async function runScheduledDiscoveries(db: D1Database) {
  const sessions = await db.prepare(`SELECT s.id FROM sessions s JOIN workspace_settings w ON w.session_id = s.id
    WHERE w.auto_discover_videos = 1 AND s.last_seen_at >= datetime('now', '-30 days')
    ORDER BY s.last_seen_at DESC LIMIT 20`).all<{ id: string }>();
  for (const session of sessions.results) {
    try {
      await discoverForSession(db, session.id);
    } catch {
      // A later scheduled run retries after the daily or transient condition changes.
    }
  }
}
