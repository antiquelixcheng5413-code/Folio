"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ContentType, LearningProfile, XianjianAnalysisResult } from "../lib/types";
import { ConnectInfiniModal, type AuthStatus } from "./connect-infini-modal";

type View = "home" | "tasks" | "later" | "history" | "notes" | "skills" | "settings" | "progress" | "detail";
type Language = "zh" | "en";
type Analysis = {
  id: string;
  meetingId: string;
  meetingState: string;
  title: string;
  source: string;
  contentType: ContentType;
  contentUrl?: string | null;
  videoUrl?: string | null;
  status: string;
  progressText: string;
  taskId: string | null;
  errorMessage?: string | null;
  result: XianjianAnalysisResult | null;
  createdAt?: string;
};
type MeetingItem = {
  id: string;
  title: string;
  source: string;
  contentType?: ContentType;
  contentUrl?: string | null;
  videoUrl?: string | null;
  durationSeconds: number;
  state: string;
  createdAt: string;
  analysisId?: string;
  status?: string;
  progressText?: string;
  taskId?: string;
  noteCount?: number;
  result?: XianjianAnalysisResult | null;
};
type NoteItem = {
  id: string;
  meetingId: string;
  segmentId?: string | null;
  timecodeSeconds?: number | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  title: string;
};
type DemoPayload = {
  demo: { title: string; source: string; transcript: string };
  profiles: Array<{ id: string; name: string; profile: LearningProfile }>;
};
type WorkspaceSettings = {
  autoCreateNote: boolean;
  autoDiscoverVideos: boolean;
  autoAnalyzeDiscoveries: boolean;
  titleMode: "automatic" | "source";
};
type DiscoveryItem = {
  id: string;
  keyword: string;
  title: string;
  videoUrl: string;
  source: string;
  snippet: string;
  status: string;
  meetingId?: string | null;
  analysisId?: string | null;
  analysisStatus?: string | null;
  errorMessage?: string | null;
  result?: XianjianAnalysisResult | null;
};
type LearningAnswerPayload = {
  answer: string;
  note: string;
  evidence?: string[];
  confidence?: "high" | "medium" | "low";
};

const SHELF_STATES = new Set(["shelved", "later", "completed"]);
const ACTIVE_ANALYSIS_STATUSES = new Set(["queued", "running", "recovering", "repairing"]);

function isOnShelf(state?: string) {
  return SHELF_STATES.has(state || "");
}

function isAnalysisActive(status?: string) {
  return ACTIVE_ANALYSIS_STATUSES.has(status || "");
}

function analysisPreview(item: MeetingItem, language: Language): Analysis {
  const progressText = item.progressText || (item.status === "queued"
    ? (language === "zh" ? "等待开始分析" : "Waiting to start")
    : item.status === "repairing"
      ? (language === "zh" ? "正在整理分析结果" : "Preparing the result")
      : (language === "zh" ? "正在分析内容" : "Analyzing the content"));
  return {
    id: item.analysisId || "",
    createdAt: item.createdAt,
    meetingId: item.id,
    meetingState: item.state,
    title: item.title,
    source: item.source,
    contentType: item.contentType || "video",
    contentUrl: item.contentUrl || item.videoUrl || null,
    videoUrl: item.videoUrl || null,
    status: item.status || "recovering",
    progressText,
    taskId: item.taskId || null,
    result: item.result || null,
  };
}

function replaceAnalysisUrl(analysisId?: string) {
  const url = new URL(window.location.href);
  if (analysisId) url.searchParams.set("analysis", analysisId);
  else url.searchParams.delete("analysis");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function contentValueScore(result: XianjianAnalysisResult) {
  if (Number.isFinite(result.signals.value)) return result.signals.value;
  return Math.round(
    result.signals.depth * 0.35 +
      result.signals.sourceReliability * 0.35 +
      (100 - result.signals.promotion) * 0.15 +
      (100 - result.signals.repetition) * 0.15
  );
}

function scoreBand(score: number, language: Language) {
  if (score >= 75) return language === "zh" ? "高" : "High";
  if (score >= 45) return language === "zh" ? "中" : "Medium";
  return language === "zh" ? "低" : "Low";
}

function analysisStageLabel(status: string | undefined, language: Language) {
  const labels: Record<string, [string, string]> = {
    queued: ["等待中", "Waiting"],
    running: ["分析中", "Analyzing"],
    recovering: ["分析中", "Analyzing"],
    repairing: ["整理中", "Preparing"],
    completed: ["已完成", "Complete"],
    failed: ["未完成", "Failed"],
    cancelled: ["已取消", "Cancelled"],
  };
  const label = labels[status || "queued"] || labels.queued;
  return language === "zh" ? label[0] : label[1];
}

function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="info-tip" tabIndex={0} aria-label={label}>
      <b aria-hidden="true">?</b>
      <span role="tooltip">{children}</span>
    </span>
  );
}

function playbackUrl(videoUrl: string, seconds: number) {
  const url = new URL(videoUrl);
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const start = String(Math.max(0, Math.floor(seconds)));
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    url.searchParams.set("t", start);
  } else if (host.endsWith("bilibili.com")) {
    url.searchParams.set("t", start);
  } else if (host === "vimeo.com" || host.endsWith("vimeo.com")) {
    url.hash = `t=${start}s`;
  } else {
    url.hash = `t=${start}`;
  }
  return url.toString();
}

function contentTypeLabel(contentType: ContentType, language: Language) {
  if (language === "zh") return contentType === "paper" ? "论文" : contentType === "article" ? "文章" : "视频";
  return contentType === "paper" ? "Paper" : contentType === "article" ? "Article" : "Video";
}

function contentLocatorUrl(contentUrl: string, segment: XianjianAnalysisResult["segments"][number]) {
  try {
    const url = new URL(contentUrl);
    if (segment.locator?.pageNumber) {
      url.hash = `page=${segment.locator.pageNumber}`;
    } else if (segment.locator?.quote) {
      url.hash = `:~:text=${encodeURIComponent(segment.locator.quote.slice(0, 180))}`;
    }
    return url.toString();
  } catch {
    return contentUrl;
  }
}

const copy = {
  zh: {
    workspace: "今天",
    home: "首页",
    tasks: "运行中",
    later: "书架",
    history: "历史记录",
    notes: "笔记",
    skills: "技能树",
    settings: "设置",
    detail: "内容分析",
    search: "搜索视频、文章、论文或观点",
    add: "添加内容",
    worth: "值得看",
    selective: "选择性看",
    skip: "可以跳过",
    open: "看路线",
    noItems: "这里还没有记录。添加视频、文章或论文链接，Peek 会替你先读。",
  },
  en: {
    workspace: "Workspace",
    home: "Home",
    tasks: "Running",
    later: "Library",
    history: "History",
    notes: "Notes",
    skills: "Skill tree",
    settings: "Settings",
    detail: "Content analysis",
    search: "Search videos, articles, papers or ideas",
    add: "Add content",
    worth: "Worth watching",
    selective: "Watch selectively",
    skip: "Safe to skip",
    open: "View route",
    noItems: "No records yet. Add a video, article or paper for Peek to review.",
  },
} as const;

function formatTime(seconds = 0) {
  const value = Math.max(0, Math.round(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes} min`;
}

function timecode(seconds = 0) {
  const value = Math.max(0, Math.round(seconds));
  return [Math.floor(value / 3600), Math.floor((value % 3600) / 60), value % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function verdictLabel(verdict: XianjianAnalysisResult["verdict"], language: Language) {
  return copy[language][verdict];
}

function currentDateLabel(language: Language) {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: language === "zh" ? "long" : "short",
    day: "numeric",
    weekday: "long",
  }).format(new Date()).toUpperCase();
}

async function api<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

function PeekMark({ compact = false }: { compact?: boolean }) {
  return <span className={`peek-mark${compact ? " compact" : ""}`} aria-hidden="true"><i /></span>;
}

function NavIcon({ kind }: { kind: "home" | "tasks" | "later" | "history" | "notes" | "skills" }) {
  const paths = {
    home: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    tasks: <><path d="M5 6h9M5 12h14M5 18h11" /><path d="m16 4 4 2-4 2z" /></>,
    later: <><path d="M6 3h12v18l-6-4-6 4z" /><path d="M9 8h6" /></>,
    history: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h2M14 14h2" /></>,
    notes: <><path d="M5 3h11l3 3v15H5z" /><path d="M16 3v4h4M9 11h6M9 15h6M9 19h4" /></>,
    skills: <><circle cx="12" cy="5" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M12 7v4M12 11 6 16M12 11l6 5" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>;
}

export default function PeekApp() {
  const [view, setView] = useState<View>("home");
  const [previousView, setPreviousView] = useState<View>("home");
  const [language, setLanguage] = useState<Language>("zh");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [fontSize, setFontSize] = useState<"small" | "medium" | "large">("medium");
  const [query, setQuery] = useState("");
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [knowledge, setKnowledge] = useState<Record<string, unknown>[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings>({
    autoCreateNote: true,
    autoDiscoverVideos: false,
    autoAnalyzeDiscoveries: false,
    titleMode: "automatic",
  });
  const [discoveries, setDiscoveries] = useState<DiscoveryItem[]>([]);
  const [demo, setDemo] = useState<DemoPayload | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [taskListOpen, setTaskListOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    configured: false,
    authenticated: false,
    user: null,
  });
  const restoredOnLoad = useRef(false);
  const analysisRequestVersion = useRef(0);
  const t = copy[language];

  useEffect(() => {
    const saved = window.localStorage.getItem("peek-font-size");
    if (saved === "small" || saved === "medium" || saved === "large") setFontSize(saved);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.fontSize = fontSize;
    window.localStorage.setItem("peek-font-size", fontSize);
  }, [fontSize]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  const loadMeetings = useCallback(async () => {
    const payload = await api<{ items: MeetingItem[] }>("/api/library?view=meetings");
    setMeetings(payload.items || []);
  }, []);

  const loadKnowledge = useCallback(async () => {
    const payload = await api<{ items: Record<string, unknown>[] }>("/api/library?view=knowledge");
    setKnowledge(payload.items || []);
  }, []);

  const loadNotes = useCallback(async () => {
    const payload = await api<{ items: NoteItem[] }>("/api/library?view=notes");
    setNotes(payload.items || []);
  }, []);

  const loadDiscoveries = useCallback(async () => {
    const payload = await api<{ items: DiscoveryItem[] }>("/api/discoveries");
    setDiscoveries(payload.items || []);
  }, []);

  useEffect(() => {
    if (restoredOnLoad.current) return;
    restoredOnLoad.current = true;
    Promise.all([
      api<DemoPayload>("/api/demo"),
      api<{ items: MeetingItem[] }>("/api/library?view=meetings"),
      api<{ items: Record<string, unknown>[] }>("/api/library?view=knowledge"),
      api<{ items: NoteItem[] }>("/api/library?view=notes"),
      api<{ settings: WorkspaceSettings }>("/api/settings"),
      api<{ items: DiscoveryItem[] }>("/api/discoveries"),
      api<AuthStatus>("/api/auth/status"),
    ])
      .then(([demoPayload, meetingPayload, knowledgePayload, notesPayload, settingsPayload, discoveryPayload, accountPayload]) => {
        const loadedMeetings = meetingPayload.items || [];
        setDemo(demoPayload);
        setMeetings(loadedMeetings);
        setKnowledge(knowledgePayload.items || []);
        setNotes(notesPayload.items || []);
        setWorkspaceSettings(settingsPayload.settings);
        setDiscoveries(discoveryPayload.items || []);
        setAuthStatus(accountPayload);
        const authResult = new URL(window.location.href).searchParams.get("auth");
        if (authResult === "success") notify(language === "zh" ? "登录成功，学习空间已同步" : "Signed in. Your workspace is synced.");
        if (authResult === "error") notify(new URL(window.location.href).searchParams.get("reason") || (language === "zh" ? "登录失败，请重试" : "Sign-in failed."));
        if (authResult) {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("auth");
          cleanUrl.searchParams.delete("reason");
          window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
        }
        const requestedAnalysisId = new URL(window.location.href).searchParams.get("analysis");
        const activeItems = loadedMeetings.filter((item) => isAnalysisActive(item.status));
        if (requestedAnalysisId) {
          const requestedMeeting = activeItems.find((item) => item.analysisId === requestedAnalysisId);
          if (requestedMeeting) {
            setAnalysis(analysisPreview(requestedMeeting, language));
            setView("progress");
          }
          void openAnalysis(requestedAnalysisId);
        } else if (activeItems.length) {
          setView("tasks");
        }
      })
      .catch((error) => notify(error instanceof Error ? error.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [notify]);

  const navigate = useCallback((next: View) => {
    if (next !== "progress" && next !== "detail") {
      analysisRequestVersion.current += 1;
      setPreviousView(next);
      replaceAnalysisUrl();
    }
    setView(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  async function pollAnalysis(analysisId: string, requestVersion: number) {
    const deadline = Date.now() + 12 * 60 * 1000;
    while (Date.now() < deadline) {
      if (analysisRequestVersion.current !== requestVersion) return;
      const payload = await api<{ analysis: Analysis }>(`/api/analyses/${analysisId}`);
      if (analysisRequestVersion.current !== requestVersion) return;
      setAnalysis(payload.analysis);
      if (payload.analysis.result) {
        setView("detail");
        notify(language === "zh" ? "分析完成，请决定是否纳入书架" : "Analysis complete. Choose whether to add it to your shelf.");
        await Promise.all([loadMeetings(), loadKnowledge(), loadNotes()]);
        return;
      }
      if (["failed", "cancelled"].includes(payload.analysis.status)) {
        throw new Error(payload.analysis.errorMessage || "分析未完成");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 8000));
    }
    if (analysisRequestVersion.current !== requestVersion) return;
    setAnalysis((current) =>
      current
        ? { ...current, status: "recovering", progressText: "任务仍在运行，可稍后从历史记录恢复" }
        : current
    );
  }

  async function openAnalysis(analysisId: string) {
    const requestVersion = ++analysisRequestVersion.current;
    replaceAnalysisUrl(analysisId);
    const cachedMeeting = meetings.find((item) => item.analysisId === analysisId);
    if (cachedMeeting && isAnalysisActive(cachedMeeting.status)) {
      setAnalysis(analysisPreview(cachedMeeting, language));
      setView("progress");
    }
    try {
      const payload = await api<{ analysis: Analysis }>(`/api/analyses/${analysisId}`);
      if (analysisRequestVersion.current !== requestVersion) return;
      setAnalysis(payload.analysis);
      if (payload.analysis.result) {
        setView("detail");
        window.scrollTo({ top: 0, behavior: "instant" });
        return;
      }
      setView("progress");
      await pollAnalysis(analysisId, requestVersion);
    } catch (error) {
      if (analysisRequestVersion.current !== requestVersion) return;
      notify(error instanceof Error ? error.message : "无法打开分析");
      replaceAnalysisUrl();
      setView(previousView);
    }
  }

  async function updateMeetingState(meetingId: string, state: string) {
    await api(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    setAnalysis((current) => current?.meetingId === meetingId ? { ...current, meetingState: state } : current);
    notify(language === "zh"
      ? state === "shelved" ? "已纳入书架，技能树已自动更新" : state === "later" ? "已加入稍后看" : state === "completed" ? "已标记看完" : state === "skipped" ? "已跳过" : "未纳入书架，技能树已同步"
      : state === "shelved" ? "Added to shelf. Skill tree updated." : "Saved");
    await Promise.all([loadMeetings(), loadKnowledge()]);
  }

  async function updateAutoCreateNote(autoCreateNote: boolean) {
    const payload = await api<{ settings: WorkspaceSettings }>("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoCreateNote }),
    });
    setWorkspaceSettings(payload.settings);
    notify(language === "zh"
      ? autoCreateNote ? "已开启每次分析自动生成笔记" : "已关闭自动生成笔记"
      : autoCreateNote ? "Automatic notes enabled" : "Automatic notes disabled");
  }

  async function updateTitleMode(titleMode: WorkspaceSettings["titleMode"]) {
    const payload = await api<{ settings: WorkspaceSettings }>("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titleMode }),
    });
    setWorkspaceSettings(payload.settings);
    notify(language === "zh"
      ? titleMode === "automatic" ? "已开启自动生成内容标题" : "已沿用当前链接命名方式"
      : titleMode === "automatic" ? "Automatic titles enabled" : "Current link naming retained");
  }

  async function updateDiscoverySettings(next: Partial<Pick<WorkspaceSettings, "autoDiscoverVideos" | "autoAnalyzeDiscoveries">>) {
    const payload = await api<{ settings: WorkspaceSettings }>("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    setWorkspaceSettings(payload.settings);
    notify(language === "zh" ? "自动发现设置已保存" : "Discovery settings saved");
  }

  async function discoverNow() {
    await api("/api/discoveries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run" }),
    });
    await Promise.all([loadDiscoveries(), loadMeetings()]);
    notify(language === "zh" ? "已找到 1 条候选视频" : "Found one candidate video");
  }

  async function dismissDiscovery(id: string) {
    await api("/api/discoveries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "dismiss", id }),
    });
    await loadDiscoveries();
  }

  async function startAnalysis(input: {
    contentType?: ContentType;
    contentUrl?: string;
    videoUrl?: string;
    title?: string;
    source?: string;
    transcript?: string;
  }) {
    const requestVersion = ++analysisRequestVersion.current;
    setShowAdd(false);
    setView("progress");
    const contentType = input.contentType || "video";
    const contentUrl = input.contentUrl || input.videoUrl;
    const displayTitle = input.title || (() => {
      try { return `${new URL(contentUrl || "").hostname.replace(/^www\./, "")} ${contentTypeLabel(contentType, "zh")}`; }
      catch { return `公开${contentTypeLabel(contentType, "zh")}`; }
    })();
    setAnalysis({
      id: "",
      meetingId: "",
      meetingState: "pending",
      title: displayTitle,
      source: input.source || `${contentTypeLabel(contentType, "zh")}链接`,
      contentType,
      contentUrl: contentUrl || null,
      videoUrl: contentType === "video" ? contentUrl || null : null,
      status: "queued",
      progressText: `正在保存${contentTypeLabel(contentType, "zh")}链接`,
      taskId: null,
      result: null,
      createdAt: new Date().toISOString(),
    });
    try {
      const meetingPayload = await api<{ meeting: { id: string; title: string; source: string; contentType: ContentType; contentUrl?: string | null; videoUrl?: string | null } }>(
        "/api/meetings",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      if (analysisRequestVersion.current !== requestVersion) return;
      const meetingId = meetingPayload.meeting.id;
      setAnalysis((current) =>
        current
          ? { ...current, meetingId, title: meetingPayload.meeting.title, source: meetingPayload.meeting.source, contentType: meetingPayload.meeting.contentType, contentUrl: meetingPayload.meeting.contentUrl || current.contentUrl, videoUrl: meetingPayload.meeting.videoUrl || current.videoUrl, progressText: "正在准备分析" }
          : current
      );
      const response = await fetch(`/api/meetings/${meetingId}/analyze`, { method: "POST" });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `启动分析失败（${response.status}）`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let recoveryId = "";
      while (true) {
        const { value, done } = await reader.read();
        if (analysisRequestVersion.current !== requestVersion) {
          await reader.cancel();
          return;
        }
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const eventName = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() || "";
          const text = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
          if (!text) continue;
          const data = JSON.parse(text) as Record<string, unknown>;
          if (eventName === "created" || eventName === "progress") {
            const nextAnalysisId = String(data.analysisId || "");
            if (nextAnalysisId) replaceAnalysisUrl(nextAnalysisId);
            setAnalysis((current) =>
              current
                ? {
                    ...current,
                    id: String(data.analysisId || current.id),
                    taskId: data.taskId ? String(data.taskId) : current.taskId,
                    status: "running",
                    progressText: String(data.stage || "Peek 正在打开视频并读取字幕"),
                  }
                : current
            );
            if (eventName === "created") void loadMeetings();
          } else if (eventName === "deduplicated") {
            recoveryId = String(data.analysisId);
            if (recoveryId) replaceAnalysisUrl(recoveryId);
          } else if (eventName === "started") {
            recoveryId = String(data.analysisId);
            if (recoveryId) replaceAnalysisUrl(recoveryId);
            setAnalysis((current) =>
              current
                ? { ...current, id: recoveryId, taskId: String(data.taskId), status: "recovering", progressText: "正在分析内容" }
                : current
            );
            void loadMeetings();
          } else if (eventName === "completed") {
            const completedAnalysisId = String(data.analysisId || "");
            if (completedAnalysisId) replaceAnalysisUrl(completedAnalysisId);
            setAnalysis((current) =>
              current
                ? { ...current, id: String(data.analysisId), taskId: String(data.taskId), status: "completed", progressText: "分析完成", meetingState: current.meetingState || "pending", result: data.result as XianjianAnalysisResult }
                : current
            );
            setView("detail");
            await Promise.all([loadMeetings(), loadKnowledge(), loadNotes()]);
          } else if (eventName === "error") {
            throw new Error(String(data.error || "分析失败"));
          }
        }
      }
      if (recoveryId) await pollAnalysis(recoveryId, requestVersion);
    } catch (error) {
      if (analysisRequestVersion.current !== requestVersion) return;
      const message = error instanceof Error ? error.message : "分析失败";
      setAnalysis((current) => current ? { ...current, status: "failed", progressText: "分析未完成", errorMessage: message } : current);
      notify(message);
    }
  }

  const visibleMeetings = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return meetings;
    return meetings.filter((item) => `${item.title} ${item.source} ${item.result?.summary || ""}`.toLowerCase().includes(normalized));
  }, [meetings, query]);
  const shelfMeetings = visibleMeetings.filter((item) => isOnShelf(item.state));
  const savedTotal = meetings.reduce((total, item) => total + (item.result?.savedSeconds || 0), 0);
  const worthCount = meetings.filter((item) => item.result?.verdict === "worth").length;
  const skipCount = meetings.filter((item) => item.result?.verdict === "skip").length;
  const currentAnalysisIsActive = isAnalysisActive(analysis?.status);
  const activeMeetings = meetings.filter((item) => isAnalysisActive(item.status));
  const activeMeeting = activeMeetings.find((item) => item.analysisId === analysis?.id) || activeMeetings[0];
  const sidebarAnalysisId = (currentAnalysisIsActive ? analysis?.id : "") || activeMeeting?.analysisId || "";
  const sidebarAnalysisTitle = (currentAnalysisIsActive ? analysis?.title : "") || activeMeeting?.title || "";
  const sidebarProgressText = (currentAnalysisIsActive ? analysis?.progressText : "") ||
    (language === "zh" ? "正在分析内容" : "The content is being analyzed");
  const sidebarHasActiveAnalysis = currentAnalysisIsActive || Boolean(activeMeeting);
  const currentAnalysisAlreadyListed = Boolean(analysis?.id && activeMeetings.some((item) => item.analysisId === analysis.id));
  const activeTaskCount = activeMeetings.length + (currentAnalysisIsActive && !currentAnalysisAlreadyListed ? 1 : 0);
  const activeTaskItems = [
    ...activeMeetings,
    ...(currentAnalysisIsActive && !currentAnalysisAlreadyListed
      ? [{
          id: analysis!.meetingId || analysis!.id || "starting-analysis",
          analysisId: analysis!.id || undefined,
          title: analysis!.title,
          source: analysis!.source,
          contentType: analysis!.contentType,
          durationSeconds: 0,
          state: analysis!.meetingState,
          createdAt: "",
          status: analysis!.status,
          progressText: analysis!.progressText,
          taskId: analysis!.taskId || undefined,
        }]
      : []),
  ];

  useEffect(() => {
    if (!activeTaskCount) return;
    const timer = window.setInterval(() => void loadMeetings(), 8_000);
    return () => window.clearInterval(timer);
  }, [activeTaskCount, loadMeetings]);
  const pageName = t[view === "progress" || view === "detail" ? "detail" : view];

  if (loading) {
    return <main className="loading-screen"><PeekMark /><p>Peek 正在准备你的学习空间…</p></main>;
  }

  return (
    <div className={`app-shell final-ui font-${fontSize}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("home")} aria-label={t.home}>
          <PeekMark />
          <span className="brand-copy"><strong>先鉴</strong><i aria-hidden="true" /><small>{language === "zh" ? "PEEK · 学习决策助手" : "PEEK · Learning guide"}</small></span>
        </button>
        <nav className="main-nav" aria-label="主要导航">
          {(["home", "tasks", "later", "history", "notes", "skills"] as const).map((item) => (
            <button key={item} className={`nav-item ${view === item ? "active" : ""}`} onClick={() => navigate(item)} aria-label={t[item]}>
              <NavIcon kind={item} /><span>{t[item]}</span>
              {item === "later" && <b>{meetings.filter((meeting) => isOnShelf(meeting.state)).length}</b>}
              {item === "tasks" && <b className={activeTaskCount ? "active-count" : ""}>{activeTaskCount}</b>}
              {item === "notes" && <b>{notes.length}</b>}
            </button>
          ))}
        </nav>
        <div className={`side-note ${sidebarHasActiveAnalysis ? "is-active" : ""}`}>
          <div className="mini-mascot"><img src="/mascot-v2.png" alt="" /></div>
          <strong>{sidebarHasActiveAnalysis ? (language === "zh" ? `Peek 正在分析 ${activeTaskCount} 项` : `Peek is analyzing ${activeTaskCount}`) : (language === "zh" ? "暂无进行中的分析" : "No active analysis")}</strong>
          <span>{sidebarHasActiveAnalysis ? sidebarAnalysisTitle : language === "zh" ? "添加公开视频、文章或论文即可开始" : "Add a public video, article or paper to begin"}</span>
          <div className="progress"><i style={{ width: sidebarHasActiveAnalysis ? "68%" : "0%" }} /></div>
          <small>{sidebarHasActiveAnalysis ? sidebarProgressText : language === "zh" ? "这里不会显示虚构任务" : "No placeholder task is shown here"}</small>
          {sidebarHasActiveAnalysis && <button className="side-note-open" onClick={() => activeTaskCount === 1 && sidebarAnalysisId ? openAnalysis(sidebarAnalysisId) : navigate("tasks")} aria-label={language === "zh" ? "打开运行中任务列表" : "Open running task list"} />}
        </div>
        <div className="profile-chip">
          <button className="profile-identity-button" onClick={() => navigate("settings")} aria-label={t.settings}>
            {authStatus.authenticated && authStatus.user?.avatar
              ? <img src={authStatus.user.avatar} alt="" referrerPolicy="no-referrer" />
              : <span>{authStatus.authenticated ? (authStatus.user?.nickname || authStatus.user?.email || "P").slice(0, 1).toUpperCase() : (language === "zh" ? "访" : "G")}</span>}
            <div><strong>{authStatus.authenticated ? (authStatus.user?.nickname || authStatus.user?.email || (language === "zh" ? "已登录用户" : "Signed-in user")) : (language === "zh" ? "访客" : "Guest")}</strong><small>{authStatus.authenticated ? (language === "zh" ? "已同步学习空间" : "Workspace synced") : (language === "zh" ? "登录可跨设备同步" : "Sign in to sync")}</small></div>
          </button>
          <button className="settings-trigger" onClick={() => navigate("settings")} aria-label={t.settings} title={t.settings}>•••</button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb"><span>{view === "detail" ? (language === "zh" ? "探索" : "Explore") : t.workspace}</span><i>／</i><b>{pageName}</b></div>
          <div className="top-actions">
            <label className="search-button">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} />
              <kbd>⌘ K</kbd>
            </label>
            <div className="language-wrap">
              <button className="language" onClick={() => setLanguageOpen((open) => !open)}><span>文A</span><b>{language === "zh" ? "中文" : "English"}</b><i>⌄</i></button>
              {languageOpen && (
                <div className="language-menu">
                  <button onClick={() => { setLanguage("zh"); setLanguageOpen(false); }}>中文</button>
                  <button onClick={() => { setLanguage("en"); setLanguageOpen(false); }}>English</button>
                </div>
              )}
            </div>
            <div className="font-size-control" role="group" aria-label={language === "zh" ? "字体大小" : "Font size"}>
              {(["small", "medium", "large"] as const).map((size, index) => <button key={size} className={fontSize === size ? "active" : ""} onClick={() => setFontSize(size)} title={language === "zh" ? ["小号字体", "标准字体", "大号字体"][index] : ["Small text", "Standard text", "Large text"][index]}><span>A</span>{index === 0 ? "−" : index === 2 ? "+" : ""}</button>)}
            </div>
            <div className="task-list-wrap">
              <button className={`task-list-trigger ${activeTaskCount ? "has-active" : ""}`} onClick={() => setTaskListOpen((open) => !open)} aria-expanded={taskListOpen} aria-label={language === "zh" ? `运行中任务 ${activeTaskCount} 项` : `${activeTaskCount} active tasks`}><span>◷</span><b>{language === "zh" ? "运行中" : "Running"}</b><i>{activeTaskCount}</i></button>
              {taskListOpen && (
                <div className="task-list-popover">
                  <div className="task-list-head"><strong>{language === "zh" ? "运行中任务" : "Running tasks"}</strong><span>{activeTaskCount}</span></div>
                  {activeTaskItems.length ? activeTaskItems.map((item) => (
                    <button key={item.analysisId || item.id} onClick={() => { setTaskListOpen(false); if (item.analysisId) void openAnalysis(item.analysisId); }}>
                      <span className="task-kind">{contentTypeLabel(item.contentType || "video", language)}</span>
                      <span><strong>{item.title}</strong><small>{item.progressText || (language === "zh" ? "正在分析内容" : "Analyzing the content")}</small></span>
                      <i>→</i>
                    </button>
                  )) : <p>{language === "zh" ? "当前没有运行中的任务" : "No tasks are running"}</p>}
                  <button className="task-list-all" onClick={() => { setTaskListOpen(false); navigate("tasks"); }}><span>{language === "zh" ? "查看完整运行列表" : "View all running tasks"}</span><i>→</i></button>
                </div>
              )}
            </div>
            <button className="infini-connect" onClick={() => setShowConnect(true)} title={authStatus.authenticated ? (language === "zh" ? "管理账号" : "Manage account") : (language === "zh" ? "登录或以访客使用" : "Sign in or continue as guest")}><span>◌</span><b>{authStatus.authenticated ? (authStatus.user?.nickname || authStatus.user?.email || (language === "zh" ? "已登录" : "Signed in")) : (language === "zh" ? "登录" : "Sign in")}</b></button>
            <button className="primary-button add-content-button" onClick={() => { setShowAdd(true); setTaskListOpen(false); notify(language === "zh" ? "已打开内容分析窗口" : "Analysis form opened"); }}>＋ {t.add}</button>
          </div>
        </header>

        {view === "home" && (
          <HomeView
            language={language}
            meetings={visibleMeetings}
            worthCount={worthCount}
            skipCount={skipCount}
            savedTotal={savedTotal}
            laterCount={shelfMeetings.length}
            knowledgeCount={knowledge.length}
            discoveries={discoveries}
            activeTasks={activeTaskItems}
            autoDiscoveryEnabled={workspaceSettings.autoDiscoverVideos}
            onNavigate={navigate}
            onOpen={openAnalysis}
            onDiscoverNow={discoverNow}
            onDismissDiscovery={dismissDiscovery}
            onAnalyzeDiscovery={async (item) => {
              if (item.analysisId) {
                await openAnalysis(item.analysisId);
                return;
              }
              await dismissDiscovery(item.id);
              await startAnalysis({ videoUrl: item.videoUrl, title: item.title });
            }}
          />
        )}
        {view === "tasks" && (
          <RunningTasksView language={language} items={activeTaskItems} onOpen={openAnalysis} onAdd={() => setShowAdd(true)} />
        )}
        {view === "later" && (
          <VideoShelfView language={language} items={visibleMeetings} onOpen={openAnalysis} onState={updateMeetingState} />
        )}
        {view === "history" && (
          <HistoryView language={language} items={visibleMeetings} savedTotal={savedTotal} onOpen={openAnalysis} />
        )}
        {view === "notes" && (
          <NotesView language={language} items={notes} onChanged={loadNotes} />
        )}
        {view === "skills" && (
          <SkillsView language={language} knowledge={knowledge} onOpen={() => {
            const item = meetings.find((meeting) => meeting.analysisId);
            if (item?.analysisId) openAnalysis(item.analysisId);
            else setShowAdd(true);
          }} />
        )}
        {view === "settings" && (
          <SettingsView
            language={language}
            knowledgeCount={knowledge.length}
            autoCreateNote={workspaceSettings.autoCreateNote}
            autoDiscoverVideos={workspaceSettings.autoDiscoverVideos}
            autoAnalyzeDiscoveries={workspaceSettings.autoAnalyzeDiscoveries}
            titleMode={workspaceSettings.titleMode}
            authStatus={authStatus}
            onAutoCreateNoteChange={updateAutoCreateNote}
            onTitleModeChange={updateTitleMode}
            onDiscoverySettingsChange={updateDiscoverySettings}
            onDiscoverNow={discoverNow}
            onManageAccount={() => setShowConnect(true)}
          />
        )}
        {(view === "progress" || (view === "detail" && !analysis?.result)) && analysis && (
          <ProgressView language={language} analysis={analysis} onBack={() => navigate(previousView)} onRetry={() => analysis.id && openAnalysis(analysis.id)} />
        )}
        {view === "detail" && analysis?.result && (
          <DetailView
            language={language}
            analysis={analysis}
            onBack={() => navigate(previousView)}
            onState={(state) => updateMeetingState(analysis.meetingId, state)}
            onNoteSaved={async () => {
              await loadNotes();
              notify(language === "zh" ? "时间码笔记已保存，可从左侧“笔记”打开" : "Timestamp note saved. Open it from Notes.");
            }}
          />
        )}
      </main>

      {showAdd && (
        <AddMeeting language={language} demo={demo} onClose={() => setShowAdd(false)} onStart={startAnalysis} notify={notify} />
      )}
      {showConnect && (
        <ConnectInfiniModal
          language={language}
          status={authStatus}
          onClose={() => setShowConnect(false)}
          onChanged={async () => setAuthStatus(await api<AuthStatus>("/api/auth/status"))}
        />
      )}
      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}

function HomeView({
  language, meetings, worthCount, skipCount, savedTotal, laterCount, knowledgeCount,
  discoveries, autoDiscoveryEnabled, activeTasks, onNavigate, onOpen, onDiscoverNow, onDismissDiscovery, onAnalyzeDiscovery,
}: {
  language: Language;
  meetings: MeetingItem[];
  worthCount: number;
  skipCount: number;
  savedTotal: number;
  laterCount: number;
  knowledgeCount: number;
  discoveries: DiscoveryItem[];
  autoDiscoveryEnabled: boolean;
  activeTasks: MeetingItem[];
  onNavigate: (view: View) => void;
  onOpen: (id: string) => void;
  onDiscoverNow: () => Promise<void>;
  onDismissDiscovery: (id: string) => Promise<void>;
  onAnalyzeDiscovery: (item: DiscoveryItem) => Promise<void>;
}) {
  const items = meetings.filter((item) => item.result).slice(0, 4);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const candidate = discoveries[0];
  const activeTask = activeTasks[0];
  return (
    <section className="page page-view">
      <div className="page-title home-title">
        <div><span className="eyebrow">{currentDateLabel(language)}</span><h1>{activeTasks.length ? (language === "zh" ? `Peek 正在分析 ${activeTasks.length} 条内容` : `Peek is analyzing ${activeTasks.length} items`) : items.length ? (language === "zh" ? "Peek 已经替你先看了一轮" : "Peek has previewed the latest content.") : (language === "zh" ? "这是一个干净的学习空间" : "This is a clean learning workspace.")}</h1><p>{activeTasks.length ? (language === "zh" ? "任务会在后台继续运行，你可以随时打开运行列表查看进度。" : "Tasks continue in the background. Open the running list anytime.") : (language === "zh" ? `${meetings.length} 条内容里，${worthCount} 条值得看，${skipCount} 条可以放心跳过。` : `${meetings.length} items, ${worthCount} worth viewing and ${skipCount} safe to skip.`)}</p></div>
        <div className="saved-pill"><span>{language === "zh" ? "本周省下" : "TIME SAVED"}</span><strong>{formatTime(savedTotal)}</strong></div>
      </div>
      {(candidate || autoDiscoveryEnabled) && (
        <section className="discovery-band" aria-label={language === "zh" ? "自动发现的视频" : "Discovered video"}>
          <div className="discovery-heading"><div><span className="eyebrow">DAILY DISCOVERY</span><h2>{language === "zh" ? "为你发现" : "Discovered for you"}</h2></div><span>{language === "zh" ? "每天最多 1 条" : "Up to 1 per day"}</span></div>
          {candidate ? (
            <article className="discovery-candidate">
              <div className="discovery-source"><span>▶</span><small>{candidate.source}</small></div>
              <div><span className="meta">{language === "zh" ? `兴趣关键词：${candidate.keyword}` : `Interest: ${candidate.keyword}`}</span><h3>{candidate.title}</h3><p>{candidate.snippet || (language === "zh" ? "公开检索找到的候选视频，尚未纳入书架。" : "A public search candidate that is not on your shelf yet.")}</p>{candidate.errorMessage && <small className="discovery-error">{candidate.errorMessage}</small>}</div>
              <div className="discovery-actions"><button className="primary-button" disabled={discoveryBusy} onClick={async () => { setDiscoveryBusy(true); try { await onAnalyzeDiscovery(candidate); } finally { setDiscoveryBusy(false); } }}>{candidate.analysisId ? (language === "zh" ? "查看分析" : "View analysis") : (language === "zh" ? "分析这个视频" : "Analyze video")}</button><button className="text-button" disabled={discoveryBusy} onClick={async () => { setDiscoveryBusy(true); try { await onDismissDiscovery(candidate.id); } finally { setDiscoveryBusy(false); } }}>{language === "zh" ? "不感兴趣" : "Not interested"}</button></div>
            </article>
          ) : (
            <div className="discovery-empty"><p>{knowledgeCount ? (language === "zh" ? "自动发现已开启，系统会根据书架主题在后台寻找下一条候选视频。" : "Discovery is on. The next candidate will use topics from your shelf.") : (language === "zh" ? "先将一个已分析视频纳入书架，系统才能形成兴趣关键词。" : "Add one analyzed video to your shelf to form interest keywords.")}</p><button className="outline-button" disabled={discoveryBusy || !knowledgeCount} onClick={async () => { setDiscoveryBusy(true); try { await onDiscoverNow(); } finally { setDiscoveryBusy(false); } }}>{language === "zh" ? "立即发现一条" : "Discover now"}</button></div>
          )}
        </section>
      )}
      <div className="home-grid">
        <article className="companion-card">
          <div className="companion-copy"><span className="eyebrow">YOUR VIEWING COMPANION</span><h2>Peek</h2><p>{language === "zh" ? "你的先看伙伴" : "Your viewing companion"}</p></div>
          <div className="mascot-stage"><div className="soft-orbit orbit-a" /><div className="soft-orbit orbit-b" /><img src="/mascot-v2.png" alt="Peek 学习伙伴" /></div>
          <button className={`watching-now ${activeTask ? "is-active" : ""}`} disabled={!activeTask?.analysisId} onClick={() => activeTask?.analysisId && onOpen(activeTask.analysisId)}><div className="watching-line"><i /><strong>{activeTask ? (language === "zh" ? `正在分析 · ${contentTypeLabel(activeTask.contentType || "video", language)}` : `Analyzing · ${contentTypeLabel(activeTask.contentType || "video", language)}`) : (language === "zh" ? "随时待命" : "Ready")}</strong><span>{activeTasks.length > 1 ? `+${activeTasks.length - 1}` : "●"}</span></div><p>{activeTask?.title || (language === "zh" ? "粘贴内容链接即可开始" : "Paste a content link to begin")}</p><div className="progress"><i style={{ width: activeTask ? (activeTask.status === "recovering" ? "76%" : "48%") : "0%" }} /></div><small>{activeTask?.progressText || (language === "zh" ? "视频、文章、论文均可分析" : "Videos, articles and papers supported")}</small></button>
        </article>
        <article className="feed-card">
          <div className="section-head"><div><h2>{language === "zh" ? "Peek 先替你看过了" : "Peek previewed these for you"}</h2><p>{language === "zh" ? "有用的留下，没必要看的也如实告诉你。" : "Keep the useful parts. Skip the rest."}</p></div><span className="count-badge">{language === "zh" ? `共 ${meetings.length} 场` : `${meetings.length} talks`}</span></div>
          <div className="filters"><button className="active">{language === "zh" ? "全部" : "All"}</button><button>{language === "zh" ? "值得看" : "Worth it"}</button><button>{language === "zh" ? "可以跳过" : "Skip"}</button></div>
          <div className="feed-list">
            {!items.length && <div className="feed-empty">{copy[language].noItems}</div>}
            {items.map((item) => {
              const result = item.result!;
              return (
                <button className="feed-row" key={item.id} onClick={() => item.analysisId && onOpen(item.analysisId)}>
                  <span className={`source-icon ${result.verdict === "worth" ? "blue" : result.verdict === "skip" ? "clay" : "green"}`}>{item.source.slice(0, 2).toUpperCase()}</span>
                  <span className="feed-main"><span className="meta"><b className={`status ${result.verdict === "skip" ? "skip" : "keep"}`}>{verdictLabel(result.verdict, language)}</b>{item.source} · {formatTime(result.totalDurationSeconds)}</span><strong>{item.title}</strong><small>{result.summary}</small></span>
                  <span className={`route-link ${result.verdict === "skip" ? "ghost" : ""}`}>{result.verdict === "skip" ? (language === "zh" ? "看摘要" : "Summary") : copy[language].open} <i>→</i></span>
                </button>
              );
            })}
          </div>
        </article>
        <aside className="quick-stack">
          <button className="quick-card navy" onClick={() => onNavigate("later")}><span>{copy[language].later}</span><i>↗</i><strong>{laterCount} {language === "zh" ? "场" : ""}</strong><small>{language === "zh" ? "只留下值得投入的内容" : "Only the talks worth your time"}</small></button>
          <button className="quick-card" onClick={() => onNavigate("history")}><span>{copy[language].history}</span><i>↗</i><strong>{meetings.length} {language === "zh" ? "场" : ""}</strong><small>{language === "zh" ? "看过、跳过与留下" : "Watched, skipped and saved"}</small></button>
          <button className="quick-card" onClick={() => onNavigate("history")}><span>{language === "zh" ? "学习记录" : "Learning record"}</span><i>↗</i><strong>{knowledgeCount} {language === "zh" ? "个" : ""}</strong><small>{language === "zh" ? "已积累的知识点" : "Knowledge collected"}</small></button>
          <button className="quick-card book-quick" onClick={() => onNavigate("skills")}><span>{copy[language].skills}</span><i>↗</i><strong>{knowledgeCount} {language === "zh" ? "项" : "items"}</strong><small>{language === "zh" ? "查看知识之间的联系" : "See how ideas connect"}</small></button>
        </aside>
      </div>
    </section>
  );
}

function RunningTasksView({ language, items, onOpen, onAdd }: { language: Language; items: MeetingItem[]; onOpen: (id: string) => void; onAdd: () => void }) {
  return (
    <section className="page page-view running-tasks-page">
      <div className="page-title"><div><span className="eyebrow">IN PROGRESS</span><h1>{language === "zh" ? "正在分析" : "In progress"}</h1><p>{language === "zh" ? "你可以离开这里，完成后会自动出现在历史记录中。" : "You can leave this page. Completed items appear in History."}</p></div><button className="primary-button" onClick={onAdd}>＋ {language === "zh" ? "添加内容" : "Add content"}</button></div>
      <article className="running-task-panel">
        <div className="running-task-summary"><div><span>{language === "zh" ? "处理中" : "ACTIVE"}</span><strong>{items.length}</strong></div></div>
        <div className="running-task-list">
          {items.length ? items.map((item) => (
            <button key={item.analysisId || item.id} disabled={!item.analysisId} onClick={() => item.analysisId && onOpen(item.analysisId)}>
              <span className="running-task-kind">{contentTypeLabel(item.contentType || "video", language)}</span>
              <span className="running-task-copy"><strong>{item.title}</strong><small>{item.progressText || (language === "zh" ? "正在准备分析" : "Preparing analysis")}</small></span>
              <span className={`running-task-status ${item.status || "queued"}`}><i />{analysisStageLabel(item.status, language)}</span>
              <i className="running-task-arrow">→</i>
            </button>
          )) : <div className="running-task-empty"><span>◷</span><h2>{language === "zh" ? "当前没有运行中的任务" : "No tasks are running"}</h2><p>{language === "zh" ? "添加视频、文章或论文后，任务会立即出现在这里。" : "Add a video, article or paper and it will appear here immediately."}</p><button className="primary-button" onClick={onAdd}>{language === "zh" ? "开始分析" : "Start analysis"}</button></div>}
        </div>
      </article>
    </section>
  );
}

function VideoShelfView({ language, items, onOpen, onState }: { language: Language; items: MeetingItem[]; onOpen: (id: string) => void; onState: (id: string, state: string) => Promise<void> }) {
  const [filter, setFilter] = useState<"all" | "shelved" | "later" | "completed">("all");
  const itemsOnShelf = items.filter((item) => isOnShelf(item.state));
  const shelfItems = filter === "all" ? itemsOnShelf : itemsOnShelf.filter((item) => item.state === filter);
  const full = itemsOnShelf.reduce((sum, item) => sum + (item.result?.totalDurationSeconds || item.durationSeconds || 0), 0);
  const selected = itemsOnShelf.reduce((sum, item) => sum + (item.result?.recommendedSeconds || 0), 0);
  const percent = (state: string) => itemsOnShelf.length ? Math.round((itemsOnShelf.filter((item) => item.state === state).length / itemsOnShelf.length) * 100) : 0;
  return (
    <section className="page page-view">
      <div className="page-title"><div><span className="eyebrow">CONTENT LIBRARY</span><h1>{copy[language].later}</h1><p>{language === "zh" ? "只收录你确认值得保留的内容；入架后，技能树会自动同步更新。" : "Only content you choose to keep appears here. Adding it also updates your skill tree."}</p></div></div>
      <div className="two-column">
        <article className="content-panel queue-panel">
          <div className="section-head"><div><h2>{language === "zh" ? "我的内容" : "My content"}</h2><p>{language === "zh" ? "点击内容可重新打开分析路线" : "Open an item to revisit its analysis route"}</p></div><div className="inline-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>{language === "zh" ? `全部 ${itemsOnShelf.length}` : `All ${itemsOnShelf.length}`}</button><button className={filter === "shelved" ? "active" : ""} onClick={() => setFilter("shelved")}>{language === "zh" ? "已入架" : "Shelved"}</button><button className={filter === "later" ? "active" : ""} onClick={() => setFilter("later")}>{language === "zh" ? "稍后看" : "Later"}</button><button className={filter === "completed" ? "active" : ""} onClick={() => setFilter("completed")}>{language === "zh" ? "已看完" : "Done"}</button></div></div>
          <div className="queue-list">
            {!shelfItems.length && <div className="panel-empty">{language === "zh" ? "书架还是空的。完成分析后，由你决定哪些内容值得纳入。" : "Your shelf is empty. After analysis, you decide what is worth keeping."}</div>}
            {shelfItems.map((item, index) => {
              const result = item.result;
              return (
                <div className="queue-item" key={item.id}>
                  <div className={`video-cover ${index % 3 === 0 ? "cover-agent" : index % 3 === 1 ? "cover-design" : "cover-memory"}`}><span>{item.source.split(/[·｜|]/)[0]}</span><i>{(item.contentType || "video") === "video" ? timecode(result?.totalDurationSeconds || item.durationSeconds) : contentTypeLabel(item.contentType || "video", language)}</i></div>
                  <div className="queue-copy"><span className="meta"><b className="status keep">{result ? verdictLabel(result.verdict, language) : "待分析"}</b>{item.source}</span><h3>{item.title}</h3><p>{result?.summary || "Peek 正在整理内容路线"}</p><div className="tag-row">{result?.newKnowledge.slice(0, 3).map((tag) => <span key={tag.topic}>{tag.topic}</span>)}</div></div>
                  <div className="queue-action"><strong>{(item.contentType || "video") === "video" ? formatTime(result?.recommendedSeconds || 0) : `${result?.segments.filter((segment) => segment.decision === "watch").length || 0} ${language === "zh" ? "节" : "sections"}`}</strong><small>{(item.contentType || "video") === "video" ? (language === "zh" ? `原长 ${formatTime(result?.totalDurationSeconds || item.durationSeconds)}` : `of ${formatTime(result?.totalDurationSeconds || item.durationSeconds)}`) : contentTypeLabel(item.contentType || "video", language)}</small>{item.analysisId && <button onClick={() => onOpen(item.analysisId!)}>{language === "zh" ? "打开路线" : "Open route"}</button>}<button className="outline-button" onClick={() => onState(item.id, item.state === "later" ? "shelved" : "later")}>{item.state === "later" ? (language === "zh" ? "移出稍后看" : "Remove from later") : (language === "zh" ? "加入稍后看" : "Watch later")}</button><button className="text-button shelf-remove" onClick={() => onState(item.id, "archived")}>{language === "zh" ? "移出书架" : "Remove from shelf"}</button></div>
                </div>
              );
            })}
          </div>
        </article>
        <aside className="summary-column">
          <article className="summary-hero"><span className="eyebrow">{language === "zh" ? "本周观看计划" : "WEEKLY PLAN"}</span><strong>{formatTime(full)}</strong><p>{language === "zh" ? "完整内容时长" : "Full duration"}</p><div className="saving-arrow"><span>{language === "zh" ? "由 Peek 精简为" : "Peek condensed it to"}</span><i>↓</i></div><strong className="accent-number">{formatTime(selected)}</strong><p>{language === "zh" ? "真正需要看的部分" : "What you need to watch"}</p></article>
          <article className="mini-panel"><div className="mini-panel-head"><strong>{language === "zh" ? "按状态分布" : "By status"}</strong><span>{itemsOnShelf.length} {language === "zh" ? "条内容" : "items"}</span></div>{[["shelved", language === "zh" ? "已入架" : "Shelved"], ["later", language === "zh" ? "稍后看" : "Later"], ["completed", language === "zh" ? "已看完" : "Completed"]].map(([state, label]) => <div className="bar-row" key={state}><span>{label}</span><i><b style={{ width: `${percent(state)}%` }} /></i><em>{percent(state)}%</em></div>)}</article>
        </aside>
      </div>
    </section>
  );
}

function inlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
      : <span key={`${part}-${index}`}>{part}</span>
  );
}

function RichNote({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      blocks.push(level === 1
        ? <h2 key={`h-${index}`}>{inlineMarkdown(text)}</h2>
        : level === 2
          ? <h3 key={`h-${index}`}>{inlineMarkdown(text)}</h3>
          : <h4 key={`h-${index}`}>{inlineMarkdown(text)}</h4>);
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(lines[index])) {
      const entries: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        entries.push(lines[index].replace(/^\s*[-*]\s+/, "").trim());
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{entries.map((entry, itemIndex) =>
        <li key={`${entry}-${itemIndex}`}>{inlineMarkdown(entry)}</li>
      )}</ul>);
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3})\s+/.test(lines[index].trim()) &&
      !/^\s*[-*]\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{inlineMarkdown(paragraph.join(" "))}</p>);
  }
  return <div className="rich-note">{blocks}</div>;
}

function NotesView({ language, items, onChanged }: { language: Language; items: NoteItem[]; onChanged: () => Promise<void> }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rebuildBusy, setRebuildBusy] = useState(false);
  const [openMeetingId, setOpenMeetingId] = useState<string | null>(items[0]?.meetingId || null);
  const [noteLanguage, setNoteLanguage] = useState<Language>("zh");
  const [translatedNotes, setTranslatedNotes] = useState<Record<string, Record<string, string>>>({});
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [notebookQuestion, setNotebookQuestion] = useState("");
  const [notebookAnswer, setNotebookAnswer] = useState<LearningAnswerPayload | null>(null);
  const [notebookAskBusy, setNotebookAskBusy] = useState(false);
  const [notebookAskError, setNotebookAskError] = useState("");
  const groups = useMemo(() => {
    const map = new Map<string, { meetingId: string; title: string; items: NoteItem[]; updatedAt: string }>();
    for (const item of items) {
      const group = map.get(item.meetingId) || { meetingId: item.meetingId, title: item.title, items: [], updatedAt: item.updatedAt || item.createdAt };
      group.items.push(item);
      if ((item.updatedAt || item.createdAt) > group.updatedAt) group.updatedAt = item.updatedAt || item.createdAt;
      map.set(item.meetingId, group);
    }
    return [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [items]);
  useEffect(() => {
    if (!openMeetingId && groups.length) setOpenMeetingId(groups[0].meetingId);
  }, [groups, openMeetingId]);

  const translateNotebook = async (meetingId: string) => {
    if (translatedNotes[meetingId]) return;
    setTranslationBusy(true);
    setTranslationError("");
    try {
      const payload = await api<{ items: Array<{ id: string; content: string }> }>("/api/notes/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meetingId, language: "en" }),
      });
      setTranslatedNotes((current) => ({
        ...current,
        [meetingId]: Object.fromEntries(payload.items.map((item) => [item.id, item.content])),
      }));
    } catch (caught) {
      setTranslationError(caught instanceof Error ? caught.message : "英文笔记生成失败");
      throw caught;
    } finally {
      setTranslationBusy(false);
    }
  };

  const switchNoteLanguage = async (target: Language) => {
    if (target === "zh") {
      setNoteLanguage("zh");
      setTranslationError("");
      return;
    }
    if (!openMeetingId) return;
    try {
      await translateNotebook(openMeetingId);
      setNoteLanguage("en");
    } catch {
      // The visible error above explains the failure.
    }
  };

  const askNotebook = async () => {
    if (!openMeetingId || notebookQuestion.trim().length < 2) return;
    setNotebookAskBusy(true);
    setNotebookAskError("");
    setNotebookAnswer(null);
    try {
      const payload = await api<LearningAnswerPayload>("/api/notes/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingId: openMeetingId,
          question: notebookQuestion,
          language: noteLanguage,
        }),
      });
      setNotebookAnswer(payload);
    } catch (caught) {
      setNotebookAskError(caught instanceof Error ? caught.message : (language === "zh" ? "暂时没有获得回答，请重试" : "No answer yet. Please try again."));
    } finally {
      setNotebookAskBusy(false);
    }
  };

  const save = async (item: NoteItem) => {
    if (!draft.trim()) return;
    setBusyId(item.id);
    try {
      await api(`/api/notes/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      setEditingId(null);
      setTranslatedNotes((current) => {
        const next = { ...current };
        delete next[item.meetingId];
        return next;
      });
      await onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: NoteItem) => {
    setBusyId(item.id);
    try {
      await api(`/api/notes/${item.id}`, { method: "DELETE" });
      setTranslatedNotes((current) => {
        const next = { ...current };
        delete next[item.meetingId];
        return next;
      });
      await onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const exportNotebook = () => {
    const exportedAt = new Date().toLocaleString(language === "zh" ? "zh-CN" : "en-US");
    const entries = items.map((item) => [
      `## ${item.title}`,
      item.timecodeSeconds == null ? "" : `时间码：${timecode(item.timecodeSeconds)}`,
      "",
      noteLanguage === "en" ? translatedNotes[item.meetingId]?.[item.id] || item.content : item.content,
    ].filter(Boolean).join("\n")).join("\n\n---\n\n");
    const markdown = `# ${noteLanguage === "zh" ? "先鉴 Peek 笔记本" : "Peek Notebook"}\n\n${language === "zh" ? "导出时间" : "Exported"}：${exportedAt}\n\n${entries}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    link.download = `unread-insight-notes-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
  };

  return (
    <section className="page page-view notes-page">
      <div className="page-title"><div><span className="eyebrow">TIMESTAMP NOTEBOOK</span><h1>{copy[language].notes}</h1><p>{language === "zh" ? "所有在分析片段下写过的时间码笔记，都集中保存在这里。" : "Every timestamp note written under an analyzed segment is collected here."}</p></div><div className="saved-pill"><span>{language === "zh" ? "笔记总数" : "TOTAL NOTES"}</span><strong>{items.length}</strong></div></div>
      <article className="content-panel notes-panel notebook-library">
        <div className="section-head border-bottom"><div><h2>{language === "zh" ? "我的笔记本" : "My notebook"}</h2><p>{language === "zh" ? "正文、边栏批注和随时问答都按内容收在一起" : "Notes, annotations and Q&A stay together by item"}</p></div><div className="notebook-toolbar"><div className="note-language-switch" role="group" aria-label={language === "zh" ? "笔记语言" : "Note language"}><button className={noteLanguage === "zh" ? "active" : ""} disabled={translationBusy} onClick={() => void switchNoteLanguage("zh")}>中文</button><button className={noteLanguage === "en" ? "active" : ""} disabled={translationBusy || !openMeetingId} onClick={() => void switchNoteLanguage("en")}>{translationBusy ? (language === "zh" ? "转换中…" : "Translating…") : "English"}</button></div><button className="outline-button export-notes" disabled={!openMeetingId || rebuildBusy || noteLanguage !== "zh"} onClick={async () => { if (!openMeetingId) return; setRebuildBusy(true); try { await api("/api/notes/rebuild", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ meetingId: openMeetingId }) }); setTranslatedNotes((current) => { const next = { ...current }; delete next[openMeetingId]; return next; }); await onChanged(); } finally { setRebuildBusy(false); } }}>{rebuildBusy ? (language === "zh" ? "整理中…" : "Rebuilding…") : (language === "zh" ? "重新整理笔记" : "Reorganize notes")}</button><button className="outline-button export-notes" disabled={!items.length} onClick={exportNotebook}>{language === "zh" ? "导出笔记" : "Export notes"}</button></div></div>
        {translationError && <div className="notebook-language-error">{translationError}</div>}
        {!items.length && <div className="notes-empty"><span>✎</span><h2>{language === "zh" ? "还没有笔记" : "No notes yet"}</h2><p>{language === "zh" ? "先打开一条内容的分析路线，在任意片段下添加笔记。" : "Open an analysis route and add a note under any segment."}</p></div>}
        <div className="notebook-groups">
          {groups.map((group) => {
            const open = openMeetingId === group.meetingId;
            const summary = group.items.find((item) => item.segmentId?.startsWith("analysis-summary:")) || group.items[0];
            const translated = translatedNotes[group.meetingId] || {};
            return <article className={`notebook-document ${open ? "open" : ""}`} key={group.meetingId}><button className="notebook-cover" onClick={() => { const next = open ? null : group.meetingId; setOpenMeetingId(next); setNotebookAnswer(null); setNotebookAskError(""); if (next && noteLanguage === "en") void translateNotebook(next); }}><span className="notebook-icon">▤</span><div><strong>{group.title}</strong><small>{group.items.length} {language === "zh" ? "条笔记" : "notes"} · {new Date(group.updatedAt).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US")}</small><p>{summary.content.replace(/^#+.*$/gm, "").replace(/\*\*/g, "").trim().slice(0, 120)}</p></div><i>{open ? "−" : "+"}</i></button>{open && <div className="notebook-pages"><aside className="notebook-margin"><span>{language === "zh" ? "边栏批注" : "MARGIN NOTES"}</span>{group.items.filter((item) => item.timecodeSeconds != null).map((item) => <button key={item.id} onClick={() => document.getElementById(`note-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{timecode(item.timecodeSeconds || 0)}</button>)}</aside><div className="note-list grouped">{group.items.map((item) => { const visibleContent = noteLanguage === "en" ? translated[item.id] || item.content : item.content; return <article className={`note-entry ${item.segmentId?.startsWith("analysis-summary:") ? "summary-note" : ""}`} id={`note-${item.id}`} key={item.id}><div className="note-time">{item.timecodeSeconds == null ? (item.segmentId?.startsWith("analysis-summary:") ? (noteLanguage === "zh" ? "总" : "MAIN") : "—") : timecode(item.timecodeSeconds)}</div><div className="note-body">{editingId === item.id ? <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} autoFocus /> : <RichNote content={visibleContent} />}<small>{new Date(item.updatedAt || item.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div>{noteLanguage === "zh" && <div className="note-actions">{editingId === item.id ? <><button disabled={busyId === item.id || !draft.trim()} onClick={() => save(item)}>{language === "zh" ? "保存" : "Save"}</button><button className="ghost-action" onClick={() => setEditingId(null)}>{language === "zh" ? "取消" : "Cancel"}</button></> : <><button onClick={() => { setEditingId(item.id); setDraft(item.content); }}>{language === "zh" ? "编辑" : "Edit"}</button><button className="ghost-action danger" disabled={busyId === item.id} onClick={() => remove(item)}>{language === "zh" ? "删除" : "Delete"}</button></>}</div>}</article>; })}</div><aside className="notebook-companion"><img src="/mascot-v2.png" alt="Peek" /><span className="eyebrow">ASK PEEK</span><h3>{noteLanguage === "zh" ? "哪里没看懂，直接问" : "Ask anything about this item"}</h3><p>{noteLanguage === "zh" ? "不用写提示词。Peek 会回到原内容和分析报告里找依据。" : "No prompting skills needed. Peek checks the source and report for evidence."}</p><textarea value={notebookQuestion} onChange={(event) => setNotebookQuestion(event.target.value)} maxLength={800} placeholder={noteLanguage === "zh" ? "例如：这三个要素分别是什么？" : "e.g. What are the three elements?"} /><button className="primary-button" disabled={notebookAskBusy || notebookQuestion.trim().length < 2} onClick={askNotebook}>{notebookAskBusy ? (noteLanguage === "zh" ? "Peek 正在查找…" : "Peek is checking…") : (noteLanguage === "zh" ? "问 Peek" : "Ask Peek")}</button>{notebookAskError && <div className="qa-error">{notebookAskError}</div>}{notebookAnswer && <div className="notebook-answer"><RichNote content={notebookAnswer.answer} /><button onClick={async () => { await api("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ meetingId: group.meetingId, segmentId: `qa:${Date.now()}`, content: notebookAnswer.note }) }); setNoteLanguage("zh"); setTranslatedNotes((current) => { const next = { ...current }; delete next[group.meetingId]; return next; }); await onChanged(); }}>{noteLanguage === "zh" ? "＋ 加入这篇笔记" : "+ Add to notebook"}</button></div>}</aside></div>}</article>;
          })}
        </div>
      </article>
    </section>
  );
}

function LearningCalendar({ language, items, selected, onSelect }: { language: Language; items: MeetingItem[]; selected: string; onSelect: (day: string) => void }) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const counts = new Map<string, number>();
  for (const item of items) {
    const date = new Date(item.createdAt);
    if (date.getFullYear() !== year || date.getMonth() !== month) continue;
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - startOffset + 1;
    return day > 0 && day <= daysInMonth ? day : 0;
  });
  const labels = language === "zh" ? ["一", "二", "三", "四", "五", "六", "日"] : ["M", "T", "W", "T", "F", "S", "S"];
  return <article className="learning-calendar"><div className="calendar-head"><div><span className="eyebrow">LEARNING CALENDAR</span><strong>{new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "long" }).format(today)}</strong></div><button className={selected ? "active" : ""} onClick={() => onSelect("")}>{language === "zh" ? "显示全部" : "Show all"}</button></div><div className="calendar-week">{labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div><div className="calendar-grid">{cells.map((day, index) => {
    if (!day) return <i key={`empty-${index}`} />;
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const count = counts.get(key) || 0;
    const isToday = day === today.getDate();
    return <button key={key} className={`${count ? "has-learning" : ""} ${selected === key ? "selected" : ""} ${isToday ? "today" : ""}`} onClick={() => count && onSelect(selected === key ? "" : key)}><b>{day}</b>{count ? <span>{count}</span> : null}</button>;
  })}</div><div className="calendar-legend"><span><i />{language === "zh" ? "有学习记录" : "Learning activity"}</span><strong>{counts.size} {language === "zh" ? "个学习日" : "active days"}</strong></div></article>;
}

function HistoryView({ language, items, savedTotal, onOpen }: { language: Language; items: MeetingItem[]; savedTotal: number; onOpen: (id: string) => void }) {
  const [selectedDay, setSelectedDay] = useState("");
  const visibleItems = selectedDay ? items.filter((item) => {
    const date = new Date(item.createdAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return key === selectedDay;
  }) : items;
  return (
    <section className="page page-view">
      <div className="page-title"><div><span className="eyebrow">VIEWING HISTORY</span><h1>{copy[language].history}</h1><p>{language === "zh" ? "你看过的、跳过的，以及真正留下来的。" : "Everything watched, skipped and retained."}</p></div></div>
      <LearningCalendar language={language} items={items} selected={selectedDay} onSelect={setSelectedDay} />
      <div className="history-layout">
        <article className="content-panel">
          <div className="section-head border-bottom"><div className="inline-tabs"><button className="active">{language === "zh" ? "全部" : "All"}</button><button>{language === "zh" ? "我看过的" : "Watched"}</button><button>{language === "zh" ? "Peek 跳过的" : "Skipped by Peek"}</button></div><button className="date-button">{language === "zh" ? "最近 30 天" : "Last 30 days"}⌄</button></div>
          <div className="history-group"><div className="history-date"><strong>{selectedDay || (language === "zh" ? "最近" : "Recent")}</strong><span>{visibleItems.length} {language === "zh" ? "条记录" : "records"}</span></div>
            {!visibleItems.length && <div className="panel-empty">{selectedDay ? (language === "zh" ? "这一天没有学习记录。" : "No learning activity on this day.") : copy[language].noItems}</div>}
            {visibleItems.map((item) => {
              const verdict = item.result?.verdict;
              const resultClass = verdict === "skip" || item.state === "skipped" ? "skip" : "keep";
              return (
                <div className="history-entry" key={item.id} onClick={() => item.analysisId && onOpen(item.analysisId)}>
                  <span className={`history-dot ${resultClass === "keep" ? "keep-dot" : "skip-dot"}`} />
                  <div><span className="meta">{item.source} · {item.result ? `Peek ${language === "zh" ? "已看完" : "previewed"}` : item.status || "等待分析"}</span><h3>{item.title}</h3><p>{item.result?.summary || `${Number(item.noteCount || 0)} 条笔记`}</p></div>
                  <b className={`history-result ${resultClass}`}>{item.result ? verdictLabel(item.result.verdict, language) : language === "zh" ? "处理中" : "Processing"}</b>
                  <time>{new Date(item.createdAt).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US", { month: "numeric", day: "numeric" })}</time>
                </div>
              );
            })}
          </div>
        </article>
        <aside className="history-stats"><article><span>{language === "zh" ? "累计省下" : "Time saved"}</span><strong>{formatTime(savedTotal)}</strong><small>{language === "zh" ? "按推荐路线估算" : "Based on recommended routes"}</small></article><article><span>{language === "zh" ? "真正看完" : "Completed"}</span><strong>{items.filter((item) => item.state === "completed").length} {language === "zh" ? "场" : ""}</strong><small>{language === "zh" ? "聚焦高价值片段" : "Focused viewing"}</small></article><article className="mascot-tip"><img src="/mascot-v2.png" alt="" /><div><strong>{language === "zh" ? "内容偏好" : "Content preference"}</strong><p>{items.length ? (language === "zh" ? "再分析一些内容后，Peek 会逐渐总结你的偏好。" : "Peek will summarize your preferences as you analyze more content.") : (language === "zh" ? "还没有足够数据形成偏好判断。" : "Not enough data to infer a preference yet.")}</p></div></article></aside>
      </div>
    </section>
  );
}

function SkillsView({ language, knowledge, onOpen }: { language: Language; knowledge: Record<string, unknown>[]; onOpen: () => void }) {
  const recent = knowledge.slice(0, 6);
  const focus = recent[0];
  if (!knowledge.length) {
    return (
      <section className="page page-view">
        <div className="page-title"><div><span className="eyebrow">LEARNING MAP</span><h1>{copy[language].skills}</h1><p>{language === "zh" ? "你收进书架的内容，会逐渐形成自己的知识地图。" : "Items on your shelf gradually form your knowledge map."}</p></div></div>
        <article className="true-empty-state skill-empty-state">
          <span className="empty-symbol">◇</span>
          <h2>{language === "zh" ? "技能树还是空的" : "Your skill tree is empty"}</h2>
          <p>{language === "zh" ? "分析一条内容并纳入书架后，相关知识点会出现在这里。" : "Analyze an item and add it to your shelf to begin your map."}</p>
          <button className="primary-button" onClick={onOpen}>{language === "zh" ? "添加第一条内容" : "Add your first item"}</button>
        </article>
      </section>
    );
  }
  const masteryOf = (item: Record<string, unknown>) => Math.max(0, Math.min(100, Number(item.masteryLevel || 0)));
  const masteredCount = knowledge.filter((item) => masteryOf(item) >= 70).length;
  const developingCount = knowledge.filter((item) => masteryOf(item) >= 25 && masteryOf(item) < 70).length;
  const exposureCount = knowledge.length - masteredCount - developingCount;
  const masteredPercent = Math.round(knowledge.reduce((sum, item) => sum + masteryOf(item), 0) / knowledge.length);
  const treeNodes = knowledge.slice(0, 7);
  return (
    <section className="page page-view">
      <div className="page-title"><div><span className="eyebrow">LEARNING MAP</span><h1>{copy[language].skills}</h1><p>{language === "zh" ? "类别 → 专业领域 → 知识与技能点。节点只用规范名词，具体结论与人物放在说明中。" : "Category → domain → knowledge or skill. Nodes use canonical terms, not full conclusions."}</p></div><div className="saved-pill"><span>{language === "zh" ? "知识与技能点" : "KNOWLEDGE & SKILLS"}</span><strong>{knowledge.length}</strong></div></div>
      <div className="skill-visual-grid">
        <article className="skill-chart-card"><div><span className="eyebrow">MASTERY ESTIMATE</span><h2>{language === "zh" ? "掌握度估计" : "Estimated mastery"}</h2><p>{language === "zh" ? "加入书架只代表接触过，不会直接算作已掌握" : "Saving means exposure, not automatic mastery"}</p></div><div className="skill-donut" style={{ background: `conic-gradient(var(--sage) 0 ${masteredPercent}%, #e7e4db ${masteredPercent}% 100%)` }}><span><strong>{masteredPercent}%</strong><small>{language === "zh" ? "平均" : "average"}</small></span></div><div className="skill-chart-legend"><span><i className="known" />{language === "zh" ? "已掌握" : "Mastered"} <b>{masteredCount}</b></span><span><i className="fresh" />{language === "zh" ? "学习中" : "Developing"} <b>{developingCount}</b></span><span><i />{language === "zh" ? "已接触" : "Exposed"} <b>{exposureCount}</b></span></div></article>
        <article className="knowledge-tree-card"><div className="section-head"><div><span className="eyebrow">SKILL RELATION TREE</span><h2>{language === "zh" ? "知识与技能关系树" : "Knowledge and skill tree"}</h2><p>{language === "zh" ? "类别 → 专业领域 → 规范知识点，并显示掌握度" : "Category → domain → canonical knowledge point"}</p></div></div><div className="knowledge-tree"><div className="tree-root"><PeekMark compact /><strong>{language === "zh" ? "我的能力画像" : "My capability profile"}</strong></div><div className="tree-branches">{treeNodes.map((item, index) => <div className={`tree-node tone-${index % 3}`} key={String(item.id || index)}><i /><span><b>{String(item.category || (language === "zh" ? "未分类" : "Unclassified"))} · {String(item.domain || (language === "zh" ? "未分类" : "Unclassified"))}</b>{String(item.topic)}</span><small>{String(item.skillType || "concept")} · {masteryOf(item)}%</small></div>)}</div></div></article>
      </div>
      <div className="skill-layout">
        <article className="skill-map-panel"><div className="section-head"><div><h2>{language === "zh" ? "从内容中形成的知识与技能点" : "Knowledge and skills from your content"}</h2><p>{language === "zh" ? "短名称作为节点；定义、证明结论与来源证据放在节点内部" : "Short canonical names become nodes; conclusions stay in details"}</p></div><div className="map-legend"><span><i className="done" />{language === "zh" ? "掌握度 ≥70" : "Mastery ≥70"}</span><span><i className="doing" />{language === "zh" ? "学习中" : "Developing"}</span></div></div>
          <div className="dynamic-skill-grid">
            {knowledge.map((item, index) => {
              const mastery = masteryOf(item);
              const mastered = mastery >= 70;
              const description = String(item.description || item.evidence || (language === "zh" ? "来自这条内容的知识更新" : "A knowledge update from this item"));
              return <article className={`dynamic-skill-node ${mastered ? "mastered" : "new"}`} key={String(item.id || `${item.topic}-${index}`)}><i>{mastered ? "✓" : mastery >= 25 ? "↗" : "+"}</i><div><small className="skill-domain">{String(item.category || (language === "zh" ? "未分类" : "Unclassified"))} ／ {String(item.domain || (language === "zh" ? "未分类" : "Unclassified"))} · {String(item.skillType || "concept")}</small><strong>{String(item.topic || (language === "zh" ? "未命名知识点" : "Untitled knowledge point"))}</strong><p>{description}</p><div className="skill-mastery-bar"><b style={{ width: `${mastery}%` }} /></div><small>{language === "zh" ? `掌握度 ${mastery}% · 覆盖 ${Number(item.coverage || 0)}% · 可信 ${Number(item.confidence || 0)}%` : `Mastery ${mastery}% · coverage ${Number(item.coverage || 0)}% · confidence ${Number(item.confidence || 0)}%`}</small></div><span>{mastered ? (language === "zh" ? "已掌握" : "Mastered") : mastery >= 25 ? (language === "zh" ? "学习中" : "Developing") : (language === "zh" ? "已接触" : "Exposed")}</span></article>;
            })}
          </div>
        </article>
        <aside className="skill-side"><article className="current-skill dynamic-focus"><span className="eyebrow">LATEST UPDATE</span><strong>{String(focus.topic)}</strong><p>{String(focus.evidence || (language === "zh" ? "来自最近加入书架的内容。" : "From your latest shelf item."))}</p><button onClick={onOpen}>{language === "zh" ? "打开对应内容" : "Open related content"}</button></article><article className="skill-gap"><span>{language === "zh" ? "下一步" : "NEXT STEP"}</span><strong>{language === "zh" ? "再分析一个相邻主题" : "Analyze an adjacent topic"}</strong><p>{language === "zh" ? "加入相关内容，可以逐渐看清知识之间的联系。" : "Add related content to reveal connections between ideas."}</p><button onClick={onOpen}>{language === "zh" ? "添加内容 →" : "Add content →"}</button></article></aside>
      </div>
      <div className="skill-cards-head"><div><h2>{language === "zh" ? "最近更新" : "Recent updates"}</h2><p>{language === "zh" ? "来自你看过、跳过和收藏的内容" : "From watched, skipped and saved content"}</p></div><button>{knowledge.length} {language === "zh" ? "项知识更新" : "updates"}</button></div>
      <div className="skill-update-grid">
        {recent.map((item, index) => <article key={`${String(item.topic)}-${index}`}><span className={`update-icon ${index === 0 ? "green" : index === 1 ? "navy" : "clay"}`}>{index === 0 ? "+" : index === 1 ? "↑" : "✓"}</span><div><strong>{String(item.topic)}</strong><p>{String(item.evidence)}</p></div><time>{language === "zh" ? "最近" : "Recent"}</time></article>)}
      </div>
    </section>
  );
}

function SettingsView({
  language,
  knowledgeCount,
  autoCreateNote,
  autoDiscoverVideos,
  autoAnalyzeDiscoveries,
  titleMode,
  authStatus,
  onAutoCreateNoteChange,
  onTitleModeChange,
  onDiscoverySettingsChange,
  onDiscoverNow,
  onManageAccount,
}: {
  language: Language;
  knowledgeCount: number;
  autoCreateNote: boolean;
  autoDiscoverVideos: boolean;
  autoAnalyzeDiscoveries: boolean;
  titleMode: WorkspaceSettings["titleMode"];
  authStatus: AuthStatus;
  onAutoCreateNoteChange: (autoCreateNote: boolean) => Promise<void>;
  onTitleModeChange: (titleMode: WorkspaceSettings["titleMode"]) => Promise<void>;
  onDiscoverySettingsChange: (next: Partial<Pick<WorkspaceSettings, "autoDiscoverVideos" | "autoAnalyzeDiscoveries">>) => Promise<void>;
  onDiscoverNow: () => Promise<void>;
  onManageAccount: () => void;
}) {
  const [noteBusy, setNoteBusy] = useState(false);
  const [titleBusy, setTitleBusy] = useState(false);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [error, setError] = useState("");
  const accountName = authStatus.user?.nickname || authStatus.user?.email || authStatus.user?.username;

  return (
    <section className="page page-view settings-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">WORKSPACE SETTINGS</span>
          <h1>{copy[language].settings}</h1>
          <p>{language === "zh" ? "管理学习空间、账号同步和内容偏好。" : "Manage your workspace, account sync and content preferences."}</p>
        </div>
      </div>

      <div className="settings-grid">
        <article className="settings-panel account-settings-panel">
          <div className="settings-panel-head"><span className="settings-icon">{authStatus.authenticated ? "✓" : "匿"}</span><div><h2>{language === "zh" ? "账号与个人信息" : "Account & personal information"}</h2><p>{authStatus.authenticated ? (language === "zh" ? "学习空间已绑定，可在其他设备登录后恢复。" : "Your workspace is linked and can be restored on other devices.") : (language === "zh" ? "当前以访客身份使用；登录完全可选。" : "You are using guest mode. Sign-in is completely optional.")}</p></div></div>
          <div className="account-settings-list"><div><span>{language === "zh" ? "使用身份" : "Identity"}</span><strong>{accountName || (language === "zh" ? "访客" : "Guest")}</strong></div><div><span>{language === "zh" ? "学习画像" : "Learning profile"}</span><strong>{language === "zh" ? `${knowledgeCount} 个知识节点` : `${knowledgeCount} knowledge nodes`}</strong></div><div><span>{language === "zh" ? "画像来源" : "Profile source"}</span><strong>{language === "zh" ? "由纳入书架的内容自动累计" : "Built automatically from shelved content"}</strong></div></div>
          <button className="outline-button account-manage-button" onClick={onManageAccount}>{authStatus.authenticated ? (language === "zh" ? "管理账号" : "Manage account") : (language === "zh" ? "登录并同步" : "Sign in & sync")}</button>
        </article>

        <article className="settings-panel">
          <div className="settings-panel-head"><span className="settings-icon">Aa</span><div><h2>{language === "zh" ? "链接标题" : "Link titles"}</h2><p>{language === "zh" ? "决定标题留空时采用原内容标题，还是继续使用域名加内容类型。" : "Choose how untitled links are named."}</p></div></div>
          <div className="title-mode-control" role="group" aria-label={language === "zh" ? "标题生成方式" : "Title mode"}>
            <button type="button" className={titleMode === "automatic" ? "active" : ""} disabled={titleBusy} onClick={async () => { setTitleBusy(true); try { await onTitleModeChange("automatic"); } finally { setTitleBusy(false); } }}><strong>{language === "zh" ? "自动生成内容标题" : "Use content title"}</strong><span>{language === "zh" ? "分析后采用来源中的正式标题" : "Use the verified title after analysis"}</span></button>
            <button type="button" className={titleMode === "source" ? "active" : ""} disabled={titleBusy} onClick={async () => { setTitleBusy(true); try { await onTitleModeChange("source"); } finally { setTitleBusy(false); } }}><strong>{language === "zh" ? "沿用当前方式" : "Keep current naming"}</strong><span>{language === "zh" ? "使用域名加视频、文章或论文" : "Use domain plus content type"}</span></button>
          </div>
          <p className="setting-help">{language === "zh" ? "手动填写的标题不会被覆盖；设置只影响之后提交且标题留空的链接。" : "Manually entered titles are never overwritten. This applies to future untitled links."}</p>
        </article>

        <article className="settings-panel">
          <div className="settings-panel-head"><span className="settings-icon">✎</span><div><h2>{language === "zh" ? "笔记" : "Notes"}</h2><p>{language === "zh" ? "控制每次内容分析完成后是否自动整理一条可编辑笔记。" : "Choose whether completed analyses create an editable note automatically."}</p></div></div>
          <label className="setting-toggle">
            <div><strong>{language === "zh" ? "每次分析自动生成笔记" : "Create a note after every analysis"}</strong><p>{language === "zh" ? "笔记包含内容结论、精华内容、匹配度和内容含金量。" : "Notes include the verdict, highlights, personal match and content value."}</p></div>
            <input type="checkbox" checked={autoCreateNote} disabled={noteBusy} onChange={async (event) => { setNoteBusy(true); try { await onAutoCreateNoteChange(event.target.checked); } catch (caught) { setError(caught instanceof Error ? caught.message : (language === "zh" ? "笔记设置保存失败" : "Could not save note settings.")); } finally { setNoteBusy(false); } }} />
            <span aria-hidden="true" />
          </label>
        </article>

        <article className="settings-panel discovery-settings-panel">
          <div className="settings-panel-head"><span className="settings-icon">⌁</span><div><h2>{language === "zh" ? "自动发现" : "Automatic discovery"}</h2><p>{language === "zh" ? "根据已入架主题检索全网公开视频，每天最多生成 1 条候选推荐。" : "Search the public web from shelved topics and create at most one candidate per day."}</p></div></div>
          <label className="setting-toggle">
            <div><strong>{language === "zh" ? "自动发现候选视频" : "Discover candidate videos"}</strong><p>{language === "zh" ? "默认关闭；开启后由后台定时检索，候选不会自动进入书架。" : "Off by default. Background searches never add candidates to your shelf."}</p></div>
            <input type="checkbox" checked={autoDiscoverVideos} disabled={discoveryBusy} onChange={async (event) => { setDiscoveryBusy(true); try { await onDiscoverySettingsChange({ autoDiscoverVideos: event.target.checked, ...(event.target.checked ? {} : { autoAnalyzeDiscoveries: false }) }); } catch (caught) { setError(caught instanceof Error ? caught.message : (language === "zh" ? "自动发现设置保存失败" : "Could not save discovery settings.")); } finally { setDiscoveryBusy(false); } }} />
            <span aria-hidden="true" />
          </label>
          <label className="setting-toggle">
            <div><strong>{language === "zh" ? "发现后自动分析" : "Analyze discoveries automatically"}</strong><p>{language === "zh" ? "开启后会使用每日分析额度；关闭时只推荐候选内容。" : "Uses your daily allowance when on; otherwise only recommends candidates."}</p></div>
            <input type="checkbox" checked={autoAnalyzeDiscoveries} disabled={discoveryBusy || !autoDiscoverVideos} onChange={async (event) => { setDiscoveryBusy(true); try { await onDiscoverySettingsChange({ autoAnalyzeDiscoveries: event.target.checked }); } catch (caught) { setError(caught instanceof Error ? caught.message : (language === "zh" ? "自动分析设置保存失败" : "Could not save automatic analysis settings.")); } finally { setDiscoveryBusy(false); } }} />
            <span aria-hidden="true" />
          </label>
          <div className="discovery-settings-action"><span>{language === "zh" ? `当前兴趣来源：${knowledgeCount} 个书架知识节点` : `Interest source: ${knowledgeCount} shelf knowledge nodes`}</span><button className="outline-button" disabled={discoveryBusy || !autoDiscoverVideos || !knowledgeCount} onClick={async () => { setDiscoveryBusy(true); setError(""); try { await onDiscoverNow(); } catch (caught) { setError(caught instanceof Error ? caught.message : (language === "zh" ? "自动发现失败" : "Discovery failed.")); } finally { setDiscoveryBusy(false); } }}>{language === "zh" ? "立即发现一条" : "Discover now"}</button></div>
        </article>

        <article className="settings-panel">
          <div className="settings-panel-head"><span className="settings-icon">◎</span><div><h2>{language === "zh" ? "学习记录" : "Learning records"}</h2><p>{language === "zh" ? "你决定留下什么，Peek 据此逐渐理解你的方向。" : "Peek learns your direction from what you choose to keep."}</p></div></div>
          <div className="data-truth-list">
            <div><i className="truth-dot live" /><div><strong>{language === "zh" ? "自动保存" : "Saved automatically"}</strong><p>{language === "zh" ? "分析结果、书架状态、笔记和知识更新都会保留在你的学习空间中。" : "Results, shelf choices, notes and knowledge updates stay in your learning space."}</p></div></div>
            <div><i className="truth-dot template" /><div><strong>{language === "zh" ? "画像自动成长" : "Profile grows automatically"}</strong><p>{language === "zh" ? "新空间不预填学习画像。只有你确认纳入书架的内容，才会成为画像和技能树的累积依据。" : "New workspaces do not prefill a learning profile. Only content you add to the shelf shapes your profile and skill tree."}</p></div></div>
            <div><i className="truth-dot empty" /><div><strong>{language === "zh" ? "由你控制" : "You stay in control"}</strong><p>{language === "zh" ? "未纳入书架的内容不会改变你的个人画像或技能树。" : "Items outside your shelf do not change your profile or skill tree."}</p></div></div>
          </div>
        </article>

      </div>

      <article className="settings-panel settings-footnote">
        <div><span className="eyebrow">PRIVACY</span><h2>{language === "zh" ? "访客可用，登录可选" : "Guest-ready, optional sign-in"}</h2></div>
        <p>{language === "zh" ? "不登录也可以完整使用。Peek 不保存视频或原文副本，只保留分析结果和你主动写下的笔记。" : "Everything works without sign-in. Peek stores results and your notes, not copies of source videos or text."}</p>
      </article>
    </section>
  );
}

function ProgressView({ language, analysis, onBack, onRetry }: { language: Language; analysis: Analysis; onBack: () => void; onRetry: () => void }) {
  const stopped = ["failed", "cancelled"].includes(analysis.status);
  const contentLabel = contentTypeLabel(analysis.contentType, language);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (stopped || analysis.result) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [stopped, analysis.result]);
  const parsedStart = new Date(analysis.createdAt || "").getTime();
  const elapsed = Number.isFinite(parsedStart) ? Math.max(0, Math.floor((now - parsedStart) / 1000)) : 0;
  const stageText = `${analysis.status} ${analysis.progressText}`.toLowerCase();
  const progress = stopped ? 100 : /completed|完成/.test(stageText) ? 100 : /repair|修复|整理/.test(stageText) ? 88 : /逐段|结论|分析/.test(stageText) ? 62 : /taskid|恢复|created|运行/.test(stageText) ? 42 : /连接|创建/.test(stageText) ? 24 : 10;
  const etaSeconds = Math.max(20, Math.round((100 - progress) * 4.2));
  const steps = language === "zh" ? ["读取内容", "判断价值", "提炼重点", "整理笔记"] : ["Read", "Evaluate", "Find highlights", "Create notes"];
  return (
    <section className="page centered-page"><article className="progress-card enhanced-progress"><div className={`agent-orb ${stopped ? "stopped" : ""}`}><img src="/mascot-v2.png" alt="" />{!stopped && <i />}</div><span className="eyebrow">PEEK IS READING</span><h1>{stopped ? (language === "zh" ? "这次没有完成" : "This task did not finish") : (language === "zh" ? "Peek 正在替你先读" : "Peek is reviewing it")}</h1><p>{analysis.progressText}</p><div className="analysis-progress-head"><strong>{stopped ? (language === "zh" ? "已停止" : "Stopped") : `${progress}%`}</strong><span>{language === "zh" ? `已用 ${formatTime(elapsed)} · 预计还需约 ${formatTime(etaSeconds)}` : `${formatTime(elapsed)} elapsed · about ${formatTime(etaSeconds)} left`}</span></div><div className="analysis-progress-bar"><i style={{ width: `${progress}%` }} /></div><div className="progress-steps">{steps.map((step, index) => <div className={progress >= (index + 1) * 23 ? "done" : progress >= index * 23 ? "active" : ""} key={step}><i>{progress >= (index + 1) * 23 ? "✓" : index + 1}</i><span>{step}</span></div>)}</div><div className="task-facts"><div><span>{contentLabel}</span><strong>{analysis.title}</strong></div><div><span>{language === "zh" ? "当前进度" : "Progress"}</span><strong>{analysisStageLabel(analysis.status, language)}</strong></div></div><div className="progress-help"><strong>{language === "zh" ? "可以先去做别的" : "You can leave this page"}</strong><p>{language === "zh" ? "分析完成后会自动出现在历史记录中。" : "The result will appear in History when it is ready."}</p></div>{analysis.errorMessage && <div className="error-box">{analysis.errorMessage}</div>}<div className="button-row">{analysis.id && stopped && <button className="primary-button" onClick={onRetry}>{language === "zh" ? "重新尝试" : "Try again"}</button>}<button className="secondary-button" onClick={onBack}>{language === "zh" ? "返回" : "Back"}</button></div></article></section>
  );
}

function DetailView({ language, analysis, onBack, onState, onNoteSaved }: { language: Language; analysis: Analysis; onBack: () => void; onState: (state: string) => Promise<void>; onNoteSaved: () => void }) {
  const [reportLanguage, setReportLanguage] = useState<Language>("zh");
  const [translatedResult, setTranslatedResult] = useState<XianjianAnalysisResult | null>(null);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [shelfBusy, setShelfBusy] = useState(false);
  const [playError, setPlayError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<LearningAnswerPayload | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState("");
  const result = translatedResult || analysis.result!;
  useEffect(() => {
    setReportLanguage("zh");
    setTranslatedResult(null);
    setTranslationError("");
    setAnswer(null);
    setQuestion("");
  }, [analysis.id]);
  const translateReport = async (target: Language) => {
    if (target === "zh") {
      setTranslatedResult(null);
      setReportLanguage("zh");
      return;
    }
    setTranslationBusy(true);
    setTranslationError("");
    try {
      const payload = await api<{ result: XianjianAnalysisResult }>(`/api/analyses/${analysis.id}/translate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: target }) });
      setTranslatedResult(payload.result);
      setReportLanguage(target);
    } catch (caught) {
      setTranslationError(caught instanceof Error ? caught.message : (language === "zh" ? "报告翻译失败" : "Could not translate the report."));
    } finally {
      setTranslationBusy(false);
    }
  };
  const askPeek = async () => {
    if (!question.trim()) return;
    setAskBusy(true);
    setAskError("");
    setAnswer(null);
    try {
      const payload = await api<LearningAnswerPayload>(`/api/analyses/${analysis.id}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, language }) });
      setAnswer(payload);
    } catch (caught) {
      setAskError(caught instanceof Error ? caught.message : (language === "zh" ? "暂时无法回答" : "Could not answer right now."));
    } finally {
      setAskBusy(false);
    }
  };
  const highlights = result.segments.filter((segment) => segment.decision === "watch").slice(0, 4);
  const valueScore = contentValueScore(result);
  const matchReason = language === "zh"
    ? result.signals.match >= 75
      ? "与你当前关注的方向高度契合，值得优先看。"
      : result.signals.match >= 50
        ? "与你当前关注的方向有一定关联，建议选择重点。"
        : result.signals.match >= 30
          ? "与你当前关注的方向关联有限，可按兴趣决定。"
          : "与你当前关注的方向关联较弱，可以降低优先级。"
    : result.signals.match >= 75
      ? "Highly aligned with your current interests."
      : result.signals.match >= 50
        ? "Somewhat aligned; focus on the recommended parts."
        : result.signals.match >= 30
          ? "Limited alignment; keep it if the topic interests you."
          : "Low alignment with your current interests.";
  const matchExplanation = result.personalization
    ? language === "zh"
      ? `综合知识关联 ${result.personalization.relevance}%、可获得的新知识 ${result.personalization.knowledgeGain}%、难度适合度 ${result.personalization.difficultyFit}% 和内容含金量得出。书架变化后会重新判断。`
      : `Combines topic relevance ${result.personalization.relevance}%, new knowledge ${result.personalization.knowledgeGain}%, difficulty fit ${result.personalization.difficultyFit}% and content value. It updates with your shelf.`
    : language === "zh"
      ? "综合你的知识方向、可获得的新知识、内容难度和内容含金量得出。"
      : "Combines your interests, potential learning, difficulty and content value.";
  const valueReason = result.signals.valueReason || (valueScore >= 75
    ? "信息密度、专业度和可信度较高，内容本身值得保留。"
    : "内容有一定信息价值，但深度或原创性较为有限。");
  const shelved = isOnShelf(analysis.meetingState);
  const isVideo = analysis.contentType === "video";
  const contentLabel = contentTypeLabel(analysis.contentType, language);
  const genericShelfTopics = new Set(["数学史", "数学", "几何测度论", "调和分析", "证明策略", "核心方法", "技术细节"]);
  const skillNames = (result.skillAssessment?.skills || [])
    .map((skill) => skill.name)
    .filter((name) => name.length <= 20 && !/[，。；！？：]/.test(name) && !/(已被|获得|发表于|提供了|完成了|证明了|是否|将)/.test(name));
  const segmentTopics = result.segments.flatMap((segment) => segment.tags || []);
  const shelfTopics = [...new Set([...skillNames, ...segmentTopics])]
    .filter((name) => name.length <= 20 && !genericShelfTopics.has(name))
    .slice(0, 6);
  const changeShelf = async (state: string) => {
    setShelfBusy(true);
    try { await onState(state); }
    finally { setShelfBusy(false); }
  };
  const openSegment = (segment: XianjianAnalysisResult["segments"][number]) => {
    const contentUrl = analysis.contentUrl || analysis.videoUrl;
    if (!contentUrl) {
      setPlayError(language === "zh"
        ? `这条记录没有保存原${contentLabel}链接，无法定位。请重新提交公开链接。`
        : `This record has no source ${contentLabel.toLowerCase()} URL to locate.`);
      return;
    }
    setPlayError("");
    window.open(isVideo ? playbackUrl(contentUrl, segment.startSeconds) : contentLocatorUrl(contentUrl, segment), "_blank", "noopener,noreferrer");
  };
  return (
    <section className="page page-view">
      <div className="detail-top"><button className="back-button" onClick={onBack}>← {language === "zh" ? "返回" : "Back"}</button><div className="detail-actions">{shelved ? <><button className="secondary-button shelf-confirmed" disabled>✓ {language === "zh" ? "已在书架" : "On shelf"}</button><button className="icon-button" disabled={shelfBusy} onClick={() => changeShelf("archived")} aria-label={language === "zh" ? "移出书架" : "Remove from shelf"} title={language === "zh" ? "移出书架并同步技能树" : "Remove from shelf and sync skill tree"}>−</button></> : <><button className="primary-button" disabled={shelfBusy} onClick={() => changeShelf("shelved")}>＋ {language === "zh" ? "纳入书架" : "Add to shelf"}</button><button className="secondary-button" disabled={shelfBusy} onClick={() => changeShelf("archived")}>{language === "zh" ? "暂不纳入" : "Not now"}</button></>}</div></div>
      <div className="report-language-bar"><div><span>文A</span><p><strong>{language === "zh" ? "报告语言" : "Report language"}</strong><small>{language === "zh" ? "需要时再转换，已经转换过的版本可以直接再看。" : "Translate when needed; previously translated versions are ready to revisit."}</small></p></div><div className="report-language-actions"><button className={reportLanguage === "zh" ? "active" : ""} disabled={translationBusy} onClick={() => translateReport("zh")}>中文</button><button className={reportLanguage === "en" ? "active" : ""} disabled={translationBusy} onClick={() => translateReport("en")}>{translationBusy ? (language === "zh" ? "转换中…" : "Translating…") : "English"}</button></div>{translationError && <span className="report-language-error">{translationError}</span>}</div>
      <div className="detail-hero"><div className="detail-cover"><div className="cover-grid" /><span>{analysis.source.split(/[·｜|]/)[0].toUpperCase()}</span><small>{contentLabel.toUpperCase()} · PEEKED</small>{isVideo ? <i>{timecode(result.totalDurationSeconds)}</i> : <i>{result.segments.length} 节</i>}</div><div className="detail-copy"><span className="meta">{analysis.source}</span><h1>{analysis.title}</h1><p>{result.summary}</p><div className="speaker-row"><span className="speaker-avatar">P</span><div><strong>Peek 内容助手</strong><small>{language === "zh" ? (isVideo ? "已整理重点和观看路线" : "已整理重点和阅读路线") : (isVideo ? "Highlights and viewing route ready" : "Highlights and reading route ready")}</small></div></div></div><div className="verdict-card"><span className="verdict-label"><i />{language === "zh" ? "Peek 的结论" : "Peek's verdict"}</span><strong>{verdictLabel(result.verdict, language)}</strong><p>{language === "zh" ? (isVideo ? `只看 ${result.segments.filter((segment) => segment.decision === "watch").length} 个片段，共 ${formatTime(result.recommendedSeconds)}。` : `建议优先阅读 ${result.segments.filter((segment) => segment.decision === "watch").length} 个章节。`) : `${result.segments.filter((segment) => segment.decision === "watch").length} recommended sections.`}</p><div><span>{language === "zh" ? "与你的匹配度" : "Match"}</span><b>{result.signals.match}%</b></div></div></div>
      <div className="detail-body">
        <article className="route-panel"><div className="section-head"><div><span className="eyebrow">{isVideo ? "YOUR WATCHING ROUTE" : "YOUR READING ROUTE"}</span><h2>{language === "zh" ? (isVideo ? "你的观看路线" : "你的阅读路线") : (isVideo ? "Your watching route" : "Your reading route")}</h2><p>{language === "zh" ? (isVideo ? `完整视频 ${formatTime(result.totalDurationSeconds)}，只保留能推动当前项目的部分。` : "按原文章节定位，先读最能推动当前项目的部分。") : (isVideo ? `From ${formatTime(result.totalDurationSeconds)}, only keep what moves your project forward.` : "Jump directly to the sections that move your current project forward.")}</p></div>{isVideo && <div className="time-saved"><span>{language === "zh" ? "预计节省" : "TIME SAVED"}</span><strong>{formatTime(result.savedSeconds)}</strong></div>}</div>
          {isVideo && <div className="video-timeline"><div className="timeline-bar">{result.segments.map((segment) => <i key={segment.id} className={`dynamic-segment ${segment.decision}`} style={{ left: `${(segment.startSeconds / result.totalDurationSeconds) * 100}%`, width: `${Math.max(1, ((segment.endSeconds - segment.startSeconds) / result.totalDurationSeconds) * 100)}%` }} />)}</div><div className="timeline-labels"><span>00:00</span><span>{timecode(result.totalDurationSeconds / 4)}</span><span>{timecode(result.totalDurationSeconds / 2)}</span><span>{timecode(result.totalDurationSeconds * 0.75)}</span><span>{timecode(result.totalDurationSeconds)}</span></div></div>}
          {playError && <div className="playback-error">{playError}</div>}
          <div className="route-list">{result.segments.map((segment) => (
            <div className={`route-item ${segment.decision === "watch" ? "active" : ""}`} key={segment.id}>
              <button className="play" onClick={() => openSegment(segment)} aria-label={isVideo ? (language === "zh" ? `从 ${timecode(segment.startSeconds)} 播放` : `Play from ${timecode(segment.startSeconds)}`) : (language === "zh" ? "定位原文" : "Locate source text")} title={analysis.contentUrl || analysis.videoUrl ? (isVideo ? (language === "zh" ? "打开原视频并定位到此时间码" : "Open the source video at this timestamp") : (language === "zh" ? "定位原文章节" : "Locate this section in the source")) : (language === "zh" ? "缺少原文链接" : "Source URL unavailable")}>{isVideo ? "▶" : "⌖"}</button>
              <div className="route-copy">
                <div className="route-meta">
                  <span>{isVideo ? `${timecode(segment.startSeconds)} — ${timecode(segment.endSeconds)} · ${formatTime(segment.endSeconds - segment.startSeconds)}` : (segment.locator?.pageNumber ? `第 ${segment.locator.pageNumber} 页` : segment.locator?.heading || `第 ${segment.startSeconds + 1} 节`)}</span>
                  <b className="route-decision">{segment.decision === "watch" ? (language === "zh" ? "现在看" : "Watch") : (language === "zh" ? "可跳过" : "Skip")}</b>
                </div>
                <strong>{segment.title}</strong>
                <p>{segment.value}</p>
                <div className="tag-row">{segment.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                {noteFor === segment.id
                  ? <div className="inline-note"><textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder={language === "zh" ? (isVideo ? "记录这个时间码…" : "记录这个章节…") : "Write a note…"} /><button className="primary-button" onClick={async () => { if (!noteText.trim()) return; await api("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ meetingId: analysis.meetingId, segmentId: segment.id, timecodeSeconds: isVideo ? segment.startSeconds : null, content: noteText }) }); setNoteFor(null); setNoteText(""); onNoteSaved(); }}>{language === "zh" ? "保存" : "Save"}</button></div>
                  : <button className="note-button" onClick={() => setNoteFor(segment.id)}>＋ {language === "zh" ? (isVideo ? "记时间码笔记" : "记章节笔记") : "Add note"}</button>}
              </div>
            </div>
          ))}</div>
        </article>
        <aside className="detail-aside">
          <article className="qa-card"><div className="qa-card-head"><img src="/mascot-v2.png" alt="Peek" /><div><span className="eyebrow">ASK PEEK</span><h3>{language === "zh" ? "不懂的地方，直接问" : "Ask anything about this item"}</h3></div></div><p>{language === "zh" ? "不用写提示词。Peek 会回到原内容和报告里找具体答案。" : "No prompting skills needed. Peek checks the source and report for a specific answer."}</p><div className="qa-suggestions">{(language === "zh" ? ["这几个要素分别是什么？", "核心结论怎么推出来的？", "最难的概念是什么？"] : ["What are the key elements?", "How is the conclusion derived?", "What is the hardest concept?"]).map((item) => <button key={item} onClick={() => setQuestion(item)}>{item}</button>)}</div><textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={800} placeholder={language === "zh" ? "直接写下你的问题…" : "Write your question naturally…"} /><button className="primary-button" disabled={askBusy || question.trim().length < 2} onClick={askPeek}>{askBusy ? (language === "zh" ? "Peek 正在回到内容里查找…" : "Peek is checking the source…") : (language === "zh" ? "问 Peek" : "Ask Peek")}</button>{askError && <div className="qa-error">{askError}</div>}{answer && <div className="qa-answer"><strong>{language === "zh" ? "Peek 的回答" : "Peek's answer"}</strong><RichNote content={answer.answer} />{answer.evidence?.length ? <details><summary>{language === "zh" ? "查看依据" : "View evidence"}</summary><ul>{answer.evidence.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}<button onClick={async () => { await api("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ meetingId: analysis.meetingId, segmentId: `qa:${Date.now()}`, content: `## ${language === "zh" ? "随时问" : "Q&A"}\n\n**${language === "zh" ? "问题" : "Question"}：**${question}\n\n${answer.note}` }) }); onNoteSaved(); }}>{language === "zh" ? "＋ 加入这篇内容的笔记" : "+ Add to this content's notes"}</button></div>}</article>
          <article className="why-card highlight-card"><div className="aside-heading"><div><span className="eyebrow">HIGHLIGHTS</span><h3>{language === "zh" ? "精华内容" : "Highlights"}</h3></div><b>{highlights.length}</b></div><ul>{highlights.map((item) => <li key={item.id}><i /><span><strong>{item.title}</strong><small>{item.value}</small></span></li>)}</ul></article>
          <article className="score-card">
            <div className="score-block match-score"><div><span className="score-label">{language === "zh" ? "与你的匹配度" : "Your match"}<InfoTip label={language === "zh" ? "匹配度说明" : "About this score"}>{matchExplanation}</InfoTip></span><em>{scoreBand(result.signals.match, language)}</em></div><strong>{result.signals.match}<small>%</small></strong><p>{matchReason}</p><i><b style={{ width: `${result.signals.match}%` }} /></i></div>
            <div className="score-block value-score"><div><span>{language === "zh" ? "内容含金量" : "Content value"}</span><em>{scoreBand(valueScore, language)}</em></div><strong>{valueScore}<small>%</small></strong><p>{valueReason}</p><i><b style={{ width: `${valueScore}%` }} /></i></div><div className="score-details">{[[language === "zh" ? "专业深度" : "Depth", result.signals.depth], [language === "zh" ? "来源可信" : "Reliability", result.signals.sourceReliability], [language === "zh" ? "推广占比" : "Promotion", result.signals.promotion]].map(([label, value]) => <div key={String(label)}><span>{label}</span><b>{value}%</b></div>)}</div>
          </article>
          <article className={`shelf-decision-card ${shelved ? "is-shelved" : ""}`}><div className="memory-title"><img src="/mascot-v2.png" alt="" /><div><strong>{shelved ? (language === "zh" ? "已同步到技能树" : "Skill tree updated") : (language === "zh" ? "是否值得进入你的知识体系？" : "Add this to your knowledge system?")}</strong><p>{shelved ? (language === "zh" ? "移出书架时会同步撤回" : "Removing it also reverts the update") : (language === "zh" ? "由你确认，不会自动替你做决定" : "You decide; nothing is added automatically")}</p></div></div><span>{shelfTopics.length ? shelfTopics.join(" · ") : (language === "zh" ? "纳入后会根据内容整理知识点" : "Knowledge points will be organized after adding")}</span>{!shelved && <button className="primary-button" disabled={shelfBusy} onClick={() => changeShelf("shelved")}>{language === "zh" ? "纳入书架并更新技能树" : "Add to shelf and update skill tree"}</button>}</article>
        </aside>
      </div>
    </section>
  );
}

function AddMeeting({ language, demo, onClose, onStart, notify }: { language: Language; demo: DemoPayload | null; onClose: () => void; onStart: (input: { contentType?: ContentType; contentUrl?: string; videoUrl?: string; title?: string; source?: string; transcript?: string }) => void; notify: (message: string) => void }) {
  const [contentType, setContentType] = useState<ContentType>("video");
  const [contentUrl, setContentUrl] = useState("");
  const [title, setTitle] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [transcript, setTranscript] = useState("");
  const validUrl = /^https?:\/\/\S+/i.test(contentUrl.trim());
  const typeLabel = contentTypeLabel(contentType, language);
  const sourceHint = contentType === "video"
    ? (language === "zh" ? "支持公开的 YouTube、Bilibili、Vimeo 与其他可访问视频页面；必须有字幕、文字稿或章节时间码。" : "Supports public video pages with captions, transcript or chapters.")
    : (language === "zh" ? "支持公开可访问的文章、网页与 PDF 论文链接；Peek 会标出可直接回到原文的章节。" : "Use a public article, web page or PDF. Peek returns locatable source sections.");
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal video-link-modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <div className="modal-head"><div><span className="eyebrow">NEW ANALYSIS</span><h2 id="add-title">{language === "zh" ? "提交内容，Peek 替你先读" : "Share content. Peek reviews it first."}</h2><p>{language === "zh" ? "公开视频、文章和论文都可以分析。结果会保留可回到原内容的关键位置。" : "Analyze public videos, articles and papers with links back to key source locations."}</p></div><button className="close-button" onClick={onClose} aria-label="关闭">×</button></div>
        <div className="link-hero">
          <div className="content-type-control" role="group" aria-label={language === "zh" ? "内容类型" : "Content type"}>{(["video", "article", "paper"] as ContentType[]).map((type) => <button key={type} type="button" className={contentType === type ? "active" : ""} onClick={() => { setContentType(type); setAdvanced(false); }}>{contentTypeLabel(type, language)}</button>)}</div>
          <label><span>{language === "zh" ? `${typeLabel}链接` : `${typeLabel} URL`}</span><div className="url-input-wrap"><span>↗</span><input value={contentUrl} onChange={(event) => setContentUrl(event.target.value)} placeholder={contentType === "video" ? "https://www.youtube.com/watch?v=… / https://www.bilibili.com/video/…" : contentType === "paper" ? "https://arxiv.org/pdf/… / https://example.com/paper.pdf" : "https://example.com/article"} autoFocus /></div><small>{sourceHint}</small></label>
          <label><span>{language === "zh" ? "标题（选填）" : "Title (optional)"}</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={language === "zh" ? "留空时根据链接自动命名" : "Auto-named from the URL when empty"} /></label>
        </div>
        <button className="advanced-toggle" onClick={() => setAdvanced((open) => !open)}>{advanced ? "−" : "＋"} {language === "zh" ? (contentType === "video" ? "高级输入：我已经有字幕" : "高级输入：我已经有原文") : "Advanced: paste source text"}</button>
        {advanced && <div className="advanced-panel"><textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder={language === "zh" ? (contentType === "video" ? "粘贴带时间码的 SRT / VTT / TXT…" : "粘贴文章或论文正文…") : "Paste source text…"} maxLength={80000} /><div>{contentType === "video" && demo && <button className="text-button" onClick={() => { setTranscript(demo.demo.transcript); setTitle(demo.demo.title); setContentUrl(""); notify(language === "zh" ? "已载入内置示例" : "Demo loaded"); }}>{language === "zh" ? "载入内置示例" : "Load demo"}</button>}<span>{transcript.length.toLocaleString()} / 80,000</span></div></div>}
        <div className="privacy-strip"><img src="/mascot-v2.png" alt="" /><div><strong>{language === "zh" ? "只分析，不保存原内容" : "Analyze only. Source media is not stored."}</strong><p>{language === "zh" ? "链接只用于本次分析；完成后只保留结果、阅读或观看路线和你的笔记。" : "Only the result, route and notes are retained."}</p></div></div>
        <div className="modal-footer"><p>{language === "zh" ? "本次分析使用 1 次今日额度。" : "This uses one analysis from today's allowance."}</p><button className="secondary-button" onClick={onClose}>{language === "zh" ? "取消" : "Cancel"}</button><button className="primary-button" disabled={advanced ? transcript.trim().length < 500 : !validUrl} onClick={() => { notify(language === "zh" ? "已加入分析列表" : "Added to the analysis list"); advanced ? onStart({ contentType, title, source: `${typeLabel}文本`, transcript }) : onStart({ contentType, contentUrl, title }); }}>{language === "zh" ? "开始分析" : "Start analysis"} →</button></div>
      </section>
    </div>
  );
}
