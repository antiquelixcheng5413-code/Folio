"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LearningProfile, XianjianAnalysisResult } from "../lib/types";

type View = "home" | "later" | "history" | "skills" | "profile" | "settings" | "progress" | "detail";
type Language = "zh" | "en";
type Analysis = {
  id: string;
  meetingId: string;
  title: string;
  source: string;
  status: string;
  progressText: string;
  taskId: string | null;
  errorMessage?: string | null;
  result: XianjianAnalysisResult | null;
};
type MeetingItem = {
  id: string;
  title: string;
  source: string;
  durationSeconds: number;
  state: string;
  createdAt: string;
  analysisId?: string;
  status?: string;
  taskId?: string;
  noteCount?: number;
  result?: XianjianAnalysisResult | null;
};
type DemoPayload = {
  demo: { title: string; source: string; transcript: string };
  profiles: Array<{ id: string; name: string; profile: LearningProfile }>;
};

const EMPTY_PROFILE: LearningProfile = {
  direction: "",
  level: "",
  project: "",
  knownTopics: "",
  preferences: "",
};

const copy = {
  zh: {
    workspace: "今天",
    home: "首页",
    later: "稍后看",
    history: "历史记录",
    skills: "技能树",
    profile: "个人画像",
    settings: "设置",
    detail: "会议分析",
    search: "搜索会议、观点或讲者",
    add: "添加会议",
    worth: "值得看",
    selective: "选择性看",
    skip: "可以跳过",
    open: "看路线",
    noItems: "这里还没有记录。添加一个视频链接，Mira 会替你先看。",
  },
  en: {
    workspace: "Workspace",
    home: "Home",
    later: "Watch later",
    history: "History",
    skills: "Skill tree",
    profile: "Learning profile",
    settings: "Settings",
    detail: "Conference analysis",
    search: "Search talks, ideas or speakers",
    add: "Add conference",
    worth: "Worth watching",
    selective: "Watch selectively",
    skip: "Safe to skip",
    open: "View route",
    noItems: "No records yet. Add a video link and Mira will preview it for you.",
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

function NavIcon({ kind }: { kind: "home" | "later" | "history" | "skills" | "profile" }) {
  const paths = {
    home: <><path d="M4 10.8 12 4l8 6.8V20H4z" /><path d="M9 20v-6h6v6" /></>,
    later: <path d="M6 3h12v18l-6-4-6 4z" />,
    history: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" /><path d="M4 4v4.6h4.6M12 8v5l3 2" /></>,
    skills: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M8 4v16M12 8h4" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>;
}

export default function XianjianApp() {
  const [view, setView] = useState<View>("home");
  const [previousView, setPreviousView] = useState<View>("home");
  const [language, setLanguage] = useState<Language>("zh");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [knowledge, setKnowledge] = useState<Record<string, unknown>[]>([]);
  const [demo, setDemo] = useState<DemoPayload | null>(null);
  const [profile, setProfile] = useState<LearningProfile>(EMPTY_PROFILE);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [canRestore, setCanRestore] = useState(false);
  const t = copy[language];

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

  useEffect(() => {
    Promise.all([
      api<DemoPayload>("/api/demo"),
      api<{ profile: LearningProfile }>("/api/profile"),
      api<{ items: MeetingItem[] }>("/api/library?view=meetings"),
      api<{ items: Record<string, unknown>[] }>("/api/library?view=knowledge"),
      api<{ canRestore: boolean }>("/api/session/status"),
    ])
      .then(([demoPayload, profilePayload, meetingPayload, knowledgePayload, sessionPayload]) => {
        setDemo(demoPayload);
        setProfile(profilePayload.profile);
        setMeetings(meetingPayload.items || []);
        setKnowledge(knowledgePayload.items || []);
        setCanRestore(sessionPayload.canRestore);
      })
      .catch((error) => notify(error instanceof Error ? error.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [notify]);

  const navigate = useCallback((next: View) => {
    if (next !== "progress" && next !== "detail") setPreviousView(next);
    setView(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  async function pollAnalysis(analysisId: string) {
    const deadline = Date.now() + 12 * 60 * 1000;
    while (Date.now() < deadline) {
      const payload = await api<{ analysis: Analysis }>(`/api/analyses/${analysisId}`);
      setAnalysis(payload.analysis);
      if (payload.analysis.result) {
        setView("detail");
        notify(language === "zh" ? "真实分析已完成并自动归档" : "Analysis complete and archived");
        await Promise.all([loadMeetings(), loadKnowledge()]);
        return;
      }
      if (["failed", "cancelled"].includes(payload.analysis.status)) {
        throw new Error(payload.analysis.errorMessage || "分析未完成");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 8000));
    }
    setAnalysis((current) =>
      current
        ? { ...current, status: "recovering", progressText: "任务仍在运行，可稍后从历史记录恢复" }
        : current
    );
  }

  async function openAnalysis(analysisId: string) {
    setView("progress");
    try {
      await pollAnalysis(analysisId);
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法打开分析");
      setView(previousView);
    }
  }

  async function updateMeetingState(meetingId: string, state: string) {
    await api(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    notify(
      language === "zh"
        ? state === "later" ? "已加入稍后看" : state === "completed" ? "已标记看完" : state === "skipped" ? "已跳过" : "已归档"
        : "Saved"
    );
    await loadMeetings();
  }

  async function startAnalysis(input: {
    videoUrl?: string;
    title?: string;
    source?: string;
    transcript?: string;
    selectedProfile?: LearningProfile;
  }) {
    setShowAdd(false);
    setView("progress");
    const displayTitle = input.title || (() => {
      try { return `${new URL(input.videoUrl || "").hostname.replace(/^www\./, "")} 视频`; }
      catch { return "公开视频"; }
    })();
    setAnalysis({
      id: "",
      meetingId: "",
      title: displayTitle,
      source: input.source || "视频链接",
      status: "queued",
      progressText: "正在保存视频链接",
      taskId: null,
      result: null,
    });
    try {
      if (input.selectedProfile) {
        const saved = await api<{ profile: LearningProfile }>("/api/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.selectedProfile),
        });
        setProfile(saved.profile);
      }
      const meetingPayload = await api<{ meeting: { id: string; title: string; source: string } }>(
        "/api/meetings",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      const meetingId = meetingPayload.meeting.id;
      setAnalysis((current) =>
        current
          ? { ...current, meetingId, title: meetingPayload.meeting.title, source: meetingPayload.meeting.source, progressText: "正在连接真实 Agent" }
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
            setAnalysis((current) =>
              current
                ? {
                    ...current,
                    id: String(data.analysisId || current.id),
                    taskId: data.taskId ? String(data.taskId) : current.taskId,
                    status: "running",
                    progressText: String(data.stage || "Mira 正在打开视频并读取字幕"),
                  }
                : current
            );
          } else if (eventName === "deduplicated") {
            recoveryId = String(data.analysisId);
          } else if (eventName === "started") {
            recoveryId = String(data.analysisId);
            setAnalysis((current) =>
              current
                ? { ...current, id: recoveryId, taskId: String(data.taskId), status: "recovering", progressText: "真实任务运行中，可刷新恢复" }
                : current
            );
          } else if (eventName === "completed") {
            setAnalysis((current) =>
              current
                ? { ...current, id: String(data.analysisId), taskId: String(data.taskId), status: "completed", progressText: "分析完成", result: data.result as XianjianAnalysisResult }
                : current
            );
            setView("detail");
            await Promise.all([loadMeetings(), loadKnowledge()]);
          } else if (eventName === "error") {
            throw new Error(String(data.error || "分析失败"));
          }
        }
      }
      if (recoveryId) await pollAnalysis(recoveryId);
    } catch (error) {
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
  const laterMeetings = visibleMeetings.filter((item) => item.state === "later");
  const savedTotal = meetings.reduce((total, item) => total + (item.result?.savedSeconds || 0), 0);
  const worthCount = meetings.filter((item) => item.result?.verdict === "worth").length;
  const skipCount = meetings.filter((item) => item.result?.verdict === "skip").length;
  const pageName = t[view === "progress" || view === "detail" ? "detail" : view];

  if (loading) {
    return <main className="loading-screen"><div className="brand-mark">先</div><p>正在准备你的学习空间…</p></main>;
  }

  return (
    <div className="app-shell final-ui">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("home")} aria-label={t.home}>
          <span className="brand-mark">先</span>
          <span><strong>先鉴</strong><small>Conference OS</small></span>
        </button>
        <nav className="main-nav" aria-label="主要导航">
          {(["home", "later", "history", "skills", "profile"] as const).map((item) => (
            <button key={item} className={`nav-item ${view === item ? "active" : ""}`} onClick={() => navigate(item)}>
              <NavIcon kind={item} /><span>{t[item]}</span>
              {item === "later" && <b>{laterMeetings.length}</b>}
            </button>
          ))}
        </nav>
        <div className="side-note">
          <div className="mini-mascot"><img src="/mascot.png" alt="" /></div>
          <strong>{analysis?.status === "running" ? (language === "zh" ? "Mira 正在先看" : "Mira is previewing") : (language === "zh" ? "暂无进行中的分析" : "No active analysis")}</strong>
          <span>{analysis?.status === "running" ? analysis.title : language === "zh" ? "添加公开视频链接即可开始" : "Add a public video URL to begin"}</span>
          <div className="progress"><i style={{ width: analysis?.status === "running" ? "68%" : "0%" }} /></div>
          <small>{analysis?.status === "running" ? analysis.progressText : language === "zh" ? "这里不会显示虚构任务" : "No placeholder task is shown here"}</small>
        </div>
        <div className="profile-chip">
          <button className="profile-identity-button" onClick={() => navigate("profile")} aria-label={t.profile}>
            <span>NC</span><div><strong>Nan Cheng</strong><small>{language === "zh" ? "产品学习者" : "Product learner"}</small></div>
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
            <button className="primary-button" onClick={() => setShowAdd(true)}>＋ {t.add}</button>
          </div>
        </header>

        {view === "home" && (
          <HomeView
            language={language}
            meetings={visibleMeetings}
            worthCount={worthCount}
            skipCount={skipCount}
            savedTotal={savedTotal}
            laterCount={laterMeetings.length}
            knowledgeCount={knowledge.length}
            onNavigate={navigate}
            onOpen={openAnalysis}
          />
        )}
        {view === "later" && (
          <LaterView language={language} items={laterMeetings} onOpen={openAnalysis} onState={updateMeetingState} />
        )}
        {view === "history" && (
          <HistoryView language={language} items={visibleMeetings} savedTotal={savedTotal} onOpen={openAnalysis} />
        )}
        {view === "skills" && (
          <SkillsView language={language} knowledge={knowledge} onOpen={() => {
            const item = meetings.find((meeting) => meeting.analysisId);
            if (item?.analysisId) openAnalysis(item.analysisId);
            else setShowAdd(true);
          }} />
        )}
        {view === "profile" && (
          <ProfileView language={language} profile={profile} onSave={async (next) => {
            const saved = await api<{ profile: LearningProfile }>("/api/profile", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(next),
            });
            setProfile(saved.profile);
            notify(language === "zh" ? "个人画像已保存" : "Profile saved");
          }} />
        )}
        {view === "settings" && (
          <SettingsView
            language={language}
            canRestore={canRestore}
            onBlank={async () => {
              await api("/api/session/blank", { method: "POST" });
              window.location.assign("/");
            }}
            onRestore={async () => {
              await api("/api/session/restore", { method: "POST" });
              window.location.assign("/");
            }}
          />
        )}
        {view === "progress" && analysis && (
          <ProgressView language={language} analysis={analysis} onBack={() => setView(previousView)} onRetry={() => analysis.id && openAnalysis(analysis.id)} />
        )}
        {view === "detail" && analysis?.result && (
          <DetailView
            language={language}
            analysis={analysis}
            onBack={() => setView(previousView)}
            onState={(state) => updateMeetingState(analysis.meetingId, state)}
            onNoteSaved={() => notify(language === "zh" ? "时间码笔记已保存" : "Timestamp note saved")}
          />
        )}
      </main>

      {showAdd && demo && (
        <AddMeeting language={language} demo={demo} profile={profile} onClose={() => setShowAdd(false)} onStart={startAnalysis} notify={notify} />
      )}
      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}

function HomeView({
  language, meetings, worthCount, skipCount, savedTotal, laterCount, knowledgeCount, onNavigate, onOpen,
}: {
  language: Language;
  meetings: MeetingItem[];
  worthCount: number;
  skipCount: number;
  savedTotal: number;
  laterCount: number;
  knowledgeCount: number;
  onNavigate: (view: View) => void;
  onOpen: (id: string) => void;
}) {
  const items = meetings.filter((item) => item.result).slice(0, 4);
  return (
    <section className="page page-view">
      <div className="page-title home-title">
        <div><span className="eyebrow">{currentDateLabel(language)}</span><h1>{items.length ? (language === "zh" ? "Mira 已经替你先看了一轮" : "Mira has previewed the latest talks.") : (language === "zh" ? "这是一个干净的学习空间" : "This is a clean learning workspace.")}</h1><p>{language === "zh" ? `${meetings.length} 场会议里，${worthCount} 场值得看，${skipCount} 场可以放心跳过。` : `${meetings.length} talks, ${worthCount} worth watching and ${skipCount} safe to skip.`}</p></div>
        <div className="saved-pill"><span>{language === "zh" ? "本周省下" : "TIME SAVED"}</span><strong>{formatTime(savedTotal)}</strong></div>
      </div>
      <div className="home-grid">
        <article className="companion-card">
          <div className="companion-copy"><span className="eyebrow">YOUR VIEWING COMPANION</span><h2>Mira</h2><p>{language === "zh" ? "你的先看伙伴" : "Your viewing companion"}</p></div>
          <div className="mascot-stage"><div className="soft-orbit orbit-a" /><div className="soft-orbit orbit-b" /><img src="/mascot.png" alt="Mira" /></div>
          <div className="watching-now"><div className="watching-line"><i /><strong>{language === "zh" ? "随时待命" : "Ready"}</strong><span>●</span></div><p>{language === "zh" ? "粘贴视频链接即可开始" : "Paste a video link to begin"}</p><div className="progress"><i style={{ width: "0%" }} /></div><small>{language === "zh" ? "公开视频 · 自动读取字幕与时间码" : "Public videos · captions and timestamps"}</small></div>
        </article>
        <article className="feed-card">
          <div className="section-head"><div><h2>{language === "zh" ? "Mira 先替你看过了" : "Mira previewed these for you"}</h2><p>{language === "zh" ? "有用的留下，没必要看的也如实告诉你。" : "Keep the useful parts. Skip the rest."}</p></div><span className="count-badge">{language === "zh" ? `共 ${meetings.length} 场` : `${meetings.length} talks`}</span></div>
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
          <button className="quick-card" onClick={() => onNavigate("history")}><span>{language === "zh" ? "学习记录" : "Learning record"}</span><i>↗</i><strong>{knowledgeCount} {language === "zh" ? "个" : ""}</strong><small>{language === "zh" ? "自动沉淀知识更新" : "Knowledge updates"}</small></button>
          <button className="quick-card book-quick" onClick={() => onNavigate("skills")}><span>{copy[language].skills}</span><i>↗</i><strong>{language === "zh" ? "路径模板" : "Path template"}</strong><small>{language === "zh" ? `${knowledgeCount} 项真实知识更新` : `${knowledgeCount} real updates`}</small></button>
        </aside>
      </div>
    </section>
  );
}

function LaterView({ language, items, onOpen, onState }: { language: Language; items: MeetingItem[]; onOpen: (id: string) => void; onState: (id: string, state: string) => void }) {
  const full = items.reduce((sum, item) => sum + (item.result?.totalDurationSeconds || item.durationSeconds || 0), 0);
  const selected = items.reduce((sum, item) => sum + (item.result?.recommendedSeconds || 0), 0);
  return (
    <section className="page page-view">
      <div className="page-title"><div><span className="eyebrow">YOUR QUEUE</span><h1>{copy[language].later}</h1><p>{language === "zh" ? "只留下真正值得投入时间的内容。" : "Only keep content worth your time."}</p></div><button className="secondary-button">{language === "zh" ? "按相关度排序" : "Sorted by relevance"}</button></div>
      <div className="two-column">
        <article className="content-panel queue-panel">
          <div className="section-head"><div><h2>{language === "zh" ? "待看清单" : "Watch queue"}</h2><p>{language === "zh" ? "按与你当前项目的相关度排序" : "Ranked for your current project"}</p></div><div className="inline-tabs"><button className="active">{language === "zh" ? `全部 ${items.length}` : `All ${items.length}`}</button><button>{language === "zh" ? "本周" : "This week"}</button><button>{language === "zh" ? "会议" : "Talks"}</button></div></div>
          <div className="queue-list">
            {!items.length && <div className="panel-empty">{copy[language].noItems}</div>}
            {items.map((item, index) => {
              const result = item.result;
              return (
                <div className="queue-item" key={item.id}>
                  <div className={`video-cover ${index % 3 === 0 ? "cover-agent" : index % 3 === 1 ? "cover-design" : "cover-memory"}`}><span>{item.source.split(/[·｜|]/)[0]}</span><i>{timecode(result?.totalDurationSeconds || item.durationSeconds)}</i></div>
                  <div className="queue-copy"><span className="meta"><b className="status keep">{result ? verdictLabel(result.verdict, language) : "待分析"}</b>{item.source}</span><h3>{item.title}</h3><p>{result?.summary || "Mira 正在整理观看路线"}</p><div className="tag-row">{result?.newKnowledge.slice(0, 3).map((tag) => <span key={tag.topic}>{tag.topic}</span>)}</div></div>
                  <div className="queue-action"><strong>{formatTime(result?.recommendedSeconds || 0)}</strong><small>{language === "zh" ? `原长 ${formatTime(result?.totalDurationSeconds || item.durationSeconds)}` : `of ${formatTime(result?.totalDurationSeconds || item.durationSeconds)}`}</small>{item.analysisId && <button onClick={() => onOpen(item.analysisId!)}>{language === "zh" ? "开始看" : "Open"}</button>}<button className="outline-button" onClick={() => onState(item.id, "archived")}>{language === "zh" ? "移出" : "Remove"}</button></div>
                </div>
              );
            })}
          </div>
        </article>
        <aside className="summary-column">
          <article className="summary-hero"><span className="eyebrow">{language === "zh" ? "本周观看计划" : "WEEKLY PLAN"}</span><strong>{formatTime(full)}</strong><p>{language === "zh" ? "完整内容时长" : "Full duration"}</p><div className="saving-arrow"><span>{language === "zh" ? "由 Mira 精简为" : "Mira condensed it to"}</span><i>↓</i></div><strong className="accent-number">{formatTime(selected)}</strong><p>{language === "zh" ? "真正需要看的部分" : "What you need to watch"}</p></article>
          <article className="mini-panel"><div className="mini-panel-head"><strong>{language === "zh" ? "按目标分布" : "By goal"}</strong><span>{items.length} {language === "zh" ? "项" : "items"}</span></div><div className="bar-row"><span>Agent</span><i><b style={{ width: "64%" }} /></i><em>64%</em></div><div className="bar-row"><span>{language === "zh" ? "产品设计" : "Product"}</span><i><b style={{ width: "23%" }} /></i><em>23%</em></div><div className="bar-row"><span>{language === "zh" ? "其他" : "Other"}</span><i><b style={{ width: "13%" }} /></i><em>13%</em></div></article>
        </aside>
      </div>
    </section>
  );
}

function HistoryView({ language, items, savedTotal, onOpen }: { language: Language; items: MeetingItem[]; savedTotal: number; onOpen: (id: string) => void }) {
  return (
    <section className="page page-view">
      <div className="page-title"><div><span className="eyebrow">VIEWING HISTORY</span><h1>{copy[language].history}</h1><p>{language === "zh" ? "你看过的、跳过的，以及真正留下来的。" : "Everything watched, skipped and retained."}</p></div></div>
      <div className="history-layout">
        <article className="content-panel">
          <div className="section-head border-bottom"><div className="inline-tabs"><button className="active">{language === "zh" ? "全部" : "All"}</button><button>{language === "zh" ? "我看过的" : "Watched"}</button><button>{language === "zh" ? "Mira 跳过的" : "Skipped by Mira"}</button></div><button className="date-button">{language === "zh" ? "最近 30 天" : "Last 30 days"}⌄</button></div>
          <div className="history-group"><div className="history-date"><strong>{language === "zh" ? "最近" : "Recent"}</strong><span>{items.length} {language === "zh" ? "条记录" : "records"}</span></div>
            {!items.length && <div className="panel-empty">{copy[language].noItems}</div>}
            {items.map((item) => {
              const verdict = item.result?.verdict;
              const resultClass = verdict === "skip" || item.state === "skipped" ? "skip" : "keep";
              return (
                <div className="history-entry" key={item.id} onClick={() => item.analysisId && onOpen(item.analysisId)}>
                  <span className={`history-dot ${resultClass === "keep" ? "keep-dot" : "skip-dot"}`} />
                  <div><span className="meta">{item.source} · {item.result ? `Mira ${language === "zh" ? "已看完" : "previewed"}` : item.status || "等待分析"}</span><h3>{item.title}</h3><p>{item.result?.summary || `${Number(item.noteCount || 0)} 条笔记`}</p></div>
                  <b className={`history-result ${resultClass}`}>{item.result ? verdictLabel(item.result.verdict, language) : language === "zh" ? "处理中" : "Processing"}</b>
                  <time>{new Date(item.createdAt).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US", { month: "numeric", day: "numeric" })}</time>
                </div>
              );
            })}
          </div>
        </article>
        <aside className="history-stats"><article><span>{language === "zh" ? "累计省下" : "Time saved"}</span><strong>{formatTime(savedTotal)}</strong><small>{language === "zh" ? "来自真实分析结果" : "From real analyses"}</small></article><article><span>{language === "zh" ? "真正看完" : "Completed"}</span><strong>{items.filter((item) => item.state === "completed").length} {language === "zh" ? "场" : ""}</strong><small>{language === "zh" ? "聚焦高价值片段" : "Focused viewing"}</small></article><article className="mascot-tip"><img src="/mascot.png" alt="" /><div><strong>{language === "zh" ? "Mira 发现" : "Mira noticed"}</strong><p>{language === "zh" ? "你最近更愿意看带真实工程复盘的内容。" : "You prefer talks with real engineering retrospectives."}</p></div></article></aside>
      </div>
    </section>
  );
}

function SkillsView({ language, knowledge, onOpen }: { language: Language; knowledge: Record<string, unknown>[]; onOpen: () => void }) {
  const recent = knowledge.slice(0, 3);
  return (
    <section className="page page-view">
      <div className="page-title"><div><span className="eyebrow">LEARNING MAP</span><h1>{copy[language].skills}</h1><p>{language === "zh" ? "看清自己已经会什么、正在补什么，以及下一步该学什么。" : "See what you know, what you are building, and what comes next."}</p></div></div>
      <div className="skill-layout">
        <article className="skill-map-panel"><div className="section-head"><div><h2>{language === "zh" ? "Agent 产品学习路径" : "Agent product learning path"}</h2><p>{language === "zh" ? "根据你的会议记录与项目目标实时更新" : "Updated from your history and project goal"}</p></div><div className="map-legend"><span><i className="done" />{language === "zh" ? "已掌握" : "Mastered"}</span><span><i className="doing" />{language === "zh" ? "学习中" : "Learning"}</span><span><i />{language === "zh" ? "待解锁" : "Locked"}</span></div></div>
          <div className="skill-map">
            <div className="skill-column foundation"><span className="column-label">{language === "zh" ? "基础" : "Foundation"}</span><button className="skill-node done"><i>✓</i><strong>Prompt {language === "zh" ? "基础" : "Basics"}</strong><small>{language === "zh" ? "已掌握" : "Mastered"}</small></button><button className="skill-node done"><i>✓</i><strong>RAG {language === "zh" ? "基础" : "Basics"}</strong><small>{language === "zh" ? "已掌握" : "Mastered"}</small></button></div>
            <span className="skill-connector" />
            <div className="skill-column systems"><span className="column-label">{language === "zh" ? "系统能力" : "Systems"}</span><button className="skill-node done"><i>✓</i><strong>{language === "zh" ? "工具调用" : "Tool use"}</strong><small>{language === "zh" ? "已掌握" : "Mastered"}</small></button><button className="skill-node doing"><i>68</i><strong>Agent Memory</strong><small>{language === "zh" ? "学习中 · 68%" : "Learning · 68%"}</small></button><button className="skill-node doing"><i>52</i><strong>Agent {language === "zh" ? "评估" : "Evaluation"}</strong><small>{language === "zh" ? "学习中 · 52%" : "Learning · 52%"}</small></button></div>
            <span className="skill-connector" />
            <div className="skill-column product"><span className="column-label">{language === "zh" ? "产品能力" : "Product"}</span><button className="skill-node done"><i>✓</i><strong>{language === "zh" ? "任务等待体验" : "Waiting UX"}</strong><small>{language === "zh" ? "已掌握" : "Mastered"}</small></button><button className="skill-node doing"><i>36</i><strong>{language === "zh" ? "结果可信度" : "Result trust"}</strong><small>{language === "zh" ? "学习中 · 36%" : "Learning · 36%"}</small></button><button className="skill-node locked"><i>○</i><strong>{language === "zh" ? "长期个性化" : "Personalization"}</strong><small>{language === "zh" ? "待解锁" : "Locked"}</small></button></div>
            <span className="skill-connector" />
            <div className="skill-column outcome"><span className="column-label">{language === "zh" ? "项目目标" : "Goal"}</span><button className="skill-node goal"><i>先</i><strong>先鉴</strong><small>{language === "zh" ? "比赛原型" : "Competition project"}</small></button></div>
          </div>
        </article>
        <aside className="skill-side"><article className="current-skill"><span className="eyebrow">CURRENT FOCUS</span><strong>Agent Memory</strong><p>{language === "zh" ? "你已经理解存储与检索，接下来需要补齐“遗忘”和“评估”。" : "You understand storage and retrieval. Next: forgetting and evaluation."}</p><div className="skill-progress-ring"><span>68<small>%</small></span></div><button onClick={onOpen}>{language === "zh" ? "继续学习" : "Continue"}</button></article><article className="skill-gap"><span>{language === "zh" ? "当前最关键的缺口" : "KEY GAP"}</span><strong>{language === "zh" ? "如何判断记忆真的有用" : "Is this memory actually useful?"}</strong><p>{language === "zh" ? "完成 1 场会议的 3 个片段即可补齐。" : "Complete three segments from one talk."}</p><button onClick={onOpen}>{language === "zh" ? "查看对应会议 →" : "Open relevant talk →"}</button></article></aside>
      </div>
      <div className="skill-cards-head"><div><h2>{language === "zh" ? "最近更新" : "Recent updates"}</h2><p>{language === "zh" ? "来自你看过、跳过和收藏的内容" : "From watched, skipped and saved content"}</p></div><button>{knowledge.length} {language === "zh" ? "项知识更新" : "updates"}</button></div>
      <div className="skill-update-grid">
        {!recent.length && <div className="skill-update-empty">{language === "zh" ? "暂无真实知识更新。完成第一次视频分析后，这里会显示从结果中沉淀的主题与证据。" : "No real knowledge updates yet. Complete the first video analysis to populate this area with topics and evidence."}</div>}
        {recent.map((item, index) => <article key={`${String(item.topic)}-${index}`}><span className={`update-icon ${index === 0 ? "green" : index === 1 ? "navy" : "clay"}`}>{index === 0 ? "+" : index === 1 ? "↑" : "✓"}</span><div><strong>{String(item.topic)}</strong><p>{String(item.evidence)}</p></div><time>{language === "zh" ? "最近" : "Recent"}</time></article>)}
      </div>
    </section>
  );
}

function ProfileView({ language, profile, onSave }: { language: Language; profile: LearningProfile; onSave: (profile: LearningProfile) => void }) {
  const [draft, setDraft] = useState(profile);
  const known = draft.knownTopics.split(/[，,、]/).map((item) => item.trim()).filter(Boolean);
  return (
    <section className="page page-view">
      <div className="page-title"><div><span className="eyebrow">LEARNING PROFILE</span><h1>{copy[language].profile}</h1><p>{language === "zh" ? "越准确，Mira 越知道什么值得替你留下。" : "The more accurate this is, the better Mira filters."}</p></div><button className="primary-button" onClick={() => onSave(draft)}>{language === "zh" ? "保存修改" : "Save changes"}</button></div>
      <div className="profile-grid">
        <article className="profile-identity"><div className="avatar-large">NC</div><h2>Nan Cheng</h2><p>{language === "zh" ? "产品学习者 · 上海" : "Product learner · Shanghai"}</p><div className="profile-complete"><span>{language === "zh" ? "画像完整度" : "Profile completeness"}</span><strong>86%</strong></div><div className="progress"><i style={{ width: "86%" }} /></div><div className="mascot-message"><img src="/mascot.png" alt="" /><p>{language === "zh" ? "这些信息会直接影响 Mira 为你保留哪些片段。" : "These fields directly change what Mira keeps."}</p></div></article>
        <div className="profile-content">
          <article className="form-panel"><div className="panel-title"><div><h2>{language === "zh" ? "当前方向" : "Current direction"}</h2><p>{language === "zh" ? "Mira 会优先寻找能推动这个方向的内容。" : "Mira prioritizes content that moves this forward."}</p></div></div><input className="profile-input" value={draft.direction} onChange={(event) => setDraft({ ...draft, direction: event.target.value })} /><div className="goal-list"><div><span className="goal-icon green">01</span><div><strong>{draft.direction || "Agent 产品与交互设计"}</strong><p>{language === "zh" ? "当前主要学习方向" : "Primary learning direction"}</p></div><b>{language === "zh" ? "主要" : "Primary"}</b></div><div><span className="goal-icon navy">02</span><div><strong>{language === "zh" ? "当前水平" : "Current level"}</strong><input className="inline-profile-input" value={draft.level} onChange={(event) => setDraft({ ...draft, level: event.target.value })} /></div><b>{language === "zh" ? "进阶中" : "Growing"}</b></div></div></article>
          <div className="profile-split">
            <article className="form-panel"><div className="panel-title"><div><h2>{language === "zh" ? "正在做的项目" : "Current project"}</h2><p>{language === "zh" ? "决定什么内容算“现在有用”。" : "Defines what is useful right now."}</p></div></div><textarea className="profile-textarea" value={draft.project} onChange={(event) => setDraft({ ...draft, project: event.target.value })} /></article>
            <article className="form-panel"><div className="panel-title"><div><h2>{language === "zh" ? "内容偏好" : "Content preferences"}</h2><p>{language === "zh" ? "用自然语言告诉 Mira 你的筛选标准。" : "Tell Mira how to filter."}</p></div></div><textarea className="profile-textarea" value={draft.preferences} onChange={(event) => setDraft({ ...draft, preferences: event.target.value })} /></article>
          </div>
          <article className="form-panel"><div className="panel-title"><div><h2>{language === "zh" ? "已掌握主题" : "Known topics"}</h2><p>{language === "zh" ? "重复出现时，Mira 会直接提醒你。" : "Mira flags repeated material."}</p></div></div><textarea className="profile-textarea compact" value={draft.knownTopics} onChange={(event) => setDraft({ ...draft, knownTopics: event.target.value })} /><div className="skill-cloud">{known.map((item) => <span key={item}>{item}<b>{language === "zh" ? "熟悉" : "Known"}</b></span>)}</div></article>
        </div>
      </div>
    </section>
  );
}

function SettingsView({
  language,
  canRestore,
  onBlank,
  onRestore,
}: {
  language: Language;
  canRestore: boolean;
  onBlank: () => Promise<void>;
  onRestore: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (language === "zh" ? "切换失败，请稍后重试。" : "Switch failed. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page page-view settings-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">WORKSPACE SETTINGS</span>
          <h1>{copy[language].settings}</h1>
          <p>{language === "zh" ? "管理你的匿名学习空间，并核验哪些内容来自真实使用。" : "Manage your anonymous workspace and verify which content comes from real use."}</p>
        </div>
      </div>

      <div className="settings-grid">
        <article className="settings-panel">
          <div className="settings-panel-head"><span className="settings-icon">◎</span><div><h2>{language === "zh" ? "数据说明" : "About your data"}</h2><p>{language === "zh" ? "页面不会把示例伪装成你的真实记录。" : "Examples are never presented as your real activity."}</p></div></div>
          <div className="data-truth-list">
            <div><i className="truth-dot live" /><div><strong>{language === "zh" ? "真实并持久化" : "Real and persisted"}</strong><p>{language === "zh" ? "会议、分析结果、taskId、时间码路线、稍后看状态、笔记、节省时间与知识更新，均来自你当前匿名会话并保存到 D1。" : "Talks, results, taskIds, routes, watch-later state, notes, saved time and knowledge updates come from this anonymous session and are stored in D1."}</p></div></div>
            <div><i className="truth-dot template" /><div><strong>{language === "zh" ? "首次使用模板" : "First-use template"}</strong><p>{language === "zh" ? "个人画像的初始文字和技能树的路径结构是可编辑模板；技能树“最近更新”会在真实分析后使用你的知识更新。" : "Initial profile copy and the skill-path structure are editable templates. Recent skill updates use knowledge created by real analyses."}</p></div></div>
            <div><i className="truth-dot empty" /><div><strong>{language === "zh" ? "空状态就是空状态" : "Empty means empty"}</strong><p>{language === "zh" ? "没有真实任务时，首页、历史记录、稍后看和侧栏不会显示虚构会议。" : "Without a real task, Home, History, Watch later and the sidebar show no fictional talks."}</p></div></div>
          </div>
        </article>

        <article className="settings-panel verification-panel">
          <div className="settings-panel-head"><span className="settings-icon">□</span><div><h2>{language === "zh" ? "空白核验空间" : "Blank verification workspace"}</h2><p>{language === "zh" ? "从零走一遍流程，同时保留你现在的空间。" : "Walk through the product from zero without losing your current workspace."}</p></div></div>
          <ol className="verification-steps">
            <li><span>1</span><p>{language === "zh" ? "进入空白空间，确认首页与各列表没有写死数据。" : "Enter a blank workspace and verify that lists contain no hardcoded records."}</p></li>
            <li><span>2</span><p>{language === "zh" ? "点击“添加会议”，粘贴一个公开且带字幕的视频链接。" : "Choose Add conference and paste a public video URL with captions."}</p></li>
            <li><span>3</span><p>{language === "zh" ? "完成真实分析后，核验 taskId、历史记录、技能更新与笔记。" : "After analysis, verify the taskId, History, skill updates and notes."}</p></li>
          </ol>
          <div className="workspace-action">
            {error && <div className="settings-error">{error}</div>}
            {canRestore ? (
              <>
                <div className="mode-badge"><i />{language === "zh" ? "当前正在空白核验空间" : "Currently in blank verification workspace"}</div>
                <button className="primary-button" disabled={busy} onClick={() => run(onRestore)}>{language === "zh" ? "恢复原有空间" : "Restore original workspace"}</button>
              </>
            ) : (
              <>
                <p>{language === "zh" ? "这不会删除当前数据。浏览器会保存原空间入口，稍后可一键恢复。" : "This does not delete current data. Your browser keeps a one-click route back."}</p>
                <button className="primary-button" disabled={busy} onClick={() => run(onBlank)}>{language === "zh" ? "进入空白核验空间" : "Enter blank workspace"}</button>
              </>
            )}
          </div>
        </article>
      </div>

      <article className="settings-panel settings-footnote">
        <div><span className="eyebrow">PRIVACY</span><h2>{language === "zh" ? "匿名免登录" : "Anonymous, no sign-in"}</h2></div>
        <p>{language === "zh" ? "当前空间通过 HttpOnly 会话 Cookie 隔离。先鉴不保存原视频；分析后只保留结构化结果和你主动写下的笔记。" : "This workspace is isolated by an HttpOnly session cookie. Xianjian does not store source video; only structured results and notes you write are retained."}</p>
      </article>
    </section>
  );
}

function ProgressView({ language, analysis, onBack, onRetry }: { language: Language; analysis: Analysis; onBack: () => void; onRetry: () => void }) {
  const stopped = ["failed", "cancelled"].includes(analysis.status);
  return (
    <section className="page centered-page"><article className="progress-card"><div className={`agent-orb ${stopped ? "stopped" : ""}`}><img src="/mascot.png" alt="" />{!stopped && <i />}</div><span className="eyebrow">REAL AGENT TASK</span><h1>{stopped ? (language === "zh" ? "这次没有完成" : "This task did not finish") : (language === "zh" ? "Mira 正在替你先看" : "Mira is previewing it")}</h1><p>{analysis.progressText}</p><div className="task-facts"><div><span>{language === "zh" ? "视频" : "Video"}</span><strong>{analysis.title}</strong></div><div><span>{language === "zh" ? "任务状态" : "Status"}</span><strong>{analysis.status}</strong></div><div><span>taskId</span><code>{analysis.taskId || (language === "zh" ? "等待 InfiniSynapse 返回…" : "Waiting for InfiniSynapse…")}</code></div></div>{analysis.errorMessage && <div className="error-box">{analysis.errorMessage}</div>}<div className="button-row">{analysis.id && stopped && <button className="primary-button" onClick={onRetry}>{language === "zh" ? "尝试恢复" : "Recover"}</button>}<button className="secondary-button" onClick={onBack}>{language === "zh" ? "返回" : "Back"}</button></div><small>{language === "zh" ? "刷新不会丢失 taskId；任务可从历史记录继续恢复。" : "Refresh-safe: the task can be recovered from History."}</small></article></section>
  );
}

function DetailView({ language, analysis, onBack, onState, onNoteSaved }: { language: Language; analysis: Analysis; onBack: () => void; onState: (state: string) => void; onNoteSaved: () => void }) {
  const result = analysis.result!;
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  return (
    <section className="page page-view">
      <div className="detail-top"><button className="back-button" onClick={onBack}>← {language === "zh" ? "返回" : "Back"}</button><div className="detail-actions"><button className="secondary-button" onClick={() => onState("later")}>{language === "zh" ? "加入稍后看" : "Watch later"}</button><button className="icon-button" onClick={() => onState("archived")}>•••</button></div></div>
      <div className="detail-hero"><div className="detail-cover"><div className="cover-grid" /><span>{analysis.source.split(/[·｜|]/)[0].toUpperCase()}</span><small>PUBLIC VIDEO · ANALYZED</small><i>{timecode(result.totalDurationSeconds)}</i></div><div className="detail-copy"><span className="meta">{analysis.source}</span><h1>{analysis.title}</h1><p>{result.summary}</p><div className="speaker-row"><span className="speaker-avatar">M</span><div><strong>Mira · InfiniSynapse Agent</strong><small>{language === "zh" ? "已核验时间码与内容信号" : "Timestamps and signals verified"}</small></div></div></div><div className="verdict-card"><span className="verdict-label"><i />{language === "zh" ? "Mira 的结论" : "Mira's verdict"}</span><strong>{verdictLabel(result.verdict, language)}</strong><p>{language === "zh" ? `只看 ${result.segments.filter((segment) => segment.decision === "watch").length} 个片段，共 ${formatTime(result.recommendedSeconds)}。` : `${result.segments.filter((segment) => segment.decision === "watch").length} segments, ${formatTime(result.recommendedSeconds)}.`}</p><div><span>{language === "zh" ? "与你的匹配度" : "Match"}</span><b>{result.signals.match}%</b></div></div></div>
      <div className="detail-body">
        <article className="route-panel"><div className="section-head"><div><span className="eyebrow">YOUR WATCHING ROUTE</span><h2>{language === "zh" ? "你的观看路线" : "Your watching route"}</h2><p>{language === "zh" ? `完整视频 ${formatTime(result.totalDurationSeconds)}，只保留能推动当前项目的部分。` : `From ${formatTime(result.totalDurationSeconds)}, only keep what moves your project forward.`}</p></div><div className="time-saved"><span>{language === "zh" ? "预计节省" : "TIME SAVED"}</span><strong>{formatTime(result.savedSeconds)}</strong></div></div>
          <div className="video-timeline"><div className="timeline-bar">{result.segments.map((segment) => <i key={segment.id} className={`dynamic-segment ${segment.decision}`} style={{ left: `${(segment.startSeconds / result.totalDurationSeconds) * 100}%`, width: `${Math.max(1, ((segment.endSeconds - segment.startSeconds) / result.totalDurationSeconds) * 100)}%` }} />)}</div><div className="timeline-labels"><span>00:00</span><span>{timecode(result.totalDurationSeconds / 4)}</span><span>{timecode(result.totalDurationSeconds / 2)}</span><span>{timecode(result.totalDurationSeconds * 0.75)}</span><span>{timecode(result.totalDurationSeconds)}</span></div></div>
          <div className="route-list">{result.segments.map((segment) => (
            <div className={`route-item ${segment.decision === "watch" ? "active" : ""}`} key={segment.id}><span className="play">▶</span><div><span>{timecode(segment.startSeconds)} — {timecode(segment.endSeconds)} · {formatTime(segment.endSeconds - segment.startSeconds)}</span><strong>{segment.title}</strong><p>{segment.value}</p><div className="tag-row">{segment.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>{noteFor === segment.id ? <div className="inline-note"><textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder={language === "zh" ? "记录这个时间码…" : "Write a timestamp note…"} /><button className="primary-button" onClick={async () => { if (!noteText.trim()) return; await api("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ meetingId: analysis.meetingId, segmentId: segment.id, timecodeSeconds: segment.startSeconds, content: noteText }) }); setNoteFor(null); setNoteText(""); onNoteSaved(); }}>{language === "zh" ? "保存" : "Save"}</button></div> : <button className="note-button" onClick={() => setNoteFor(segment.id)}>＋ {language === "zh" ? "记时间码笔记" : "Timestamp note"}</button>}</div><b>{segment.decision === "watch" ? (language === "zh" ? "现在看" : "Watch") : (language === "zh" ? "可跳过" : "Skip")}</b></div>
          ))}</div>
        </article>
        <aside className="detail-aside"><article className="why-card"><h3>{language === "zh" ? "你会得到什么" : "What you'll get"}</h3><ul>{result.evidence.slice(0, 4).map((item) => <li key={item}><i /><span>{item}</span></li>)}</ul></article><article className="signal-card">{[[language === "zh" ? "匹配度" : "Match", result.signals.match], [language === "zh" ? "技术深度" : "Depth", result.signals.depth], [language === "zh" ? "营销内容" : "Promotion", result.signals.promotion], [language === "zh" ? "重复内容" : "Repetition", result.signals.repetition]].map(([label, value]) => <div key={String(label)}><span>{label}</span><b>{value}%</b></div>)}</article><article className="memory-card"><div className="memory-title"><img src="/mascot.png" alt="" /><div><strong>{language === "zh" ? "看完会记住" : "Saved to memory"}</strong><p>{language === "zh" ? "自动进入你的学习记录" : "Added to your learning record"}</p></div></div><span>{result.newKnowledge.map((item) => item.topic).join(" / ") || "Agent / Evaluation"}</span></article><article className="task-card"><span>InfiniSynapse taskId</span><code>{analysis.taskId}</code></article></aside>
      </div>
    </section>
  );
}

function AddMeeting({ language, demo, profile, onClose, onStart, notify }: { language: Language; demo: DemoPayload; profile: LearningProfile; onClose: () => void; onStart: (input: { videoUrl?: string; title?: string; source?: string; transcript?: string; selectedProfile?: LearningProfile }) => void; notify: (message: string) => void }) {
  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [transcript, setTranscript] = useState("");
  const validUrl = /^https?:\/\/\S+/i.test(videoUrl.trim());
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal video-link-modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <div className="modal-head"><div><span className="eyebrow">NEW ANALYSIS</span><h2 id="add-title">{language === "zh" ? "粘贴视频链接，Mira 替你先看" : "Paste a video link. Mira previews it."}</h2><p>{language === "zh" ? "不需要下载视频，也不需要自己找字幕。公开可访问且带字幕的视频即可分析。" : "No download and no transcript hunting. Use a public video with captions."}</p></div><button className="close-button" onClick={onClose} aria-label="关闭">×</button></div>
        <div className="link-hero">
          <label><span>{language === "zh" ? "视频链接" : "Video URL"}</span><div className="url-input-wrap"><span>↗</span><input value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=… / https://www.bilibili.com/video/…" autoFocus /></div><small>{language === "zh" ? "支持公开的 YouTube、Bilibili、Vimeo 与其他可访问视频页面；必须有字幕、文字稿或章节时间码。" : "Supports public YouTube, Bilibili, Vimeo and other accessible video pages with captions, transcript or chapters."}</small></label>
          <label><span>{language === "zh" ? "标题（选填）" : "Title (optional)"}</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={language === "zh" ? "留空时根据链接自动命名" : "Auto-named from the URL when empty"} /></label>
        </div>
        <button className="advanced-toggle" onClick={() => setAdvanced((open) => !open)}>{advanced ? "−" : "＋"} {language === "zh" ? "高级输入：我已经有字幕" : "Advanced: I already have captions"}</button>
        {advanced && <div className="advanced-panel"><textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder={language === "zh" ? "粘贴带时间码的 SRT / VTT / TXT…" : "Paste timestamped SRT / VTT / TXT…"} maxLength={80000} /><div><button className="text-button" onClick={() => { setTranscript(demo.demo.transcript); setTitle(demo.demo.title); setVideoUrl(""); notify(language === "zh" ? "已载入内置示例" : "Demo loaded"); }}>{language === "zh" ? "载入内置示例" : "Load demo"}</button><span>{transcript.length.toLocaleString()} / 80,000</span></div></div>}
        <div className="privacy-strip"><img src="/mascot.png" alt="" /><div><strong>{language === "zh" ? "只分析，不保存视频" : "Analyze only. Video is not stored."}</strong><p>{language === "zh" ? "链接只用于本次任务；分析完成后保留结构化结果、时间码路线和你的笔记。" : "Only the result, timestamp route and notes are retained."}</p></div></div>
        <div className="modal-footer"><p>{language === "zh" ? "真实分析会消耗 1 次今日额度，并生成可核验 taskId。" : "Uses one daily analysis and creates a verifiable taskId."}</p><button className="secondary-button" onClick={onClose}>{language === "zh" ? "取消" : "Cancel"}</button><button className="primary-button" disabled={advanced ? transcript.trim().length < 500 : !validUrl} onClick={() => advanced ? onStart({ title: title || demo.demo.title, source: "字幕输入", transcript, selectedProfile: profile }) : onStart({ videoUrl, title, selectedProfile: profile })}>{language === "zh" ? "开始真实分析" : "Start real analysis"} →</button></div>
      </section>
    </div>
  );
}
