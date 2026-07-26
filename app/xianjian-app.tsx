"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LearningProfile, XianjianAnalysisResult } from "../lib/types";

type View = "home" | "progress" | "detail" | "library" | "profile";
type LibraryView = "meetings" | "notes" | "knowledge";
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
const verdictLabels = { worth: "值得看", selective: "选择性看", skip: "可以跳过" };

function formatTime(seconds = 0) {
  const value = Math.max(0, Math.round(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m${secs ? ` ${secs}s` : ""}`;
  return `${secs}s`;
}

function timecode(seconds = 0) {
  const value = Math.max(0, Math.round(seconds));
  return [
    Math.floor(value / 3600),
    Math.floor((value % 3600) / 60),
    value % 60,
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

async function api<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

export default function XianjianApp() {
  const [view, setView] = useState<View>("home");
  const [libraryView, setLibraryView] = useState<LibraryView>("meetings");
  const [libraryItems, setLibraryItems] = useState<Record<string, unknown>[]>([]);
  const [demo, setDemo] = useState<DemoPayload | null>(null);
  const [profile, setProfile] = useState<LearningProfile>(EMPTY_PROFILE);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  const loadLibrary = useCallback(async (kind: LibraryView) => {
    const payload = await api<{ items: Record<string, unknown>[] }>(
      `/api/library?view=${kind}`
    );
    setLibraryItems(payload.items || []);
  }, []);

  useEffect(() => {
    Promise.all([
      api<DemoPayload>("/api/demo"),
      api<{ profile: LearningProfile }>("/api/profile"),
      api<{ items: Record<string, unknown>[] }>("/api/library?view=meetings"),
    ])
      .then(([demoPayload, profilePayload, libraryPayload]) => {
        setDemo(demoPayload);
        setProfile(profilePayload.profile);
        setLibraryItems(libraryPayload.items || []);
      })
      .catch((error) => notify(error.message))
      .finally(() => setLoading(false));
  }, [notify]);

  async function pollAnalysis(analysisId: string) {
    const deadline = Date.now() + 12 * 60 * 1000;
    while (Date.now() < deadline) {
      const payload = await api<{ analysis: Analysis }>(`/api/analyses/${analysisId}`);
      setAnalysis(payload.analysis);
      if (payload.analysis.result) {
        setView("detail");
        notify("真实分析已完成并自动归档。");
        await loadLibrary("meetings");
        return;
      }
      if (["failed", "cancelled"].includes(payload.analysis.status)) {
        throw new Error(payload.analysis.errorMessage || "分析未完成");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 8000));
    }
    setAnalysis((current) =>
      current
        ? {
            ...current,
            status: "recovering",
            progressText: "任务仍在运行，可稍后从学习库继续恢复",
          }
        : current
    );
    notify("任务仍在 InfiniSynapse 运行，刷新后可继续恢复。");
  }

  async function openAnalysis(analysisId: string) {
    setView("progress");
    try {
      await pollAnalysis(analysisId);
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法打开分析");
      setView("home");
    }
  }

  async function updateMeetingState(meetingId: string, state: string) {
    await api(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    notify(
      state === "later"
        ? "已加入稍后看"
        : state === "completed"
          ? "已标记看完"
          : state === "skipped"
            ? "已标记跳过"
            : "已归档"
    );
    await loadLibrary("meetings");
  }

  async function startAnalysis(input: {
    title: string;
    source: string;
    transcript: string;
    selectedProfile?: LearningProfile;
  }) {
    setShowAdd(false);
    setView("progress");
    setAnalysis({
      id: "",
      meetingId: "",
      title: input.title,
      source: input.source,
      status: "queued",
      progressText: "正在保存会议",
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
      const meetingPayload = await api<{
        meeting: { id: string; title: string; source: string };
      }>("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const meetingId = meetingPayload.meeting.id;
      setAnalysis((current) =>
        current ? { ...current, meetingId, progressText: "正在连接真实 Agent" } : current
      );
      const response = await fetch(`/api/meetings/${meetingId}/analyze`, {
        method: "POST",
      });
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
          const text = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (!text) continue;
          const data = JSON.parse(text) as Record<string, unknown>;
          if (eventName === "created") {
            setAnalysis((current) =>
              current
                ? {
                    ...current,
                    id: String(data.analysisId),
                    status: "running",
                    progressText: "真实任务准备中",
                  }
                : current
            );
          } else if (eventName === "progress") {
            setAnalysis((current) =>
              current
                ? {
                    ...current,
                    id: String(data.analysisId || current.id),
                    taskId: data.taskId ? String(data.taskId) : current.taskId,
                    status: "running",
                    progressText: String(data.stage || "Agent 正在分析"),
                  }
                : current
            );
          } else if (eventName === "deduplicated") {
            await openAnalysis(String(data.analysisId));
          } else if (eventName === "started") {
            recoveryId = String(data.analysisId);
            setAnalysis((current) =>
              current
                ? {
                    ...current,
                    id: recoveryId,
                    taskId: String(data.taskId),
                    status: "recovering",
                    progressText: "真实任务运行中，可刷新恢复",
                  }
                : current
            );
          } else if (eventName === "completed") {
            setAnalysis((current) =>
              current
                ? {
                    ...current,
                    id: String(data.analysisId),
                    taskId: String(data.taskId),
                    status: "completed",
                    progressText: "分析完成",
                    result: data.result as XianjianAnalysisResult,
                  }
                : current
            );
            setView("detail");
            notify("真实分析已完成并自动归档");
            await loadLibrary("meetings");
          } else if (eventName === "error") {
            throw new Error(String(data.error || "分析失败"));
          }
        }
      }
      if (recoveryId) await pollAnalysis(recoveryId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "分析失败";
      setAnalysis((current) =>
        current
          ? { ...current, status: "failed", progressText: "分析未完成", errorMessage: message }
          : current
      );
      notify(message);
    }
  }

  const savedTotal = useMemo(
    () =>
      libraryItems.reduce((total, item) => {
        const result = item.result as XianjianAnalysisResult | undefined;
        return total + (result?.savedSeconds || 0);
      }, 0),
    [libraryItems]
  );

  if (loading) {
    return (
      <main className="loading-screen">
        <div className="brand-mark">鉴</div>
        <p>正在准备你的学习空间…</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("home")} aria-label="返回首页">
          <span className="brand-mark">鉴</span>
          <span><strong>先鉴</strong><small>Conference intelligence</small></span>
        </button>
        <nav className="main-nav" aria-label="主导航">
          <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}>
            <span>⌂</span>今日判断
          </button>
          <button
            className={view === "library" ? "active" : ""}
            onClick={() => {
              setLibraryView("meetings");
              loadLibrary("meetings");
              setView("library");
            }}
          >
            <span>▤</span>学习库
          </button>
          <button
            className={view === "profile" ? "active" : ""}
            onClick={() => setView("profile")}
          >
            <span>◎</span>个人画像
          </button>
        </nav>
        <div className="privacy-note">
          <img src="/mascot.png" alt="" />
          <strong>原文最小化</strong>
          <p>字幕仅用于本次分析；结果完成后自动清理，学习记录仍会保留。</p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><span className="live-dot" />InfiniSynapse Agent</div>
          <button className="primary-button" onClick={() => setShowAdd(true)}>
            ＋ 添加会议
          </button>
        </header>
        {view === "home" && (
          <HomeView
            items={libraryItems}
            savedTotal={savedTotal}
            onAdd={() => setShowAdd(true)}
            onOpen={openAnalysis}
            onLibrary={() => {
              setLibraryView("meetings");
              loadLibrary("meetings");
              setView("library");
            }}
          />
        )}
        {view === "progress" && analysis && (
          <ProgressView
            analysis={analysis}
            onCancel={async () => {
              if (!analysis.id) return;
              await api(`/api/analyses/${analysis.id}/cancel`, { method: "POST" });
              setAnalysis({ ...analysis, status: "cancelled", progressText: "已取消" });
              notify("任务已取消");
            }}
            onRetryRecovery={() => analysis.id && openAnalysis(analysis.id)}
            onBack={() => setView("home")}
          />
        )}
        {view === "detail" && analysis?.result && (
          <DetailView
            analysis={analysis}
            onBack={() => setView("home")}
            onState={(state) => updateMeetingState(analysis.meetingId, state)}
            onNoteSaved={() => notify("时间码笔记已保存")}
          />
        )}
        {view === "library" && (
          <LibraryPanel
            active={libraryView}
            items={libraryItems}
            onTab={async (next) => {
              setLibraryView(next);
              await loadLibrary(next);
            }}
            onOpen={openAnalysis}
            onState={updateMeetingState}
            onChanged={() => loadLibrary(libraryView)}
            notify={notify}
          />
        )}
        {view === "profile" && (
          <ProfileView
            profile={profile}
            onSave={async (next) => {
              const payload = await api<{ profile: LearningProfile }>("/api/profile", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(next),
              });
              setProfile(payload.profile);
              notify("个人画像已保存");
            }}
          />
        )}
      </main>
      {showAdd && demo && (
        <AddMeeting
          demo={demo}
          profile={profile}
          onClose={() => setShowAdd(false)}
          onStart={startAnalysis}
          notify={notify}
        />
      )}
      <div className={`toast ${toast ? "show" : ""}`} role="status">{toast}</div>
    </div>
  );
}

function HomeView({
  items,
  savedTotal,
  onAdd,
  onOpen,
  onLibrary,
}: {
  items: Record<string, unknown>[];
  savedTotal: number;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onLibrary: () => void;
}) {
  return (
    <section className="page home-page">
      <div className="home-heading">
        <div>
          <span className="eyebrow">PERSONAL CONFERENCE FILTER</span>
          <h1>先判断值不值得看，<br />再决定看什么。</h1>
          <p>把会议字幕交给 Agent。它会结合你的项目、水平和已知知识，只留下真正推进工作的时间码。</p>
        </div>
        <button className="hero-action" onClick={onAdd}>
          <span>用原创示例试一次</span><b>开始真实分析 ↗</b>
        </button>
      </div>
      <div className="metrics-row">
        <article><span>累计省下</span><strong>{formatTime(savedTotal)}</strong><small>由时间码区间确定性计算</small></article>
        <article><span>已归档分析</span><strong>{items.length}</strong><small>无需登录，刷新仍在</small></article>
        <article><span>今日可用</span><strong>3 次</strong><small>真实 Agent 调用保护额度</small></article>
      </div>
      <div className="section-title">
        <div><span className="eyebrow">RECENT JUDGEMENTS</span><h2>最近判断</h2></div>
        <button onClick={onLibrary}>打开学习库 →</button>
      </div>
      <div className="meeting-grid">
        {items.length === 0 ? (
          <button className="empty-card" onClick={onAdd}>
            <span className="empty-icon">＋</span><strong>还没有分析记录</strong>
            <p>使用原创会议，约两步即可看到真实价值判决。</p>
          </button>
        ) : (
          items.slice(0, 6).map((item) => {
            const result = item.result as XianjianAnalysisResult | undefined;
            return (
              <button
                className="meeting-card"
                key={String(item.id)}
                onClick={() => item.analysisId && onOpen(String(item.analysisId))}
              >
                <div className="card-top">
                  <span className={`verdict-chip ${result?.verdict || "pending"}`}>
                    {result ? verdictLabels[result.verdict] : String(item.status || "待分析")}
                  </span>
                  <time>{new Date(String(item.createdAt)).toLocaleDateString("zh-CN")}</time>
                </div>
                <h3>{String(item.title)}</h3>
                <p>
                  {result?.summary ||
                    (item.status === "failed"
                      ? "分析未完成；打开后可查看错误并再次尝试恢复。"
                      : item.status === "cancelled"
                        ? "任务已取消，会议记录仍保留在学习库。"
                        : "任务仍在处理中，可打开恢复真实进度。")}
                </p>
                <div className="card-bottom">
                  <span>
                    {result
                      ? `建议看 ${formatTime(result.recommendedSeconds)}`
                      : item.status === "failed"
                        ? "查看错误"
                        : "查看进度"}
                  </span>
                  <b>{result ? `省 ${formatTime(result.savedSeconds)}` : "→"}</b>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function ProgressView({
  analysis,
  onCancel,
  onRetryRecovery,
  onBack,
}: {
  analysis: Analysis;
  onCancel: () => void;
  onRetryRecovery: () => void;
  onBack: () => void;
}) {
  const stopped = analysis.status === "failed" || analysis.status === "cancelled";
  return (
    <section className="page centered-page">
      <article className="progress-card">
        <div className={`agent-orb ${stopped ? "stopped" : ""}`}>
          <img src="/mascot.png" alt="" />{!stopped && <i />}
        </div>
        <span className="eyebrow">REAL AGENT TASK</span>
        <h1>{stopped ? "这次没有完成" : "Mira 正在替你先看"}</h1>
        <p>{analysis.progressText}</p>
        <div className="task-facts">
          <div><span>会议</span><strong>{analysis.title}</strong></div>
          <div><span>任务状态</span><strong>{analysis.status}</strong></div>
          <div><span>可核验 taskId</span><code>{analysis.taskId || "等待 InfiniSynapse 返回…"}</code></div>
        </div>
        {analysis.errorMessage && <div className="error-box">{analysis.errorMessage}</div>}
        <div className="button-row">
          {analysis.id && !stopped && <button className="secondary-button" onClick={onCancel}>取消任务</button>}
          {analysis.id && stopped && <button className="primary-button" onClick={onRetryRecovery}>尝试恢复</button>}
          <button className="text-button" onClick={onBack}>返回首页</button>
        </div>
        <small>刷新不会丢失已获得的 taskId；恢复时先查询任务，不会盲目重复创建。</small>
      </article>
    </section>
  );
}

function DetailView({
  analysis,
  onBack,
  onState,
  onNoteSaved,
}: {
  analysis: Analysis;
  onBack: () => void;
  onState: (state: string) => void;
  onNoteSaved: () => void;
}) {
  const result = analysis.result!;
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  return (
    <section className="page detail-page">
      <button className="back-button" onClick={onBack}>← 返回</button>
      <div className={`verdict-hero ${result.verdict}`}>
        <div>
          <span className="eyebrow">PERSONAL VERDICT</span>
          <h1>{verdictLabels[result.verdict]}</h1><p>{result.summary}</p>
        </div>
        <div className="verdict-metric">
          <span>匹配度</span><strong>{result.signals.match}<small>%</small></strong>
        </div>
      </div>
      <div className="detail-layout">
        <article className="route-card">
          <div className="section-title">
            <div><span className="eyebrow">YOUR WATCHING ROUTE</span><h2>你的时间码路线</h2></div>
            <div className="time-summary">
              <span>完整 {formatTime(result.totalDurationSeconds)}</span>
              <strong>建议 {formatTime(result.recommendedSeconds)}</strong>
              <b>省下 {formatTime(result.savedSeconds)}</b>
            </div>
          </div>
          <div className="timeline">
            {result.segments.map((segment) => (
              <i
                key={segment.id}
                className={segment.decision}
                style={{
                  left: `${(segment.startSeconds / result.totalDurationSeconds) * 100}%`,
                  width: `${Math.max(1, ((segment.endSeconds - segment.startSeconds) / result.totalDurationSeconds) * 100)}%`,
                }}
              />
            ))}
          </div>
          <div className="segment-list">
            {result.segments.map((segment, index) => (
              <article className="segment" key={segment.id}>
                <span className={`segment-number ${segment.decision}`}>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>{timecode(segment.startSeconds)}—{timecode(segment.endSeconds)} · {formatTime(segment.endSeconds - segment.startSeconds)}</small>
                  <h3>{segment.title}</h3><p>{segment.value}</p>
                  <blockquote>{segment.evidence}</blockquote>
                  <div className="tag-row">{segment.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                  {noteFor === segment.id ? (
                    <div className="inline-note">
                      <textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="记录这个时间码为什么值得回来…" maxLength={4000} autoFocus />
                      <button
                        className="primary-button"
                        onClick={async () => {
                          if (!noteText.trim()) return;
                          await api("/api/notes", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              meetingId: analysis.meetingId,
                              segmentId: segment.id,
                              timecodeSeconds: segment.startSeconds,
                              content: noteText,
                            }),
                          });
                          setNoteText(""); setNoteFor(null); onNoteSaved();
                        }}
                      >
                        保存笔记
                      </button>
                      <button className="text-button" onClick={() => setNoteFor(null)}>取消</button>
                    </div>
                  ) : (
                    <button className="note-button" onClick={() => setNoteFor(segment.id)}>
                      ＋ 在 {timecode(segment.startSeconds)} 记笔记
                    </button>
                  )}
                </div>
                <b className={segment.decision}>{segment.decision === "watch" ? "建议看" : "可跳过"}</b>
              </article>
            ))}
          </div>
        </article>
        <aside className="detail-aside">
          <article className="fact-card">
            <span>分析依据</span><ul>{result.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
          <article className="signal-card">
            {Object.entries({
              匹配度: result.signals.match,
              技术深度: result.signals.depth,
              推广含量: result.signals.promotion,
              重复内容: result.signals.repetition,
              来源可靠: result.signals.sourceReliability,
            }).map(([label, value]) => (
              <div key={label}><span>{label}</span><i><b style={{ width: `${value}%` }} /></i><strong>{value}</strong></div>
            ))}
          </article>
          <article className="knowledge-card">
            <span>新增知识</span>
            {result.newKnowledge.length
              ? result.newKnowledge.map((item) => <p key={item.topic}>＋ {item.topic}</p>)
              : <p>没有识别到明确新增知识</p>}
          </article>
          <article className="task-card"><span>真实任务核验</span><code>{analysis.taskId}</code></article>
          <div className="state-actions">
            <button onClick={() => onState("later")}>稍后看</button>
            <button onClick={() => onState("completed")}>标记看完</button>
            <button onClick={() => onState("skipped")}>跳过</button>
            <button onClick={() => onState("archived")}>归档</button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function LibraryPanel({
  active,
  items,
  onTab,
  onOpen,
  onState,
  onChanged,
  notify,
}: {
  active: LibraryView;
  items: Record<string, unknown>[];
  onTab: (view: LibraryView) => void;
  onOpen: (id: string) => void;
  onState: (meetingId: string, state: string) => void;
  onChanged: () => void;
  notify: (message: string) => void;
}) {
  return (
    <section className="page">
      <div className="page-heading">
        <div><span className="eyebrow">LEARNING LIBRARY</span><h1>学习库</h1><p>会议、时间码笔记和知识更新，在这里形成可再次打开的记录。</p></div>
      </div>
      <div className="tabs">
        {(["meetings", "notes", "knowledge"] as LibraryView[]).map((tab) => (
          <button className={active === tab ? "active" : ""} onClick={() => onTab(tab)} key={tab}>
            {tab === "meetings" ? "会议" : tab === "notes" ? "笔记" : "知识更新"}
          </button>
        ))}
      </div>
      <div className="library-list">
        {items.length === 0 && <div className="library-empty">这里还没有记录。完成一次分析后会自动出现。</div>}
        {active === "meetings" &&
          items.map((item) => {
            const result = item.result as XianjianAnalysisResult | undefined;
            return (
              <article className="library-row" key={String(item.id)}>
                <span className={`library-dot ${result?.verdict || "pending"}`} />
                <div>
                  <small>{String(item.source)} · {new Date(String(item.createdAt)).toLocaleString("zh-CN")}</small>
                  <h3>{String(item.title)}</h3>
                  <p>{result?.summary || `状态：${String(item.status || "待分析")}`}</p>
                </div>
                <div className="row-meta">
                  <strong>
                    {result
                      ? verdictLabels[result.verdict]
                      : item.status === "failed"
                        ? "未完成"
                        : item.status === "cancelled"
                          ? "已取消"
                          : "处理中"}
                  </strong>
                  <small>{Number(item.noteCount || 0)} 条笔记</small>
                </div>
                <div className="row-actions">
                  {Boolean(item.analysisId) && <button onClick={() => onOpen(String(item.analysisId))}>打开</button>}
                  <button onClick={() => onState(String(item.id), "later")}>稍后看</button>
                </div>
              </article>
            );
          })}
        {active === "notes" &&
          items.map((item) => (
            <NoteRow item={item} key={String(item.id)} onChanged={onChanged} notify={notify} />
          ))}
        {active === "knowledge" &&
          items.map((item) => (
            <article className="knowledge-row" key={String(item.id)}>
              <span className={String(item.status)}>{item.status === "new" ? "新增" : "重复"}</span>
              <div><small>{String(item.title)}</small><h3>{String(item.topic)}</h3><p>{String(item.evidence)}</p></div>
            </article>
          ))}
      </div>
    </section>
  );
}

function NoteRow({
  item,
  onChanged,
  notify,
}: {
  item: Record<string, unknown>;
  onChanged: () => void;
  notify: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(String(item.content));
  return (
    <article className="note-row">
      <div className="note-time">{item.timecodeSeconds == null ? "会议" : timecode(Number(item.timecodeSeconds))}</div>
      <div>
        <small>{String(item.title)}</small>
        {editing ? <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={4000} /> : <p>{String(item.content)}</p>}
      </div>
      <div className="row-actions">
        {editing ? (
          <>
            <button
              onClick={async () => {
                await api(`/api/notes/${String(item.id)}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ content }),
                });
                setEditing(false); notify("笔记已更新"); onChanged();
              }}
            >
              保存
            </button>
            <button onClick={() => setEditing(false)}>取消</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)}>编辑</button>
            <button
              onClick={async () => {
                await api(`/api/notes/${String(item.id)}`, { method: "DELETE" });
                notify("笔记已删除"); onChanged();
              }}
            >
              删除
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function ProfileView({
  profile,
  onSave,
}: {
  profile: LearningProfile;
  onSave: (profile: LearningProfile) => void;
}) {
  const [draft, setDraft] = useState(profile);
  useEffect(() => setDraft(profile), [profile]);
  const fields: Array<[keyof LearningProfile, string, string]> = [
    ["direction", "当前方向", "例如：Agent 产品与交互设计"],
    ["level", "当前水平", "例如：入门 / 进阶 / 资深"],
    ["project", "正在做的项目", "Agent 判断“现在有用”的核心依据"],
    ["knownTopics", "已掌握主题", "用顿号或逗号分隔"],
    ["preferences", "内容偏好", "例如：优先真实案例、跳过推广"],
  ];
  return (
    <section className="page profile-page">
      <div className="page-heading">
        <div><span className="eyebrow">LEARNING PROFILE</span><h1>个人画像</h1><p>同一场会议，画像不同，值得看的片段也应该不同。</p></div>
        <button className="primary-button" onClick={() => onSave(draft)}>保存画像</button>
      </div>
      <div className="profile-layout">
        <aside><img src="/mascot.png" alt="" /><h2>Mira 正在了解你</h2><p>这些信息只用于个性化判断，不需要注册账号。</p></aside>
        <div className="profile-form">
          {fields.map(([key, label, placeholder]) => (
            <label key={key}>
              <span>{label}</span>
              {key === "project" || key === "preferences" ? (
                <textarea value={draft[key]} placeholder={placeholder} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
              ) : (
                <input value={draft[key]} placeholder={placeholder} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
              )}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

function AddMeeting({
  demo,
  profile,
  onClose,
  onStart,
  notify,
}: {
  demo: DemoPayload;
  profile: LearningProfile;
  onClose: () => void;
  onStart: (input: {
    title: string;
    source: string;
    transcript: string;
    selectedProfile?: LearningProfile;
  }) => void;
  notify: (message: string) => void;
}) {
  const [mode, setMode] = useState<"demo" | "paste" | "file">("demo");
  const [title, setTitle] = useState(demo.demo.title);
  const [source, setSource] = useState(demo.demo.source);
  const [transcript, setTranscript] = useState(demo.demo.transcript);
  const [profileId, setProfileId] = useState(demo.profiles[0]?.id || "");
  const selectedProfile =
    mode === "demo"
      ? demo.profiles.find((item) => item.id === profileId)?.profile
      : profile;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <div className="modal-head">
          <div><span className="eyebrow">NEW ANALYSIS</span><h2 id="add-title">添加会议</h2><p>不读取视频链接，请直接提供带时间码字幕。</p></div>
          <button className="close-button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="tabs">
          <button className={mode === "demo" ? "active" : ""} onClick={() => {
            setMode("demo"); setTitle(demo.demo.title); setSource(demo.demo.source); setTranscript(demo.demo.transcript);
          }}>一键示例</button>
          <button className={mode === "paste" ? "active" : ""} onClick={() => {
            setMode("paste"); setTitle(""); setSource("粘贴字幕"); setTranscript("");
          }}>粘贴字幕</button>
          <button className={mode === "file" ? "active" : ""} onClick={() => {
            setMode("file"); setTitle(""); setSource("字幕文件"); setTranscript("");
          }}>上传文件</button>
        </div>
        <div className="modal-form">
          <label><span>会议标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} /></label>
          <label><span>来源</span><input value={source} onChange={(event) => setSource(event.target.value)} maxLength={180} /></label>
          {mode === "demo" && (
            <label>
              <span>演示画像</span>
              <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
                {demo.profiles.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select>
              <small>切换画像后再次分析同一会议，可验证个性化推荐差异。</small>
            </label>
          )}
          {mode === "file" && (
            <label className="file-drop">
              <input
                type="file"
                accept=".srt,.vtt,.txt,text/plain,text/vtt"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 300_000) {
                    notify("文件过大，请控制在 300 KB 内");
                    return;
                  }
                  const extension = file.name.split(".").pop()?.toLowerCase();
                  if (!["srt", "vtt", "txt"].includes(extension || "")) {
                    notify("只支持 SRT、VTT、TXT");
                    return;
                  }
                  setTranscript(await file.text());
                  if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
                  setSource(`文件：${file.name}`);
                }}
              />
              <strong>选择 SRT、VTT 或 TXT</strong>
              <small>{transcript ? `已读取 ${transcript.length.toLocaleString()} 字符` : "最大 300 KB，浏览器只读取文字"}</small>
            </label>
          )}
          {mode !== "file" && (
            <label>
              <span>带时间码字幕</span>
              <textarea className="transcript-input" value={transcript} onChange={(event) => setTranscript(event.target.value)} maxLength={80000} />
              <small>{transcript.length.toLocaleString()} / 80,000 字符</small>
            </label>
          )}
        </div>
        <div className="modal-footer">
          <p>真实分析会消耗 1 次今日额度，并在 InfiniSynapse 控制台生成任务。</p>
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button
            className="primary-button"
            onClick={() => onStart({ title, source, transcript, selectedProfile })}
            disabled={!title.trim() || transcript.trim().length < 500}
          >
            开始真实分析
          </button>
        </div>
      </section>
    </div>
  );
}
